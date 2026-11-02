using Application.Abstractions;
using Infrastructure.Services.BroadcastScheduleServices;
using IPTVAPI.Application.Abstractions;
using IPTVAPI.Infrastructure.Services.ArchillectTV;
using IPTVAPI.Infrastructure.Services.SocketIO;
using IPTVAPI.Infrastructure.Services.Streaming;
using IPTVAPI.Infrastructure.Services.Streaming.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Infrastructure
{
    public static class DependencyInjection
    {
        public static void AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
        {
            services.AddTransient<IBroadcastScheduleService, BroadcastScheduleService>();
            services.AddKeyedTransient<IStreamingService, DizipalService>("Dizipal");
            services.AddKeyedTransient<IStreamingService, RoketdiziService>("Roketdizi");
            services.AddSingleton<Infrastructure.Services.Streaming.Shortizle.ShortizleService>();
            services.AddSingleton<IShortizleResolver>(sp => sp.GetRequiredService<Infrastructure.Services.Streaming.Shortizle.ShortizleService>());
            services.AddSingleton<IShortizlePlayback>(sp => sp.GetRequiredService<Infrastructure.Services.Streaming.Shortizle.ShortizleService>());
            services.AddSingleton<IShortizleCatalog, Infrastructure.Services.Streaming.Shortizle.ShortizleCatalogService>();
            services.AddSingleton<LocalDiskRecordingStorageService>();
            services.AddSingleton<GoogleDriveRecordingStorageService>(provider =>
            {
                var clientId = configuration["GoogleOAuth:ClientId"];
                var clientSecret = configuration["GoogleOAuth:ClientSecret"];
                var refreshToken = configuration["Storage:GoogleDrive:RefreshToken"];
                var folderId = configuration["Storage:GoogleDrive:FolderId"];
                var chunkDurationMinutes = int.TryParse(configuration["Storage:GoogleDrive:ChunkDurationMinutes"], out var parsedChunkDurationMinutes)
                    ? parsedChunkDurationMinutes
                    : 20;

                return new GoogleDriveRecordingStorageService(
                    clientId ?? string.Empty,
                    clientSecret ?? string.Empty,
                    refreshToken ?? string.Empty,
                    folderId ?? string.Empty,
                    chunkDurationMinutes,
                    provider.GetRequiredService<ILogger<GoogleDriveRecordingStorageService>>());
            });

            services.AddSingleton<IHlsRecordingStorageService>(provider =>
            {
                var selectedProvider = configuration["Storage:Provider"] ?? "LocalDisk";
                if (selectedProvider.Equals("GoogleDrive", StringComparison.OrdinalIgnoreCase))
                    return provider.GetRequiredService<GoogleDriveRecordingStorageService>();

                if (!selectedProvider.Equals("LocalDisk", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException($"Unsupported storage provider '{selectedProvider}'. Supported values: LocalDisk, GoogleDrive.");

                return provider.GetRequiredService<LocalDiskRecordingStorageService>();
            });

            services.AddSingleton<IHlsDownloaderService, HlsDownloaderService>();

            services.AddSingleton<ISocketIOService, SocketIOService>();
            services.AddSingleton<IArchillectTVImageService, ArchillectTVImageService>();
        }
    }
}
