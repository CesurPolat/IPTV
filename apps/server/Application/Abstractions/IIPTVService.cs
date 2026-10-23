using Application.DTOs;

namespace Application.Abstractions
{
    public interface IIPTVService
    {
        Task<IEnumerable<ContentDTO>> GetChannelsAsync();
    }
}
