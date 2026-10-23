using Application.DTOs;

using Persistence;
using Infrastructure;
using MongoDB.Driver;
using System.Security.Authentication;
using Application.Helpers;
using Application.Abstractions;
using Domain.Enums;
using IPTVAPI.Hubs;
using IPTVAPI.Hubs.Archillect;
using IPTVAPI.Application.Abstractions;
using IPTVAPI.Infrastructure.Services.Streaming;
using IPTVAPI.Services;

var builder = WebApplication.CreateBuilder(args);

if (builder.Environment.IsDevelopment())
{
    builder.Configuration
        .AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true)
        .AddEnvironmentVariables();
}

// Add services to the container.

builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient();
builder.Services.AddHostedService<RecordingCleanupHostedService>();
builder.Services.AddHostedService<ChannelLinkRefreshHostedService>();
// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Register application services and repositories
builder.Services.AddPersistence();
builder.Services.AddInfrastructure(builder.Configuration);

// Register the ArchillectBroadcaster as a singleton
builder.Services.AddSingleton<IArchillectBroadcaster, ArchillectBroadcaster>();

//Configure CORS to allow all origins, methods, and headers
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll",
        policy => policy
            .SetIsOriginAllowed(_ => true)
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials());
});

//Create Inital folders
void CreateFolder(string path)
{
    if (!Directory.Exists(path))
    {
        Directory.CreateDirectory(path);
    }
}

CreateFolder("FileStorage");

var app = builder.Build();
var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
var loggerFactory = app.Services.GetRequiredService<ILoggerFactory>();
var startupRecorders = new List<IHlsDownloaderService>();
var startupRecordOnlyTrt1 = builder.Configuration.GetValue<bool>("Recording:Startup:OnlyTrt1");
var isRecordingEnabled = builder.Configuration.GetValue<bool?>("Recording:Enabled") ?? true;

app.Lifetime.ApplicationStarted.Register(() =>
{
    if (!isRecordingEnabled)
    {
        startupLogger.LogInformation("Recording is disabled by configuration (Recording:Enabled=false). Skipping startup auto recording.");
        return;
    }

    var baseUrl = app.Urls.First();

    if(!baseUrl.EndsWith('/'))
        baseUrl += '/';

    baseUrl = baseUrl.Replace(":80", "");
    baseUrl = baseUrl.Replace(":443", "");

    baseUrl = baseUrl.Replace("http://", "https://");

    ConfigHelper.APIUrl = baseUrl;
    ConfigHelper.FlareSolverrUrl = builder.Configuration["FlareSolverrUrl"] ?? string.Empty;
    ConfigHelper.BrowserWSEndpoint = builder.Configuration["BrowserWSEndpoint"] ?? string.Empty;

    ConfigHelper.Urls = app.Urls.ToList();

    _ = Task.Run(async () =>
    {
        try
        {
            using var scope = app.Services.CreateScope();
            var iptvService = scope.ServiceProvider.GetRequiredService<IIPTVService>();

            var channels = await iptvService.GetChannelsAsync();
            var candidates = channels
                .Where(c => c.Category == Category.TVChannel)
                .Where(c => !string.IsNullOrWhiteSpace(c.Source))
                .Where(c => Uri.TryCreate(c.Source, UriKind.Absolute, out _))
                .ToList();

            if (startupRecordOnlyTrt1)
            {
                candidates = candidates
                    .Where(c => !string.IsNullOrWhiteSpace(c.Name))
                    .Where(c => NormalizeChannelName(c.Name).Contains("TRT1", StringComparison.OrdinalIgnoreCase))
                    .ToList();

                startupLogger.LogInformation("Startup test mode enabled. Only TRT1 recording will be started.");
            }

            foreach (var channel in candidates)
            {
                try
                {
                    var recorder = new HlsDownloaderService(
                        loggerFactory.CreateLogger<HlsDownloaderService>(),
                        scope.ServiceProvider.GetRequiredService<IHlsRecordingStorageService>(),
                        async (recordingName, cancellationToken) =>
                        {
                            using var refreshScope = app.Services.CreateScope();
                            var refreshIptvService = refreshScope.ServiceProvider.GetRequiredService<IIPTVService>();

                            var refreshedChannels = await refreshIptvService.GetChannelsAsync();
                            var refreshedChannel = refreshedChannels
                                .Where(c => !string.IsNullOrWhiteSpace(c.Name))
                                .FirstOrDefault(c => NormalizeChannelName(c.Name) == NormalizeChannelName(recordingName));

                            return refreshedChannel?.Source;
                        });

                    await recorder.StartAsync(channel.Source, channel.Name);
                    startupRecorders.Add(recorder);
                    startupLogger.LogInformation("Auto recording started for channel: {ChannelName}", channel.Name);
                }
                catch (Exception ex)
                {
                    startupLogger.LogWarning(ex, "Auto recording failed for channel: {ChannelName}", channel.Name);
                }
            }

            startupLogger.LogInformation("Auto recording startup completed. Started {Count} channel recorder(s).", startupRecorders.Count);
        }
        catch (Exception ex)
        {
            startupLogger.LogError(ex, "IPTV auto recording failed to start.");
        }
    });

});

app.Lifetime.ApplicationStopping.Register(() =>
{
    _ = Task.Run(async () =>
    {
        try
        {
            foreach (var recorder in startupRecorders)
            {
                try
                {
                    await recorder.StopAsync();
                }
                catch (Exception ex)
                {
                    startupLogger.LogWarning(ex, "A channel recorder failed to stop cleanly.");
                }
            }

            startupLogger.LogInformation("Auto recording stopped for {Count} channel recorder(s).", startupRecorders.Count);
        }
        catch (Exception ex)
        {
            startupLogger.LogError(ex, "IPTV auto recording failed to stop cleanly.");
        }
    });
});

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseCors("AllowAll");

app.UseAuthorization();

app.MapHub<TestHub>("/testHub");
app.MapHub<ArchillectTVHub>("/archillectTVHub");

app.MapControllers();

app.Run();

static string NormalizeChannelName(string name)
{
    return name
        .ToUpperInvariant()
        .Replace(" ", string.Empty)
        .Replace("-", string.Empty)
        .Replace("_", string.Empty);
}
