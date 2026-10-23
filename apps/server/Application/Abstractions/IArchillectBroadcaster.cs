using System.Threading.Tasks;

namespace IPTVAPI.Application.Abstractions;

public interface IArchillectBroadcaster
{
    Task BroadcastUpdateAsync(string data);
}
