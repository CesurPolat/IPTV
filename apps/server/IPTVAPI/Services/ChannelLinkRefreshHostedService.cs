using Application.Abstractions;
using Application.Constants;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Hosting;

namespace IPTVAPI.Services;

public class ChannelLinkRefreshHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IMemoryCache _cache;
    private readonly ILogger<ChannelLinkRefreshHostedService> _logger;
    private readonly TimeSpan _refreshInterval;

    public ChannelLinkRefreshHostedService(
        IServiceScopeFactory scopeFactory,
        IMemoryCache cache,
        ILogger<ChannelLinkRefreshHostedService> logger,
        IConfiguration configuration)
    {
        _scopeFactory = scopeFactory;
        _cache = cache;
        _logger = logger;

        var configuredMinutes = configuration.GetValue<int?>("Recording:ChannelLinkRefresh:IntervalMinutes") ?? 20;
        _refreshInterval = TimeSpan.FromMinutes(Math.Max(configuredMinutes, 1));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RefreshChannelsAsync(stoppingToken);

        using var timer = new PeriodicTimer(_refreshInterval);
        while (!stoppingToken.IsCancellationRequested && await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RefreshChannelsAsync(stoppingToken);
        }
    }

    private async Task RefreshChannelsAsync(CancellationToken ct)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var iptvService = scope.ServiceProvider.GetRequiredService<IIPTVService>();

            var channels = (await iptvService.GetChannelsAsync()).ToList();
            _cache.Set(
                CacheKeys.IPTVChannels,
                channels,
                new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(4)
                });

            _logger.LogInformation("Channel link refresh completed. Refreshed {Count} channel source(s).", channels.Count);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Ignore cancellation during graceful shutdown.
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Channel link refresh failed.");
        }
    }
}
