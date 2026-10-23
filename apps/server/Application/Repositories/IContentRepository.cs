using Domain.Entities;

namespace Application.Repositories
{
    public interface IContentRepository
    {
        Task<List<Content>> GetAllContentAsync();
        
    }
}
