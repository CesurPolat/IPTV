using Google.Apis.Auth.OAuth2;
using Google.Apis.Auth.OAuth2.Flows;
using Google.Apis.Download;
using Google.Apis.Drive.v3;
using Google.Apis.Services;
using IPTVAPI.Application.Abstractions;
using Microsoft.Extensions.Logging;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace IPTVAPI.Infrastructure.Services.Streaming.Storage;

public sealed class GoogleDriveRecordingStorageService : IHlsRecordingStorageService
{
    private const double DefaultSegmentDurationSeconds = 6.0;
    private const string DurationPropertyName = "durationSeconds";
    private const string StartUtcPropertyName = "chunkStartUtc";
    private const string ChunkMetadataSuffix = ".segments.json";
    private static readonly Regex TimestampPattern = new(@"_(\d{8})_(\d{2}-\d{2}-\d{2})", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private readonly DriveService _driveService;
    private readonly string _rootFolderId;
    private readonly ILogger<GoogleDriveRecordingStorageService> _logger;
    private readonly TimeSpan _chunkDuration;
    private readonly string _bufferRootPath;
    private readonly Dictionary<string, string> _sessionFolderIds = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, SessionBufferState> _sessionBuffers = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim _sessionLock = new(1, 1);

    public GoogleDriveRecordingStorageService(
        string clientId,
        string clientSecret,
        string refreshToken,
        string rootFolderId,
        int chunkDurationMinutes,
        ILogger<GoogleDriveRecordingStorageService> logger)
    {
        if (string.IsNullOrWhiteSpace(clientId))
            throw new ArgumentException("Google OAuth client id is required.", nameof(clientId));

        if (string.IsNullOrWhiteSpace(clientSecret))
            throw new ArgumentException("Google OAuth client secret is required.", nameof(clientSecret));

        if (string.IsNullOrWhiteSpace(refreshToken))
            throw new ArgumentException("Google Drive refresh token is required.", nameof(refreshToken));

        if (string.IsNullOrWhiteSpace(rootFolderId))
            throw new ArgumentException("Google Drive folder id is required.", nameof(rootFolderId));

        if (chunkDurationMinutes <= 0)
            throw new ArgumentOutOfRangeException(nameof(chunkDurationMinutes), "Chunk duration must be greater than zero.");

        _logger = logger;
        _rootFolderId = rootFolderId;
        _chunkDuration = TimeSpan.FromMinutes(chunkDurationMinutes);
        _bufferRootPath = Path.Combine("recordings", "buffers");
        Directory.CreateDirectory(_bufferRootPath);

        var flow = new GoogleAuthorizationCodeFlow(new GoogleAuthorizationCodeFlow.Initializer
        {
            ClientSecrets = new ClientSecrets
            {
                ClientId = clientId,
                ClientSecret = clientSecret
            },
            Scopes = [DriveService.Scope.Drive]
        });

        var credential = new UserCredential(flow, "hls-recorder", new Google.Apis.Auth.OAuth2.Responses.TokenResponse
        {
            RefreshToken = refreshToken
        });

        _driveService = new DriveService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "IPTVAPI-HLS-Recorder"
        });
    }

    public async Task<string> InitializeSessionAsync(string sessionName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionName))
            throw new ArgumentException("Session name cannot be empty.", nameof(sessionName));

        await _sessionLock.WaitAsync(ct);
        try
        {
            if (_sessionFolderIds.TryGetValue(sessionName, out var existingFolderId))
                return $"gdrive://{_rootFolderId}/{sessionName} ({existingFolderId})";

            var resolvedExistingFolderId = await FindExistingSessionFolderIdAsync(sessionName, ct);
            if (!string.IsNullOrWhiteSpace(resolvedExistingFolderId))
            {
                _sessionFolderIds[sessionName] = resolvedExistingFolderId;
                _logger.LogInformation("[HLS] Reusing existing Google Drive session folder: {SessionName} ({FolderId})", sessionName, resolvedExistingFolderId);
                return $"gdrive://{_rootFolderId}/{sessionName} ({resolvedExistingFolderId})";
            }

            var folderMetadata = new Google.Apis.Drive.v3.Data.File
            {
                Name = sessionName,
                MimeType = "application/vnd.google-apps.folder",
                Parents = [_rootFolderId]
            };

            var createFolderRequest = _driveService.Files.Create(folderMetadata);
            createFolderRequest.Fields = "id";
            var createdFolder = await createFolderRequest.ExecuteAsync(ct);

            if (string.IsNullOrWhiteSpace(createdFolder?.Id))
                throw new InvalidOperationException("Google Drive session folder could not be created.");

            _sessionFolderIds[sessionName] = createdFolder.Id;
            _logger.LogInformation("[HLS] Google Drive session folder created: {SessionName} ({FolderId})", sessionName, createdFolder.Id);

            return $"gdrive://{_rootFolderId}/{sessionName} ({createdFolder.Id})";
        }
        finally
        {
            _sessionLock.Release();
        }
    }

    public async Task SaveSegmentAsync(string sessionName, string segmentFileName, Stream content, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionName))
            throw new ArgumentException("Session name cannot be empty.", nameof(sessionName));

        if (string.IsNullOrWhiteSpace(segmentFileName))
            throw new ArgumentException("Segment file name cannot be empty.", nameof(segmentFileName));

        if (content is null)
            throw new ArgumentNullException(nameof(content));

        await ResolveSessionFolderIdAsync(sessionName, createIfMissing: true, ct);
        var bufferState = await GetOrCreateBufferStateAsync(sessionName, ct);
        var shouldFlush = false;

        await bufferState.SyncLock.WaitAsync(ct);
        try
        {
            var segmentTimestampUtc = ParseSegmentTimestampUtc(segmentFileName) ?? DateTime.UtcNow;
            var shouldStartNewChunk = bufferState.BufferedSegmentCount == 0 || !File.Exists(bufferState.TempFilePath);

            if (shouldStartNewChunk)
            {
                ResetBufferState(bufferState);
                bufferState.ChunkStartUtc = segmentTimestampUtc;
            }

            var liveSegmentPath = Path.Combine(bufferState.SessionDirectoryPath, segmentFileName);
            await using var segmentCopy = new MemoryStream();
            await content.CopyToAsync(segmentCopy, ct);
            segmentCopy.Position = 0;

            await using (var liveSegmentStream = new FileStream(liveSegmentPath, FileMode.Create, FileAccess.Write, FileShare.Read, 81920, useAsync: true))
            {
                await segmentCopy.CopyToAsync(liveSegmentStream, ct);
            }

            segmentCopy.Position = 0;

            await using (var outputStream = new FileStream(bufferState.TempFilePath, FileMode.Append, FileAccess.Write, FileShare.Read, 81920, useAsync: true))
            {
                await segmentCopy.CopyToAsync(outputStream, ct);
            }

            bufferState.BufferedDuration = bufferState.BufferedDuration.Add(TimeSpan.FromSeconds(DefaultSegmentDurationSeconds));
            bufferState.BufferedSegmentCount++;
            bufferState.LastSegmentUtc = segmentTimestampUtc;
            bufferState.LiveSegments.Add(new LiveSegmentState(segmentFileName, liveSegmentPath, segmentTimestampUtc, segmentCopy.Length));
            var chunkStartUtc = bufferState.ChunkStartUtc ?? segmentTimestampUtc;
            var elapsedDuration = segmentTimestampUtc - chunkStartUtc;
            shouldFlush = bufferState.BufferedDuration >= _chunkDuration || elapsedDuration >= _chunkDuration;
        }
        finally
        {
            bufferState.SyncLock.Release();
        }

        if (shouldFlush)
            await FlushBufferedSessionAsync(sessionName, bufferState, ct);
    }

    public async Task<IReadOnlyList<RecordingSegmentInfo>> ListSegmentsAsync(string sessionName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionName))
            throw new ArgumentException("Session name cannot be empty.", nameof(sessionName));

        var result = new List<RecordingSegmentInfo>();
        result.AddRange(await ListUploadedSegmentsAsync(sessionName, ct));
        result.AddRange(await ListLiveSegmentsAsync(sessionName, ct));

        return result
            .OrderBy(segment => segment.LastModifiedUtc)
            .ThenBy(segment => segment.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<IReadOnlyList<RecordingSegmentInfo>> ListUploadedSegmentsAsync(string sessionName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionName))
            throw new ArgumentException("Session name cannot be empty.", nameof(sessionName));

        var folderId = await ResolveSessionFolderIdAsync(sessionName, createIfMissing: false, ct);
        var result = new List<RecordingSegmentInfo>();

        if (!string.IsNullOrWhiteSpace(folderId))
        {
            var files = await ListSessionFilesAsync(folderId, "name,modifiedTime,appProperties", ct);
            result.AddRange(files
                .Where(file => file.Name?.EndsWith(".ts", StringComparison.OrdinalIgnoreCase) == true)
                .Select(file => new RecordingSegmentInfo(
                    file.Name!,
                    ResolveChunkStartUtc(file),
                    ParseDurationSeconds(file.AppProperties))));
        }

        return result
            .OrderBy(segment => segment.LastModifiedUtc)
            .ThenBy(segment => segment.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<IReadOnlyList<RecordingPlaylistSegmentInfo>> ListUploadedPlaylistSegmentsAsync(string sessionName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionName))
            throw new ArgumentException("Session name cannot be empty.", nameof(sessionName));

        var folderId = await ResolveSessionFolderIdAsync(sessionName, createIfMissing: false, ct);
        if (string.IsNullOrWhiteSpace(folderId))
            return Array.Empty<RecordingPlaylistSegmentInfo>();

        var files = await ListSessionFilesAsync(folderId, "id,name,modifiedTime,appProperties", ct);
        var chunkFiles = files
            .Where(file => file.Name?.EndsWith(".ts", StringComparison.OrdinalIgnoreCase) == true)
            .OrderBy(file => ResolveChunkStartUtc(file))
            .ThenBy(file => file.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var metadataFiles = files
            .Where(file => file.Name?.EndsWith(ChunkMetadataSuffix, StringComparison.OrdinalIgnoreCase) == true && !string.IsNullOrWhiteSpace(file.Id))
            .ToDictionary(file => file.Name!, StringComparer.OrdinalIgnoreCase);

        var playlistSegments = new List<RecordingPlaylistSegmentInfo>();
        foreach (var chunkFile in chunkFiles)
        {
            if (chunkFile.Name is null)
                continue;

            if (metadataFiles.TryGetValue($"{chunkFile.Name}{ChunkMetadataSuffix}", out var metadataFile))
            {
                var chunkSegments = await DownloadChunkMetadataAsync(metadataFile.Id!, ct);
                if (chunkSegments.Count > 0)
                {
                    playlistSegments.AddRange(chunkSegments.Select(segment => new RecordingPlaylistSegmentInfo(
                        chunkFile.Name,
                        segment.TimestampUtc,
                        segment.DurationSeconds,
                        segment.ByteLength,
                        segment.ByteOffset)));
                    continue;
                }
            }

            playlistSegments.Add(new RecordingPlaylistSegmentInfo(
                chunkFile.Name,
                ResolveChunkStartUtc(chunkFile),
                ParseDurationSeconds(chunkFile.AppProperties),
                null,
                null));
        }

        return playlistSegments;
    }

    public async Task<IReadOnlyList<RecordingSegmentInfo>> ListLiveSegmentsAsync(string sessionName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionName))
            throw new ArgumentException("Session name cannot be empty.", nameof(sessionName));

        var result = await GetActiveLiveSegmentsAsync(sessionName, ct);
        return result
            .OrderBy(segment => segment.LastModifiedUtc)
            .ThenBy(segment => segment.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<RecordingSegmentReadResult?> OpenSegmentReadAsync(
        string sessionName,
        string segmentFileName,
        long? rangeStart = null,
        long? rangeEnd = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionName))
            throw new ArgumentException("Session name cannot be empty.", nameof(sessionName));

        if (string.IsNullOrWhiteSpace(segmentFileName))
            throw new ArgumentException("Segment file name cannot be empty.", nameof(segmentFileName));

        var activeLiveSegmentStream = await TryOpenActiveLiveSegmentReadAsync(sessionName, segmentFileName, rangeStart, rangeEnd, ct);
        if (activeLiveSegmentStream is not null)
            return activeLiveSegmentStream;

        var folderId = await ResolveSessionFolderIdAsync(sessionName, createIfMissing: false, ct);
        if (string.IsNullOrWhiteSpace(folderId))
            return null;

        var escapedSegmentName = segmentFileName.Replace("'", "\\'", StringComparison.Ordinal);
        var escapedFolderId = folderId.Replace("'", "\\'", StringComparison.Ordinal);

        var listRequest = _driveService.Files.List();
        listRequest.Q =
            $"name = '{escapedSegmentName}' and '{escapedFolderId}' in parents and trashed = false";
        listRequest.Fields = "files(id,name,modifiedTime,size)";
        listRequest.OrderBy = "modifiedTime desc";
        listRequest.PageSize = 1;

        var listResponse = await listRequest.ExecuteAsync(ct);
        var file = listResponse.Files?.FirstOrDefault();
        var fileId = file?.Id;
        if (string.IsNullOrWhiteSpace(fileId))
            return null;

        var totalLength = file?.Size ?? 0;

        var downloadRequest = _driveService.Files.Get(fileId);
        var output = new MemoryStream();
        Google.Apis.Download.IDownloadProgress status;

        if (rangeStart.HasValue || rangeEnd.HasValue)
        {
            var (actualStart, actualEnd) = ResolveRange(totalLength, rangeStart, rangeEnd);
            status = await downloadRequest.DownloadRangeAsync(output, new RangeHeaderValue(actualStart, actualEnd), ct);
            if (status.Status != DownloadStatus.Completed)
            {
                output.Dispose();
                throw new InvalidOperationException($"Google Drive segment download failed: {status.Exception?.Message ?? status.Status.ToString()}");
            }

            output.Position = 0;
            return new RecordingSegmentReadResult(
                output,
                totalLength,
                actualEnd - actualStart + 1,
                true,
                actualStart,
                actualEnd);
        }

        status = await downloadRequest.DownloadAsync(output, ct);

        if (status.Status != DownloadStatus.Completed)
        {
            output.Dispose();
            throw new InvalidOperationException($"Google Drive segment download failed: {status.Exception?.Message ?? status.Status.ToString()}");
        }

        output.Position = 0;
        return new RecordingSegmentReadResult(output, totalLength, output.Length, false, null, null);
    }

    public async Task FlushSessionAsync(string sessionName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionName))
            return;

        SessionBufferState? bufferState;

        await _sessionLock.WaitAsync(ct);
        try
        {
            _sessionBuffers.TryGetValue(sessionName, out bufferState);
        }
        finally
        {
            _sessionLock.Release();
        }

        if (bufferState is null)
            return;

        await FlushBufferedSessionAsync(sessionName, bufferState, ct);
    }

    public async Task<int> CleanupOldSegmentsAsync(TimeSpan maxRecordAge, CancellationToken ct = default)
    {
        var deletedCount = 0;
        var cutoffUtc = DateTime.UtcNow - maxRecordAge;
        var cutoffRfc3339 = cutoffUtc.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

        var sessionFolderRequest = _driveService.Files.List();
        sessionFolderRequest.Q =
            $"'{_rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
        sessionFolderRequest.Fields = "nextPageToken,files(id,name)";
        sessionFolderRequest.PageSize = 1000;

        do
        {
            var folderResponse = await sessionFolderRequest.ExecuteAsync(ct);
            var folders = folderResponse.Files ?? [];

            foreach (var folder in folders)
            {
                if (ct.IsCancellationRequested)
                    return deletedCount;

                if (string.IsNullOrWhiteSpace(folder.Id))
                    continue;

                deletedCount += await DeleteOldFilesInFolderAsync(folder.Id, cutoffRfc3339, ct);
                await DeleteFolderIfEmptyAsync(folder.Id, ct);
            }

            sessionFolderRequest.PageToken = folderResponse.NextPageToken;
        }
        while (!string.IsNullOrWhiteSpace(sessionFolderRequest.PageToken));

        return deletedCount;
    }

    private async Task<string?> FindExistingSessionFolderIdAsync(string sessionName, CancellationToken ct)
    {
        var escapedSessionName = sessionName.Replace("'", "\\'", StringComparison.Ordinal);
        var escapedRootFolderId = _rootFolderId.Replace("'", "\\'", StringComparison.Ordinal);

        var listRequest = _driveService.Files.List();
        listRequest.Q =
            $"name = '{escapedSessionName}' and '{escapedRootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
        listRequest.Fields = "files(id,name),nextPageToken";
        listRequest.PageSize = 1;

        var result = await listRequest.ExecuteAsync(ct);
        return result.Files?.FirstOrDefault()?.Id;
    }

    private async Task<string?> ResolveSessionFolderIdAsync(string sessionName, bool createIfMissing, CancellationToken ct)
    {
        await _sessionLock.WaitAsync(ct);
        try
        {
            if (_sessionFolderIds.TryGetValue(sessionName, out var folderId))
                return folderId;
        }
        finally
        {
            _sessionLock.Release();
        }

        var existingFolderId = await FindExistingSessionFolderIdAsync(sessionName, ct);
        if (!string.IsNullOrWhiteSpace(existingFolderId))
        {
            await _sessionLock.WaitAsync(ct);
            try
            {
                _sessionFolderIds[sessionName] = existingFolderId;
            }
            finally
            {
                _sessionLock.Release();
            }

            return existingFolderId;
        }

        if (!createIfMissing)
            return null;

        await InitializeSessionAsync(sessionName, ct);

        await _sessionLock.WaitAsync(ct);
        try
        {
            return _sessionFolderIds.TryGetValue(sessionName, out var folderId) ? folderId : null;
        }
        finally
        {
            _sessionLock.Release();
        }
    }

    private async Task<SessionBufferState> GetOrCreateBufferStateAsync(string sessionName, CancellationToken ct)
    {
        await _sessionLock.WaitAsync(ct);
        try
        {
            if (_sessionBuffers.TryGetValue(sessionName, out var existingState))
                return existingState;

            var sessionDirectoryPath = Path.Combine(_bufferRootPath, SanitizePathPart(sessionName));
            Directory.CreateDirectory(sessionDirectoryPath);
            DeleteTempBuffers(sessionDirectoryPath);
            var bufferPath = Path.Combine(sessionDirectoryPath, $"{SanitizePathPart(sessionName)}_{Guid.NewGuid():N}.tsbuffer");
            var state = new SessionBufferState(sessionDirectoryPath, bufferPath);
            _sessionBuffers[sessionName] = state;
            return state;
        }
        finally
        {
            _sessionLock.Release();
        }
    }

    private async Task FlushBufferedSessionAsync(string sessionName, SessionBufferState bufferState, CancellationToken ct)
    {
        await bufferState.SyncLock.WaitAsync(ct);
        try
        {
            if (bufferState.BufferedSegmentCount == 0 || !File.Exists(bufferState.TempFilePath))
                return;

            var tempFilePathToUpload = bufferState.TempFilePath;
            var chunkStartUtc = bufferState.ChunkStartUtc ?? DateTime.UtcNow;
            var chunkEndUtc = bufferState.LastSegmentUtc ?? chunkStartUtc;
            var durationSeconds = bufferState.BufferedDuration.TotalSeconds;
            var uploadFileName = BuildChunkFileName(sessionName, chunkStartUtc, chunkEndUtc);
            var folderId = await ResolveSessionFolderIdAsync(sessionName, createIfMissing: true, ct);
            if (string.IsNullOrWhiteSpace(folderId))
                throw new InvalidOperationException("Google Drive session folder is missing.");

            await using var uploadStream = File.OpenRead(tempFilePathToUpload);
            var fileMetadata = new Google.Apis.Drive.v3.Data.File
            {
                Name = uploadFileName,
                Parents = [folderId],
                AppProperties = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    [DurationPropertyName] = durationSeconds.ToString(CultureInfo.InvariantCulture),
                    [StartUtcPropertyName] = chunkStartUtc.ToString("O", CultureInfo.InvariantCulture)
                }
            };

            var uploadRequest = _driveService.Files.Create(fileMetadata, uploadStream, "video/mp2t");
            uploadRequest.Fields = "id";

            _logger.LogInformation(
                "[HLS] Uploading Google Drive chunk for session {SessionName}: {FileName} ({DurationSeconds:0.0}s)",
                sessionName,
                uploadFileName,
                durationSeconds);

            var uploadResult = await uploadRequest.UploadAsync(ct);
            if (uploadResult.Status != Google.Apis.Upload.UploadStatus.Completed)
                throw new InvalidOperationException($"Google Drive segment upload failed: {uploadResult.Exception?.Message ?? uploadResult.Status.ToString()}");

            try
            {
                await UploadChunkMetadataAsync(folderId, uploadFileName, bufferState.LiveSegments, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "[HLS] Google Drive chunk metadata upload failed for session {SessionName}: {FileName}",
                    sessionName,
                    uploadFileName);
            }

            _logger.LogInformation(
                "[HLS] Uploaded Google Drive chunk for session {SessionName}: {FileName} ({DurationSeconds:0.0}s)",
                sessionName,
                uploadFileName,
                durationSeconds);

            DeleteLiveSegments(bufferState.LiveSegments);
            TryDeleteTempFile(tempFilePathToUpload);
            bufferState.TempFilePath = Path.Combine(bufferState.SessionDirectoryPath, $"{SanitizePathPart(sessionName)}_{Guid.NewGuid():N}.tsbuffer");
            DeleteTempBuffers(bufferState.SessionDirectoryPath, bufferState.TempFilePath);
            ResetBufferState(bufferState);
        }
        finally
        {
            bufferState.SyncLock.Release();
        }
    }

    private async Task<IReadOnlyList<RecordingSegmentInfo>> GetActiveLiveSegmentsAsync(string sessionName, CancellationToken ct)
    {
        SessionBufferState? bufferState;

        await _sessionLock.WaitAsync(ct);
        try
        {
            _sessionBuffers.TryGetValue(sessionName, out bufferState);
        }
        finally
        {
            _sessionLock.Release();
        }

        if (bufferState is null)
            return Array.Empty<RecordingSegmentInfo>();

        await bufferState.SyncLock.WaitAsync(ct);
        try
        {
            return bufferState.LiveSegments
                .Where(segment => File.Exists(segment.Path))
                .Select(segment => new RecordingSegmentInfo(segment.Name, segment.TimestampUtc, DefaultSegmentDurationSeconds))
                .ToList();
        }
        finally
        {
            bufferState.SyncLock.Release();
        }
    }

    private async Task<RecordingSegmentReadResult?> TryOpenActiveLiveSegmentReadAsync(
        string sessionName,
        string segmentFileName,
        long? rangeStart,
        long? rangeEnd,
        CancellationToken ct)
    {
        SessionBufferState? bufferState;

        await _sessionLock.WaitAsync(ct);
        try
        {
            _sessionBuffers.TryGetValue(sessionName, out bufferState);
        }
        finally
        {
            _sessionLock.Release();
        }

        if (bufferState is null)
            return null;

        await bufferState.SyncLock.WaitAsync(ct);
        try
        {
            var liveSegment = bufferState.LiveSegments
                .LastOrDefault(segment => string.Equals(segment.Name, segmentFileName, StringComparison.OrdinalIgnoreCase));

            if (liveSegment is null || !File.Exists(liveSegment.Path))
                return null;

            var fileInfo = new FileInfo(liveSegment.Path);
            if (fileInfo.Length <= 0)
            {
                Stream emptyStream = new FileStream(liveSegment.Path, FileMode.Open, FileAccess.Read, FileShare.Read);
                return new RecordingSegmentReadResult(emptyStream, 0, 0, false, null, null);
            }

            if (!rangeStart.HasValue && !rangeEnd.HasValue)
            {
                Stream fullStream = new FileStream(liveSegment.Path, FileMode.Open, FileAccess.Read, FileShare.Read);
                return new RecordingSegmentReadResult(fullStream, fileInfo.Length, fileInfo.Length, false, null, null);
            }

            var (actualStart, actualEnd) = ResolveRange(fileInfo.Length, rangeStart, rangeEnd);
            var rangedStream = new FileStream(liveSegment.Path, FileMode.Open, FileAccess.Read, FileShare.Read);
            rangedStream.Seek(actualStart, SeekOrigin.Begin);
            Stream limitedStream = new RangeLimitedStream(rangedStream, actualEnd - actualStart + 1);

            return new RecordingSegmentReadResult(
                limitedStream,
                fileInfo.Length,
                actualEnd - actualStart + 1,
                true,
                actualStart,
                actualEnd);
        }
        finally
        {
            bufferState.SyncLock.Release();
        }
    }

    private async Task<int> DeleteOldFilesInFolderAsync(string folderId, string cutoffRfc3339, CancellationToken ct)
    {
        var deletedCount = 0;

        var oldFilesRequest = _driveService.Files.List();
        oldFilesRequest.Q =
            $"'{folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and modifiedTime < '{cutoffRfc3339}' and trashed = false";
        oldFilesRequest.Fields = "nextPageToken,files(id,name)";
        oldFilesRequest.PageSize = 1000;

        do
        {
            var oldFilesResponse = await oldFilesRequest.ExecuteAsync(ct);
            var files = oldFilesResponse.Files ?? [];

            foreach (var file in files)
            {
                if (ct.IsCancellationRequested)
                    return deletedCount;

                if (string.IsNullOrWhiteSpace(file.Id))
                    continue;

                await _driveService.Files.Delete(file.Id).ExecuteAsync(ct);
                deletedCount++;
            }

            oldFilesRequest.PageToken = oldFilesResponse.NextPageToken;
        }
        while (!string.IsNullOrWhiteSpace(oldFilesRequest.PageToken));

        return deletedCount;
    }

    private async Task DeleteFolderIfEmptyAsync(string folderId, CancellationToken ct)
    {
        var hasFilesRequest = _driveService.Files.List();
        hasFilesRequest.Q = $"'{folderId}' in parents and trashed = false";
        hasFilesRequest.Fields = "files(id)";
        hasFilesRequest.PageSize = 1;

        var hasFilesResponse = await hasFilesRequest.ExecuteAsync(ct);
        if ((hasFilesResponse.Files?.Count ?? 0) > 0)
            return;

        await _driveService.Files.Delete(folderId).ExecuteAsync(ct);
    }

    private static DateTime ResolveChunkStartUtc(Google.Apis.Drive.v3.Data.File file)
    {
        if (file.AppProperties is not null &&
            file.AppProperties.TryGetValue(StartUtcPropertyName, out var value) &&
            DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsedUtc))
        {
            return parsedUtc.ToUniversalTime();
        }

        return ParseSegmentTimestampUtc(file.Name!) ??
               file.ModifiedTimeDateTimeOffset?.UtcDateTime ??
               DateTime.UtcNow;
    }

    private static double ParseDurationSeconds(IDictionary<string, string>? appProperties)
    {
        if (appProperties is not null &&
            appProperties.TryGetValue(DurationPropertyName, out var rawDuration) &&
            double.TryParse(rawDuration, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedDuration) &&
            parsedDuration > 0)
        {
            return parsedDuration;
        }

        return DefaultSegmentDurationSeconds;
    }

    private static DateTime? ParseSegmentTimestampUtc(string fileName)
    {
        var match = TimestampPattern.Match(fileName);
        if (!match.Success)
            return null;

        if (DateTime.TryParseExact(
            $"{match.Groups[1].Value}_{match.Groups[2].Value}",
            "yyyyMMdd_HH-mm-ss",
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeLocal,
            out var parsedLocal))
        {
            return parsedLocal.ToUniversalTime();
        }

        return null;
    }

    private static string BuildChunkFileName(string sessionName, DateTime chunkStartUtc, DateTime chunkEndUtc)
    {
        var localStart = chunkStartUtc.ToLocalTime();
        var localEnd = chunkEndUtc.ToLocalTime();
        return $"{sessionName}_{localStart:yyyyMMdd}_{localStart:HH-mm-ss}_{localEnd:HH-mm-ss}.ts";
    }

    private static string SanitizePathPart(string value)
    {
        var invalidChars = Path.GetInvalidFileNameChars();
        return string.Concat(value.Select(c => invalidChars.Contains(c) ? '_' : c));
    }

    private static void ResetBufferState(SessionBufferState bufferState)
    {
        bufferState.BufferedDuration = TimeSpan.Zero;
        bufferState.BufferedSegmentCount = 0;
        bufferState.ChunkStartUtc = null;
        bufferState.LastSegmentUtc = null;
        bufferState.LiveSegments.Clear();
    }

    private static void TryDeleteTempFile(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch
        {
            // Temporary buffer cleanup is best-effort only.
        }
    }

    private static void DeleteLiveSegments(IEnumerable<LiveSegmentState> liveSegments)
    {
        foreach (var liveSegment in liveSegments)
        {
            TryDeleteTempFile(liveSegment.Path);
        }
    }

    private static void DeleteTempBuffers(string sessionDirectoryPath, string? excludedPath = null)
    {
        if (!Directory.Exists(sessionDirectoryPath))
            return;

        foreach (var bufferPath in Directory.EnumerateFiles(sessionDirectoryPath, "*.tsbuffer", SearchOption.TopDirectoryOnly))
        {
            if (!string.IsNullOrWhiteSpace(excludedPath) &&
                string.Equals(
                    Path.GetFullPath(bufferPath),
                    Path.GetFullPath(excludedPath),
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            TryDeleteTempFile(bufferPath);
        }
    }

    private static (long Start, long End) ResolveRange(long totalLength, long? rangeStart, long? rangeEnd)
    {
        if (totalLength <= 0)
            return (0, 0);

        long start;
        long end;

        if (rangeStart.HasValue)
        {
            start = Math.Clamp(rangeStart.Value, 0, totalLength - 1);
            end = rangeEnd.HasValue
                ? Math.Clamp(rangeEnd.Value, start, totalLength - 1)
                : totalLength - 1;
        }
        else
        {
            var suffixLength = Math.Clamp(rangeEnd ?? totalLength, 1, totalLength);
            start = totalLength - suffixLength;
            end = totalLength - 1;
        }

        return (start, end);
    }

    private async Task<IReadOnlyList<Google.Apis.Drive.v3.Data.File>> ListSessionFilesAsync(string folderId, string fields, CancellationToken ct)
    {
        var request = _driveService.Files.List();
        request.Q =
            $"'{folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false";
        request.Fields = $"nextPageToken,files({fields})";
        request.PageSize = 1000;

        var files = new List<Google.Apis.Drive.v3.Data.File>();
        do
        {
            var response = await request.ExecuteAsync(ct);
            if (response.Files is not null)
                files.AddRange(response.Files);

            request.PageToken = response.NextPageToken;
        }
        while (!string.IsNullOrWhiteSpace(request.PageToken));

        return files;
    }

    private async Task UploadChunkMetadataAsync(
        string folderId,
        string uploadFileName,
        IReadOnlyList<LiveSegmentState> liveSegments,
        CancellationToken ct)
    {
        if (liveSegments.Count == 0)
            return;

        long byteOffset = 0;
        var chunkMetadata = liveSegments.Select(segment =>
        {
            var metadata = new ChunkSegmentMetadata(segment.TimestampUtc, DefaultSegmentDurationSeconds, byteOffset, segment.ByteLength);
            byteOffset += segment.ByteLength;
            return metadata;
        }).ToList();

        await using var metadataStream = new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(chunkMetadata));
        var metadataFile = new Google.Apis.Drive.v3.Data.File
        {
            Name = $"{uploadFileName}{ChunkMetadataSuffix}",
            Parents = [folderId]
        };

        var metadataUploadRequest = _driveService.Files.Create(metadataFile, metadataStream, "application/json");
        metadataUploadRequest.Fields = "id";

        var metadataUploadResult = await metadataUploadRequest.UploadAsync(ct);
        if (metadataUploadResult.Status != Google.Apis.Upload.UploadStatus.Completed)
            throw new InvalidOperationException($"Google Drive chunk metadata upload failed: {metadataUploadResult.Exception?.Message ?? metadataUploadResult.Status.ToString()}");
    }

    private async Task<IReadOnlyList<ChunkSegmentMetadata>> DownloadChunkMetadataAsync(string fileId, CancellationToken ct)
    {
        var request = _driveService.Files.Get(fileId);
        await using var output = new MemoryStream();
        var status = await request.DownloadAsync(output, ct);
        if (status.Status != DownloadStatus.Completed)
            throw new InvalidOperationException($"Google Drive chunk metadata download failed: {status.Exception?.Message ?? status.Status.ToString()}");

        output.Position = 0;
        var metadata = await JsonSerializer.DeserializeAsync<List<ChunkSegmentMetadata>>(output, cancellationToken: ct);
        return metadata is not null ? metadata : Array.Empty<ChunkSegmentMetadata>();
    }

    private sealed class SessionBufferState
    {
        public SessionBufferState(string sessionDirectoryPath, string tempFilePath)
        {
            SessionDirectoryPath = sessionDirectoryPath;
            TempFilePath = tempFilePath;
        }

        public SemaphoreSlim SyncLock { get; } = new(1, 1);
        public string SessionDirectoryPath { get; }
        public string TempFilePath { get; set; }
        public TimeSpan BufferedDuration { get; set; }
        public int BufferedSegmentCount { get; set; }
        public DateTime? ChunkStartUtc { get; set; }
        public DateTime? LastSegmentUtc { get; set; }
        public List<LiveSegmentState> LiveSegments { get; } = new();
    }

    private sealed record LiveSegmentState(string Name, string Path, DateTime TimestampUtc, long ByteLength);
    private sealed record ChunkSegmentMetadata(DateTime TimestampUtc, double DurationSeconds, long ByteOffset, long ByteLength);

    private sealed class RangeLimitedStream : Stream
    {
        private readonly Stream _innerStream;
        private long _remainingBytes;

        public RangeLimitedStream(Stream innerStream, long length)
        {
            _innerStream = innerStream;
            _remainingBytes = Math.Max(0, length);
        }

        public override bool CanRead => _innerStream.CanRead;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => _remainingBytes;
        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override void Flush()
        {
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            if (_remainingBytes <= 0)
                return 0;

            var bytesToRead = (int)Math.Min(count, _remainingBytes);
            var read = _innerStream.Read(buffer, offset, bytesToRead);
            _remainingBytes -= read;
            return read;
        }

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            if (_remainingBytes <= 0)
                return 0;

            var bytesToRead = (int)Math.Min(buffer.Length, _remainingBytes);
            var read = await _innerStream.ReadAsync(buffer[..bytesToRead], cancellationToken);
            _remainingBytes -= read;
            return read;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
                _innerStream.Dispose();

            base.Dispose(disposing);
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
