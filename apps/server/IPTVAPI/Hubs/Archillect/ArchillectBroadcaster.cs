using IPTVAPI.Application.Abstractions;
using Microsoft.AspNetCore.SignalR;
using System.Threading.Tasks;

namespace IPTVAPI.Hubs.Archillect;

public class ArchillectBroadcaster : IArchillectBroadcaster
{
    private readonly IHubContext<ArchillectTVHub> _hubContext;

    public ArchillectBroadcaster(IHubContext<ArchillectTVHub> hubContext)
    {
        _hubContext = hubContext;
    }

    public async Task BroadcastUpdateAsync(string data)
    {
        // Hub üzerinden tüm bağlı clientlara yayın yapıyoruz
        await _hubContext.Clients.All.SendAsync("ReceiveArchillectUpdate", data);
    }
}
