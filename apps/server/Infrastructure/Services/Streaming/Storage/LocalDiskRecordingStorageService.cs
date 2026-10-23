using IPTVAPI.Application.Abstractions;

namespace IPTVAPI.Infrastructure.Services.Streaming.Storage;

public sealed class LocalDiskRecordingStorageService : IHlsRecordingStorageService
{
    private const double DefaultSegmentDurationSeconds = 6.0;
    private readonly Dictionary<string, string> _sessionDirectories = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim _sessionLock = new(1, 1);

    public async Task<string> InitializeSessionAsync(string sessionName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionName))
            throw new ArgumentException("Session name cannot be empty.", nameof(sessionName));

        var directory = Path.Combine("recordings", sessionName);
        Directory.CreateDirectory(directory);

        await _sessionLock.WaitAsync(ct);
        try
        {
            _sessionDirectories[sessionName] = directory;
        }
        finally
        {
            _sessionLock.Release();
        }

        return directory;
    }

    public async Task SaveSegmentAsync(string sessionName, string segmentFileName, Stream content, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionName))
            throw new ArgumentException("Session name cannot be empty.", nameof(sessionName));

        if (string.IsNullOrWhiteSpace(segmentFileName))
            throw new ArgumentException("Segment file name cannot be empty.", nameof(segmentFileName));

        if (content is null)
            throw new ArgumentNullException(nameof(content));

        string directory;

        await _sessionLock.WaitAsync(ct);
        try
        {
            if (!_sessionDirectories.TryGetValue(sessionName, out directory!))
            {
                directory = Path.Combine("recordings", sessionName);
                Directory.CreateDirectory(directory);
                _sessionDirectories[sessionName] = directory;
            }
        }
        finally
        {
            _sessionLock.Release();
        }

        var filePath = Path.Combine(directory, segmentFileName);
        await using var outputStream = File.Create(filePath);
        await content.CopyToAsync(outputStream, ct);
    }

    public Task<IReadOnlyList<RecordingSegmentInfo>> ListSegmentsAsync(string sessionName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionName))
            throw new ArgumentException("Session name cannot be empty.", nameof(sessionName));

        var directory = GetSessionDirectory(sessionName);
        if (!Directory.Exists(directory))
            return Task.FromResult<IReadOnlyList<RecordingSegmentInfo>>(Array.Empty<RecordingSegmentInfo>());

        var segments = Directory
            .EnumerateFiles(directory, "*.ts", SearchOption.TopDirectoryOnly)
            .Select(path => new FileInfo(path))
            .Select(file => new RecordingSegmentInfo(file.Name, file.LastWriteTimeUtc, DefaultSegmentDurationSeconds))
            .OrderBy(segment => segment.LastModifiedUtc)
            .ThenBy(segment => segment.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Task.FromResult<IReadOnlyList<RecordingSegmentInfo>>(segments);
    }

    public Task<IReadOnlyList<RecordingSegmentInfo>> ListUploadedSegmentsAsync(string sessionName, CancellationToken ct = default)
    {
        return ListSegmentsAsync(sessionName, ct);
    }

    public async Task<IReadOnlyList<RecordingPlaylistSegmentInfo>> ListUploadedPlaylistSegmentsAsync(string sessionName, CancellationToken ct = default)
    {
        var segments = await ListUploadedSegmentsAsync(sessionName, ct);
        return segments
            .Select(segment => new RecordingPlaylistSegmentInfo(
                segment.Name,
                segment.LastModifiedUtc,
                segment.DurationSeconds,
                null,
                null))
            .ToList();
    }

    public Task<IReadOnlyList<RecordingSegmentInfo>> ListLiveSegmentsAsync(string sessionName, CancellationToken ct = default)
    {
        return ListSegmentsAsync(sessionName, ct);
    }

    public Task<RecordingSegmentReadResult?> OpenSegmentReadAsync(
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

        var directory = GetSessionDirectory(sessionName);
        var fullDirectoryPath = Path.GetFullPath(directory);
        var fullSegmentPath = Path.GetFullPath(Path.Combine(fullDirectoryPath, segmentFileName));

        if (!fullSegmentPath.StartsWith(fullDirectoryPath, StringComparison.OrdinalIgnoreCase))
            return Task.FromResult<RecordingSegmentReadResult?>(null);

        if (!File.Exists(fullSegmentPath))
            return Task.FromResult<RecordingSegmentReadResult?>(null);

        var fileInfo = new FileInfo(fullSegmentPath);
        if (fileInfo.Length <= 0)
        {
            Stream emptyStream = File.OpenRead(fullSegmentPath);
            return Task.FromResult<RecordingSegmentReadResult?>(new RecordingSegmentReadResult(emptyStream, 0, 0, false, null, null));
        }

        if (!rangeStart.HasValue && !rangeEnd.HasValue)
        {
            Stream fullStream = File.OpenRead(fullSegmentPath);
            return Task.FromResult<RecordingSegmentReadResult?>(new RecordingSegmentReadResult(fullStream, fileInfo.Length, fileInfo.Length, false, null, null));
        }

        var (actualStart, actualEnd) = ResolveRange(fileInfo.Length, rangeStart, rangeEnd);
        var rangedStream = File.OpenRead(fullSegmentPath);
        rangedStream.Seek(actualStart, SeekOrigin.Begin);

        Stream limitedStream = new RangeLimitedStream(rangedStream, actualEnd - actualStart + 1);
        return Task.FromResult<RecordingSegmentReadResult?>(new RecordingSegmentReadResult(
            limitedStream,
            fileInfo.Length,
            actualEnd - actualStart + 1,
            true,
            actualStart,
            actualEnd));
    }

    public Task FlushSessionAsync(string sessionName, CancellationToken ct = default)
    {
        return Task.CompletedTask;
    }

    public Task<int> CleanupOldSegmentsAsync(TimeSpan maxRecordAge, CancellationToken ct = default)
    {
        var recordingsRoot = Path.GetFullPath("recordings");
        if (!Directory.Exists(recordingsRoot))
            return Task.FromResult(0);

        var cutoff = DateTime.UtcNow - maxRecordAge;
        var deletedCount = 0;

        foreach (var filePath in Directory.EnumerateFiles(recordingsRoot, "*.ts", SearchOption.AllDirectories))
        {
            if (ct.IsCancellationRequested)
                break;

            try
            {
                var lastWriteUtc = File.GetLastWriteTimeUtc(filePath);
                if (lastWriteUtc < cutoff)
                {
                    File.Delete(filePath);
                    deletedCount++;
                }
            }
            catch
            {
                // File-level failures are handled by caller logs; continue cleanup pass.
            }
        }

        DeleteEmptyDirectories(recordingsRoot);
        return Task.FromResult(deletedCount);
    }

    private string GetSessionDirectory(string sessionName)
    {
        if (_sessionDirectories.TryGetValue(sessionName, out var directory))
            return directory;

        return Path.Combine("recordings", sessionName);
    }

    private static void DeleteEmptyDirectories(string rootPath)
    {
        foreach (var directory in Directory.EnumerateDirectories(rootPath, "*", SearchOption.AllDirectories)
                     .OrderByDescending(d => d.Length))
        {
            try
            {
                if (!Directory.EnumerateFileSystemEntries(directory).Any())
                    Directory.Delete(directory);
            }
            catch
            {
                // Best-effort cleanup only.
            }
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
