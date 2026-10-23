using Version = Domain.Entities.Version;

namespace Application.Repositories
{
    public interface IVersionRepository
    {
        Task<List<Version>> GetAllContentAsync();
    }
}
