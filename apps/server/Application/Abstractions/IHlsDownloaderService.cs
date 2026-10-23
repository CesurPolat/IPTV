namespace IPTVAPI.Application.Abstractions;

public interface IHlsDownloaderService
{
    event Action<string>? OnLog;

    bool IsRecording { get; }
    string? CurrentOutputDirectory { get; }

    Task<string> StartAsync(string playlistUrl, string? recordingName = null, CancellationToken ct = default);
    Task StopAsync(CancellationToken ct = default);
}
