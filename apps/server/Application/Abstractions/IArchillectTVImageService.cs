using System.Threading;
using System.Threading.Tasks;

namespace IPTVAPI.Application.Abstractions;

public interface IArchillectTVImageService
{
    ISocketIOService _socketIOService { get; }
    Task StartAsync(CancellationToken ct = default);
    Task StopAsync();
}
