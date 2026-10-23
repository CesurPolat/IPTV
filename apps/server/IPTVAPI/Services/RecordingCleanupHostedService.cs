using Microsoft.Extensions.Hosting;
using IPTVAPI.Application.Abstractions;

namespace IPTVAPI.Services;

public class RecordingCleanupHostedService : BackgroundService
{
    private static readonly TimeSpan CleanupInterval = TimeSpan.FromHours(6);
    private static readonly TimeSpan MaxRecordAge = TimeSpan.FromDays(1);

    private readonly ILogger<RecordingCleanupHostedService> _logger;
    private readonly IHlsRecordingStorageService _recordingStorageService;

    public RecordingCleanupHostedService(
        ILogger<RecordingCleanupHostedService> logger,
        IHlsRecordingStorageService recordingStorageService)
    {
        _logger = logger;
        _recordingStorageService = recordingStorageService;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Run once on startup, then periodically.
        await CleanupOldRecordingsAsync(stoppingToken);

        using var timer = new PeriodicTimer(CleanupInterval);
        while (!stoppingToken.IsCancellationRequested && await timer.WaitForNextTickAsync(stoppingToken))
        {
            await CleanupOldRecordingsAsync(stoppingToken);
        }
    }

    private async Task CleanupOldRecordingsAsync(CancellationToken ct)
    {
        try
        {
            var deletedCount = await _recordingStorageService.CleanupOldSegmentsAsync(MaxRecordAge, ct);

            if (deletedCount > 0)
                _logger.LogInformation("Recording cleanup completed. Deleted {Count} file(s) older than 1 day.", deletedCount);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error during recording cleanup.");
        }
    }
}
