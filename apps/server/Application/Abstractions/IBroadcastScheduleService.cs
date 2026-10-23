using Domain.Entities;

namespace Application.Abstractions
{
    public interface IBroadcastScheduleService
    {
        Task<List<string>> GetTodaysSchedule();
        Task<List<BroadcastSchedule>> GetCurrentSchedule();
    }
}
