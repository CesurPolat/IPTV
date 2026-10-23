using IPTVAPI.Application.Abstractions;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Threading;

namespace IPTVAPI.Infrastructure.Services.Streaming;

public class HlsDownloaderService : IHlsDownloaderService
{
    private const int DefaultWaitSeconds = 5;
    private const int PlaylistFailureRefreshThreshold = 3;
    private const int SegmentFailureRefreshThreshold = 5;
    private readonly HttpClient _httpClient;
    private readonly ILogger<HlsDownloaderService> _logger;
    private readonly IHlsRecordingStorageService _recordingStorageService;
    private readonly Func<string, CancellationToken, Task<string?>>? _sourceRefreshResolver;
    private readonly SemaphoreSlim _stateLock = new(1, 1);
    private readonly HashSet<string> _downloadedSegments = new(StringComparer.OrdinalIgnoreCase);

    private CancellationTokenSource? _recordingCts;
    private Task? _recordingTask;
    private string? _playlistUrl;
    private string? _recordingName;
    private string? _recordingSessionName;
    private string _recordingFilePrefix = "recording";
    private long _segmentCounter;

    public event Action<string>? OnLog;

    public bool IsRecording { get; private set; }
    public string? CurrentOutputDirectory { get; private set; }

    public HlsDownloaderService(ILogger<HlsDownloaderService> logger, IHlsRecordingStorageService recordingStorageService)
        : this(logger, recordingStorageService, null)
    {
    }

    public HlsDownloaderService(
        ILogger<HlsDownloaderService> logger,
        IHlsRecordingStorageService recordingStorageService,
        Func<string, CancellationToken, Task<string?>>? sourceRefreshResolver)
    {
        _logger = logger;
        _recordingStorageService = recordingStorageService;
        _sourceRefreshResolver = sourceRefreshResolver;
        _httpClient = new HttpClient();
        _httpClient.DefaultRequestHeaders.TryAddWithoutValidation(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
    }

    public async Task<string> StartAsync(string playlistUrl, string? recordingName = null, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(playlistUrl))
            throw new ArgumentException("Playlist URL cannot be empty.", nameof(playlistUrl));

        await _stateLock.WaitAsync(ct);
        try
        {
            if (IsRecording)
                throw new InvalidOperationException("A recording session is already running.");

            if (!Uri.TryCreate(playlistUrl, UriKind.Absolute, out _))
                throw new ArgumentException("Playlist URL is not a valid absolute URI.", nameof(playlistUrl));

            var todayFolder = DateTime.Now.ToString("yyyy-MM-dd");
            var folderName = string.IsNullOrWhiteSpace(recordingName)
                ? todayFolder
                : SanitizeFolderName(recordingName);

            CurrentOutputDirectory = await _recordingStorageService.InitializeSessionAsync(folderName, ct);

            _playlistUrl = playlistUrl;
            _recordingName = recordingName;
            _recordingSessionName = folderName;
            _recordingFilePrefix = folderName;
            _segmentCounter = 0;
            _downloadedSegments.Clear();
            _recordingCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            IsRecording = true;

            Log($"Recording started. Output: {CurrentOutputDirectory}");
            _recordingTask = Task.Run(() => RunAsync(_recordingCts.Token), CancellationToken.None);

            return CurrentOutputDirectory;
        }
        finally
        {
            _stateLock.Release();
        }
    }

    public async Task StopAsync(CancellationToken ct = default)
    {
        Task? runningTask;
        string? sessionNameToFlush;

        await _stateLock.WaitAsync(ct);
        try
        {
            if (!IsRecording)
                return;

            Log("Stopping recording...");
            _recordingCts?.Cancel();
            runningTask = _recordingTask;
            sessionNameToFlush = _recordingSessionName;
        }
        finally
        {
            _stateLock.Release();
        }

        if (runningTask is not null)
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var timeoutTask = Task.Delay(TimeSpan.FromSeconds(5), timeoutCts.Token);
            var completed = await Task.WhenAny(runningTask, timeoutTask);
            if (completed == runningTask)
            {
                timeoutCts.Cancel();
                await runningTask;
            }
            else
            {
                Log("Stop timeout reached; recording task is still shutting down.");
            }
        }

        if (!string.IsNullOrWhiteSpace(sessionNameToFlush))
        {
            try
            {
                await _recordingStorageService.FlushSessionAsync(sessionNameToFlush, ct);
            }
            catch (Exception ex)
            {
                Log($"Recording flush failed: {ex.Message}");
            }
        }
    }

    private async Task RunAsync(CancellationToken ct)
    {
        var consecutivePlaylistFailures = 0;
        var consecutiveSegmentFailures = 0;

        try
        {
            while (!ct.IsCancellationRequested)
            {
                if (_playlistUrl is null)
                {
                    Log("Playlist URL is missing; stopping recording loop.");
                    break;
                }

                var playlistResult = await GetPlaylistAsync(_playlistUrl, ct);
                if (playlistResult.Playlist is null)
                {
                    consecutivePlaylistFailures++;

                    var shouldRefresh = playlistResult.ShouldTriggerSourceRefresh
                        || consecutivePlaylistFailures >= PlaylistFailureRefreshThreshold;
                    if (shouldRefresh)
                    {
                        var refreshed = await TryRefreshSourceAsync(
                            playlistResult.FailureReason ?? "playlist fetch repeatedly failed",
                            ct);

                        if (refreshed)
                        {
                            consecutivePlaylistFailures = 0;
                            consecutiveSegmentFailures = 0;
                            continue;
                        }
                    }

                    Log("Playlist could not be loaded. Retrying in 5 seconds...");
                    await WaitAsync(DefaultWaitSeconds, ct);
                    continue;
                }

                consecutivePlaylistFailures = 0;
                var playlist = playlistResult.Playlist;

                if (playlist.IsVariant)
                {
                    var firstVariant = playlist.VariantUrls.FirstOrDefault();
                    if (!string.IsNullOrEmpty(firstVariant))
                    {
                        _playlistUrl = firstVariant;
                        Log($"Master playlist detected. Switched to first variant: {_playlistUrl}");
                        continue;
                    }

                    Log("Master playlist detected but no variant entries were found.");
                    await WaitAsync(DefaultWaitSeconds, ct);
                    continue;
                }

                foreach (var segmentUrl in playlist.SegmentUrls)
                {
                    if (ct.IsCancellationRequested)
                        break;

                    if (_downloadedSegments.Contains(segmentUrl))
                        continue;

                    var segmentFileName = BuildSegmentFileName(DateTime.Now);

                    var segmentResult = await DownloadSegmentAsync(segmentUrl, segmentFileName, ct);
                    if (segmentResult.Success)
                    {
                        consecutiveSegmentFailures = 0;
                        _downloadedSegments.Add(segmentUrl);
                        continue;
                    }

                    consecutiveSegmentFailures++;

                    var shouldRefresh = segmentResult.ShouldTriggerSourceRefresh
                        || consecutiveSegmentFailures >= SegmentFailureRefreshThreshold;
                    if (shouldRefresh)
                    {
                        var refreshed = await TryRefreshSourceAsync(
                            segmentResult.FailureReason ?? "segment fetch repeatedly failed",
                            ct);

                        if (refreshed)
                        {
                            consecutivePlaylistFailures = 0;
                            consecutiveSegmentFailures = 0;
                            break;
                        }
                    }
                }

                await WaitAsync(playlist.TargetDuration ?? DefaultWaitSeconds, ct);
            }

            Log("Recording stopped successfully.");
        }
        catch (OperationCanceledException)
        {
            Log("Recording canceled.");
        }
        catch (Exception ex)
        {
            Log($"Critical error: {ex.Message}");
        }
        finally
        {
            await _stateLock.WaitAsync(CancellationToken.None);
            try
            {
                IsRecording = false;
                _recordingTask = null;
                _recordingCts?.Dispose();
                _recordingCts = null;
            }
            finally
            {
                _stateLock.Release();
            }

            if (!string.IsNullOrWhiteSpace(_recordingSessionName))
            {
                try
                {
                    await _recordingStorageService.FlushSessionAsync(_recordingSessionName, CancellationToken.None);
                }
                catch (Exception ex)
                {
                    Log($"Final recording flush failed: {ex.Message}");
                }
            }

            await _stateLock.WaitAsync(CancellationToken.None);
            try
            {
                _recordingSessionName = null;
            }
            finally
            {
                _stateLock.Release();
            }
        }
    }

    private async Task<PlaylistFetchResult> GetPlaylistAsync(string playlistUrl, CancellationToken ct)
    {
        try
        {
            using var response = await _httpClient.GetAsync(playlistUrl, ct);

            if (!response.IsSuccessStatusCode)
            {
                var reason = $"playlist request returned {(int)response.StatusCode} ({response.StatusCode})";
                Log(reason);

                return new PlaylistFetchResult
                {
                    ShouldTriggerSourceRefresh = response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden,
                    FailureReason = reason
                };
            }

            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync(ct);
            return new PlaylistFetchResult
            {
                Playlist = ParsePlaylist(content, playlistUrl)
            };
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            Log($"Playlist request error: {ex.Message}");
            return new PlaylistFetchResult
            {
                FailureReason = ex.Message
            };
        }
    }

    private static ParsedPlaylist ParsePlaylist(string content, string playlistUrl)
    {
        var result = new ParsedPlaylist();
        var baseUri = new Uri(playlistUrl);

        var lines = content
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            if (line.StartsWith("#EXT-X-TARGETDURATION:", StringComparison.OrdinalIgnoreCase))
            {
                var value = line[("#EXT-X-TARGETDURATION:".Length)..];
                if (int.TryParse(value, out var duration) && duration > 0)
                    result.TargetDuration = duration;
                continue;
            }

            if (line.StartsWith("#EXT-X-STREAM-INF", StringComparison.OrdinalIgnoreCase))
            {
                var variantLine = GetNextUriLine(lines, i + 1);
                if (!string.IsNullOrEmpty(variantLine))
                {
                    result.IsVariant = true;
                    result.VariantUrls.Add(ToAbsoluteUri(baseUri, variantLine));
                }
                continue;
            }

            if (!line.StartsWith('#'))
            {
                result.SegmentUrls.Add(ToAbsoluteUri(baseUri, line));
            }
        }

        return result;
    }

    private static string? GetNextUriLine(string[] lines, int startIndex)
    {
        for (var i = startIndex; i < lines.Length; i++)
        {
            var current = lines[i];
            if (string.IsNullOrWhiteSpace(current))
                continue;

            if (current.StartsWith('#'))
                continue;

            return current;
        }

        return null;
    }

    private static string ToAbsoluteUri(Uri baseUri, string relativeOrAbsolute)
    {
        if (Uri.TryCreate(relativeOrAbsolute, UriKind.Absolute, out var absoluteUri))
            return absoluteUri.ToString();

        return new Uri(baseUri, relativeOrAbsolute).ToString();
    }

    private async Task<SegmentDownloadResult> DownloadSegmentAsync(string segmentUrl, string segmentFileName, CancellationToken ct)
    {
        try
        {
            using var response = await _httpClient.GetAsync(segmentUrl, HttpCompletionOption.ResponseHeadersRead, ct);

            if (!response.IsSuccessStatusCode)
            {
                var reason = $"segment request returned {(int)response.StatusCode} ({response.StatusCode})";
                Log(reason);

                return new SegmentDownloadResult
                {
                    Success = false,
                    ShouldTriggerSourceRefresh = response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden,
                    FailureReason = reason
                };
            }

            response.EnsureSuccessStatusCode();

            await using var inputStream = await response.Content.ReadAsStreamAsync(ct);
            if (string.IsNullOrWhiteSpace(_recordingSessionName))
                throw new InvalidOperationException("Recording session was not initialized.");

            await _recordingStorageService.SaveSegmentAsync(_recordingSessionName, segmentFileName, inputStream, ct);

            return new SegmentDownloadResult { Success = true };
        }
        catch (OperationCanceledException)
        {
            return new SegmentDownloadResult { Success = false };
        }
        catch (Exception ex)
        {
            Log($"Segment download failed: {ex.Message}");
            return new SegmentDownloadResult
            {
                Success = false,
                FailureReason = ex.Message
            };
        }
    }

    private async Task<bool> TryRefreshSourceAsync(string reason, CancellationToken ct)
    {
        if (_sourceRefreshResolver is null)
            return false;

        if (string.IsNullOrWhiteSpace(_recordingName))
            return false;

        try
        {
            Log($"Refreshing source URL due to: {reason}");

            var refreshedSource = await _sourceRefreshResolver(_recordingName, ct);
            if (string.IsNullOrWhiteSpace(refreshedSource))
            {
                Log("Source refresh returned an empty URL.");
                return false;
            }

            if (!Uri.TryCreate(refreshedSource, UriKind.Absolute, out _))
            {
                Log("Source refresh returned an invalid absolute URL.");
                return false;
            }

            _playlistUrl = refreshedSource;
            _downloadedSegments.Clear();

            Log($"Source URL refreshed successfully. Auto-restart will continue with new URL: {_playlistUrl}");
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return false;
        }
        catch (Exception ex)
        {
            Log($"Source refresh failed: {ex.Message}");
            return false;
        }
    }

    private static async Task WaitAsync(int seconds, CancellationToken ct)
    {
        if (seconds <= 0)
            seconds = DefaultWaitSeconds;

        await Task.Delay(TimeSpan.FromSeconds(seconds), ct);
    }

    private string BuildSegmentFileName(DateTime now)
    {
        var index = Interlocked.Increment(ref _segmentCounter);
        return $"{_recordingFilePrefix}_{now:yyyyMMdd}_{now:HH-mm-ss}_{index:00000}.ts";
    }

    private static string SanitizeFolderName(string name)
    {
        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = string.Concat(name.Trim().Select(c => invalidChars.Contains(c) ? '_' : c));

        return string.IsNullOrWhiteSpace(sanitized)
            ? DateTime.Now.ToString("yyyy-MM-dd")
            : sanitized;
    }

    private void Log(string message)
    {
        _logger.LogInformation("[HLS] {Message}", message);
        OnLog?.Invoke(message);
    }

    private sealed class ParsedPlaylist
    {
        public bool IsVariant { get; set; }
        public int? TargetDuration { get; set; }
        public List<string> VariantUrls { get; } = new();
        public List<string> SegmentUrls { get; } = new();
    }

    private sealed class PlaylistFetchResult
    {
        public ParsedPlaylist? Playlist { get; set; }
        public bool ShouldTriggerSourceRefresh { get; set; }
        public string? FailureReason { get; set; }
    }

    private sealed class SegmentDownloadResult
    {
        public bool Success { get; set; }
        public bool ShouldTriggerSourceRefresh { get; set; }
        public string? FailureReason { get; set; }
    }
}
