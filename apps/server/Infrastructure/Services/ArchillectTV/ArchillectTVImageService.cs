using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using IPTVAPI.Application.Abstractions;
using IPTVAPI.Infrastructure.Services.SocketIO;

namespace IPTVAPI.Infrastructure.Services.ArchillectTV;

public class ArchillectTVImageService : IArchillectTVImageService
{
    public ISocketIOService _socketIOService { get; }
    private readonly IArchillectBroadcaster _broadcaster;
    private int _messageCount = 0;

    public ArchillectTVImageService(ISocketIOService socketIOService, IArchillectBroadcaster broadcaster)
    {
        _socketIOService = socketIOService;
        _broadcaster = broadcaster;

        _socketIOService.OnMessageReceived += async message =>
        {
            // Socket.io mesaj formatı: 42["event", {data}]
            if (message.StartsWith("42"))
            {
                _messageCount++;
                if (_messageCount >= 4)
                {
                    await _socketIOService.SendAsync("2");
                    _messageCount = 0;
                    System.Console.WriteLine("Sent Ping (2) after 4 messages.");
                }

                var eventData = message.Substring(2);
                await _broadcaster.BroadcastUpdateAsync(eventData);
                System.Console.WriteLine($"Archillect Update: {eventData}");
            }
        };
    }

    public async Task StartAsync(CancellationToken ct = default)
    {
        var headers = new Dictionary<string, string>
        {
            { "Referer", "https://archillect.com/tv" },
            { "Origin", "https://archillect.com" }
        };

        await _socketIOService.StartAsync("https://archillect.com", headers);
    }

    public async Task StopAsync()
    {
        await _socketIOService.StopAsync();
        _messageCount = 0;
    }
}