using Application.Helpers;
using IPTVAPI.Application.Abstractions;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Mvc;
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace IPTVAPI.Controllers;

[ApiController]
[Route("[controller]/[action]")]
public class HlsRecorderController : ControllerBase
{
    private const int DefaultLiveWindowSize = 24;
    private const double ChunkSegmentThresholdSeconds = 10.0;
    private static readonly Regex SegmentTimePattern = new(@"_(?:(\d{8})_)?(\d{2})-(\d{2})-(\d{2})(?:_(?:\d{2}-\d{2}-\d{2}|live|\d+))?\.ts$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private readonly IHlsDownloaderService _hlsDownloaderService;
    private readonly IHlsRecordingStorageService _recordingStorageService;
    private readonly IConfiguration _configuration;
    private readonly int _liveWindowSize;

    public HlsRecorderController(
        IHlsDownloaderService hlsDownloaderService,
        IHlsRecordingStorageService recordingStorageService,
        IConfiguration configuration)
    {
        _hlsDownloaderService = hlsDownloaderService;
        _recordingStorageService = recordingStorageService;
        _configuration = configuration;
        _liveWindowSize = ResolveLiveWindowSize(configuration);
    }

    [HttpPost]
    public async Task<IActionResult> Start([FromQuery] string playlistUrl, [FromQuery] string? recordingName = null, CancellationToken ct = default)
    {
        var isRecordingEnabled = _configuration.GetValue<bool?>("Recording:Enabled") ?? true;
        if (!isRecordingEnabled)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Recording is disabled by configuration." });

        var outputPath = await _hlsDownloaderService.StartAsync(playlistUrl, recordingName, ct);
        return Ok(new
        {
            message = "Recording started",
            outputDirectory = outputPath
        });
    }

    [HttpPost]
    public async Task<IActionResult> Stop(CancellationToken ct = default)
    {
        await _hlsDownloaderService.StopAsync(ct);
        return Ok(new { message = "Recording stop requested" });
    }

    [HttpGet]
    public IActionResult Status()
    {
        return Ok(new
        {
            isRecording = _hlsDownloaderService.IsRecording,
            outputDirectory = _hlsDownloaderService.CurrentOutputDirectory
        });
    }

    [HttpGet("{recordingName}/index.m3u8")]
    public async Task<IActionResult> GetLivePlaylist(
        string recordingName,
        [FromQuery] bool includeAllSegments = false,
        [FromQuery] int? hour = null,
        [FromQuery] int? minute = null,
        [FromQuery] string? day = null,
        CancellationToken ct = default)
    {
        var useAllSegments = includeAllSegments;
        DateOnly? requestedDay = null;

        if (hour.HasValue != minute.HasValue)
            return BadRequest(new { message = "Both hour and minute must be provided together." });

        if (!string.IsNullOrWhiteSpace(day) && (!hour.HasValue || !minute.HasValue))
            return BadRequest(new { message = "Day requires both hour and minute." });

        if (hour is < 0 or > 23)
            return BadRequest(new { message = "Hour must be between 0 and 23." });

        if (minute is < 0 or > 59)
            return BadRequest(new { message = "Minute must be between 0 and 59." });

        if (!string.IsNullOrWhiteSpace(day))
        {
            if (!DateOnly.TryParseExact(day, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedDay))
                return BadRequest(new { message = "Day must be in yyyyMMdd format." });

            requestedDay = parsedDay;
        }

        var safeRecordingName = StringHelper.SanitizeName(StringHelper.UrlDecode(recordingName));
        var segments = hour.HasValue && minute.HasValue
            ? (await _recordingStorageService.ListSegmentsAsync(safeRecordingName, ct))
                .OrderBy(file => file.LastModifiedUtc)
                .ThenBy(file => file.Name, StringComparer.OrdinalIgnoreCase)
                .ToList()
            : [];

        var driveChunks = (!hour.HasValue && !minute.HasValue
                ? await _recordingStorageService.ListUploadedSegmentsAsync(safeRecordingName, ct)
                : segments.Where(segment => segment.DurationSeconds > ChunkSegmentThresholdSeconds).ToList())
            .OrderBy(file => file.LastModifiedUtc)
            .ThenBy(file => file.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var uploadedPlaylistSegments = !hour.HasValue && !minute.HasValue
            ? (await _recordingStorageService.ListUploadedPlaylistSegmentsAsync(safeRecordingName, ct))
                .OrderBy(file => file.LastModifiedUtc)
                .ThenBy(file => file.Name, StringComparer.OrdinalIgnoreCase)
                .ToList()
            : [];

        var liveSegments = (!hour.HasValue && !minute.HasValue
                ? await _recordingStorageService.ListLiveSegmentsAsync(safeRecordingName, ct)
                : segments.Where(segment => segment.DurationSeconds <= ChunkSegmentThresholdSeconds).ToList())
            .OrderBy(file => file.LastModifiedUtc)
            .ThenBy(file => file.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (hour.HasValue && minute.HasValue && segments.Count == 0)
            return NotFound(new { message = "No segments found for this recording yet." });

        List<RecordingSegmentInfo> windowSegments;
        List<RecordingPlaylistSegmentInfo> playlistSegments;
        int startIndex;

        if (hour.HasValue && minute.HasValue)
        {
            var requestedStartIndex = segments.FindIndex(segment => SegmentIsAtOrAfterTime(segment, hour.Value, minute.Value, requestedDay));
            if (requestedStartIndex < 0)
                return NotFound(new { message = "No segments found at or after the requested hour/minute." });

            // When a start time is provided, stream from that point onward.
            startIndex = requestedStartIndex;
            windowSegments = segments.Skip(startIndex).ToList();
            playlistSegments = windowSegments
                .Select(segment => new RecordingPlaylistSegmentInfo(segment.Name, segment.LastModifiedUtc, segment.DurationSeconds, null, null))
                .ToList();
        }
        else
        {
            if (useAllSegments)
            {
                startIndex = 0;
                windowSegments = driveChunks;
                playlistSegments = uploadedPlaylistSegments;
            }
            else
            {
                startIndex = Math.Max(0, liveSegments.Count - _liveWindowSize);
                windowSegments = liveSegments.Skip(startIndex).ToList();
                playlistSegments = windowSegments
                    .Select(segment => new RecordingPlaylistSegmentInfo(segment.Name, segment.LastModifiedUtc, segment.DurationSeconds, null, null))
                    .ToList();
            }
        }

        if (playlistSegments.Count == 0)
            return NotFound(new { message = useAllSegments ? "No uploaded Drive chunks found for this recording yet." : "No live segments found for this recording yet." });

        var isVodPlaylist = hour.HasValue && minute.HasValue;
        var playlist = BuildPlaylist(safeRecordingName, startIndex, playlistSegments, isVodPlaylist);

        Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Expires = "0";

        return Content(playlist, "application/vnd.apple.mpegurl", Encoding.UTF8);
    }

    [HttpGet("{recordingName}/{fileName}")]
    public async Task<IActionResult> GetLiveSegment(string recordingName, string fileName, CancellationToken ct = default)
    {
        if (!fileName.EndsWith(".ts", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Only .ts files are supported." });

        if (Path.GetFileName(fileName) != fileName)
            return BadRequest(new { message = "Invalid file name." });

        var safeRecordingName = StringHelper.SanitizeName(StringHelper.UrlDecode(recordingName));
        var range = ParseRangeHeader(Request.Headers.Range, Request.Headers.IfRange);
        var segmentReadResult = await _recordingStorageService.OpenSegmentReadAsync(
            safeRecordingName,
            fileName,
            range?.Start,
            range?.End,
            ct);

        if (segmentReadResult is null)
            return NotFound(new { message = "Segment not found." });

        Response.Headers.AcceptRanges = "bytes";

        if (segmentReadResult.IsPartial)
        {
            Response.StatusCode = StatusCodes.Status206PartialContent;
            Response.ContentLength = segmentReadResult.ContentLength;
            Response.Headers.ContentRange = $"bytes {segmentReadResult.RangeStart}-{segmentReadResult.RangeEnd}/{segmentReadResult.TotalLength}";
            return File(segmentReadResult.Stream, "video/mp2t", enableRangeProcessing: false);
        }

        return File(segmentReadResult.Stream, "video/mp2t", enableRangeProcessing: true);
    }

    private string BuildPlaylist(string recordingName, int mediaSequence, IReadOnlyCollection<RecordingPlaylistSegmentInfo> segments, bool isVodPlaylist)
    {
        var host = $"{Request.Scheme}://{Request.Host}";
        var encodedRecordingName = Uri.EscapeDataString(recordingName);
        var targetDuration = Math.Max(1, (int)Math.Ceiling(segments.Max(segment => segment.DurationSeconds)));

        var sb = new StringBuilder();
        sb.AppendLine("#EXTM3U");
        sb.AppendLine("#EXT-X-VERSION:3");
        sb.AppendLine($"#EXT-X-TARGETDURATION:{targetDuration}");
        if (isVodPlaylist)
            sb.AppendLine("#EXT-X-PLAYLIST-TYPE:VOD");

        sb.AppendLine($"#EXT-X-MEDIA-SEQUENCE:{mediaSequence}");

        foreach (var segment in segments)
        {
            var encodedSegmentName = Uri.EscapeDataString(segment.Name);
            sb.AppendLine($"#EXTINF:{segment.DurationSeconds:0.0},");
            if (segment.ByteRangeLength.HasValue)
            {
                sb.Append("#EXT-X-BYTERANGE:");
                sb.Append(segment.ByteRangeLength.Value);
                if (segment.ByteRangeOffset.HasValue)
                    sb.Append($"@{segment.ByteRangeOffset.Value}");
                sb.AppendLine();
            }

            sb.AppendLine($"{host}/HlsRecorder/GetLiveSegment/{encodedRecordingName}/{encodedSegmentName}");
        }

        if (isVodPlaylist)
            sb.AppendLine("#EXT-X-ENDLIST");

        return sb.ToString();
    }

    private static bool SegmentIsAtOrAfterTime(RecordingSegmentInfo segment, int hour, int minute, DateOnly? requestedDay)
    {
        var requestedTime = new TimeOnly(hour, minute);

        var match = SegmentTimePattern.Match(segment.Name);
        var segmentLocalTime = segment.LastModifiedUtc.ToLocalTime();
        if (!match.Success)
        {
            var fallbackTime = TimeOnly.FromDateTime(segmentLocalTime);
            if (!requestedDay.HasValue)
                return fallbackTime >= requestedTime;

            return DateOnly.FromDateTime(segmentLocalTime) > requestedDay.Value
                || (DateOnly.FromDateTime(segmentLocalTime) == requestedDay.Value && fallbackTime >= requestedTime);
        }

        var parsedDay = DateOnly.FromDateTime(segmentLocalTime);
        if (match.Groups[1].Success &&
            DateOnly.TryParseExact(match.Groups[1].Value, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedFromNameDay))
        {
            parsedDay = parsedFromNameDay;
        }

        var parsedHour = int.Parse(match.Groups[2].Value);
        var parsedMinute = int.Parse(match.Groups[3].Value);
        var segmentTime = new TimeOnly(parsedHour, parsedMinute);

        if (!requestedDay.HasValue)
            return segmentTime >= requestedTime;

        return parsedDay > requestedDay.Value
            || (parsedDay == requestedDay.Value && segmentTime >= requestedTime);
    }

    private static ByteRange? ParseRangeHeader(string? rangeHeader, string? ifRangeHeader)
    {
        if (string.IsNullOrWhiteSpace(rangeHeader))
            return null;

        if (!string.IsNullOrWhiteSpace(ifRangeHeader))
            return null;

        if (!rangeHeader.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
            return null;

        var firstRange = rangeHeader["bytes=".Length..].Split(',', 2, StringSplitOptions.TrimEntries)[0];
        var parts = firstRange.Split('-', 2);
        if (parts.Length != 2)
            return null;

        if (string.IsNullOrWhiteSpace(parts[0]))
        {
            return long.TryParse(parts[1], out var suffixLength) && suffixLength > 0
                ? new ByteRange(null, suffixLength)
                : null;
        }

        if (!long.TryParse(parts[0], out var start) || start < 0)
            return null;

        if (string.IsNullOrWhiteSpace(parts[1]))
            return new ByteRange(start, null);

        return long.TryParse(parts[1], out var end) && end >= start
            ? new ByteRange(start, end)
            : null;
    }

    private sealed record ByteRange(long? Start, long? End);

    private static int ResolveLiveWindowSize(IConfiguration configuration)
    {
        return int.TryParse(configuration["Recording:LivePlaylist:WindowSegments"], out var parsedWindowSize) && parsedWindowSize > 0
            ? parsedWindowSize
            : DefaultLiveWindowSize;
    }

}
