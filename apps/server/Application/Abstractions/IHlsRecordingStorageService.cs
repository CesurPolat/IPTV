namespace IPTVAPI.Application.Abstractions;

public interface IHlsRecordingStorageService
{
    Task<string> InitializeSessionAsync(string sessionName, CancellationToken ct = default);
    Task SaveSegmentAsync(string sessionName, string segmentFileName, Stream content, CancellationToken ct = default);
    Task<IReadOnlyList<RecordingSegmentInfo>> ListSegmentsAsync(string sessionName, CancellationToken ct = default);
    Task<IReadOnlyList<RecordingSegmentInfo>> ListUploadedSegmentsAsync(string sessionName, CancellationToken ct = default);
    Task<IReadOnlyList<RecordingPlaylistSegmentInfo>> ListUploadedPlaylistSegmentsAsync(string sessionName, CancellationToken ct = default);
    Task<IReadOnlyList<RecordingSegmentInfo>> ListLiveSegmentsAsync(string sessionName, CancellationToken ct = default);
    Task<RecordingSegmentReadResult?> OpenSegmentReadAsync(
        string sessionName,
        string segmentFileName,
        long? rangeStart = null,
        long? rangeEnd = null,
        CancellationToken ct = default);
    Task FlushSessionAsync(string sessionName, CancellationToken ct = default);
    Task<int> CleanupOldSegmentsAsync(TimeSpan maxRecordAge, CancellationToken ct = default);
}

public sealed record RecordingSegmentInfo(string Name, DateTime LastModifiedUtc, double DurationSeconds);
public sealed record RecordingPlaylistSegmentInfo(
    string Name,
    DateTime LastModifiedUtc,
    double DurationSeconds,
    long? ByteRangeLength,
    long? ByteRangeOffset);
public sealed record RecordingSegmentReadResult(
    Stream Stream,
    long TotalLength,
    long ContentLength,
    bool IsPartial,
    long? RangeStart,
    long? RangeEnd);
