using IPTVAPI.Application.Abstractions;
using Microsoft.AspNetCore.SignalR;

namespace IPTVAPI.Hubs.Archillect
{
    public class ArchillectTVHub : Hub
    {
        private static int _connectionCount = 0;
        private readonly IArchillectTVImageService _archillectTVImageService;

        public ArchillectTVHub(IArchillectTVImageService archillectTVImageService)
        {
            _archillectTVImageService = archillectTVImageService;
        }

        public override async Task OnConnectedAsync()
        {
            Interlocked.Increment(ref _connectionCount);
            if (_connectionCount == 1)
            {
                await _archillectTVImageService.StartAsync();
                Console.WriteLine("First client connected. Archillect TV started.");
            }
            // İlk bağlanan olduğunda TV'yi başlatabilirsiniz veya 
            // StartTV metodunun çağrılmasını bekleyebilirsiniz.
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            if (Interlocked.Decrement(ref _connectionCount) == 0)
            {
                await _archillectTVImageService.StopAsync();
                Console.WriteLine("All clients disconnected. Archillect TV stopped.");
            }
            await base.OnDisconnectedAsync(exception);
        }

    }
}