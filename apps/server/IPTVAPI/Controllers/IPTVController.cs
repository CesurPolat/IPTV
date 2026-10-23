using Application.Abstractions;
using Application.Constants;
using Application.Helpers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace IPTVAPI.Controllers
{
    [ApiController]
    [Route("[controller]/[action]")]
    public class IPTVController : ControllerBase
    {
        private readonly IIPTVService _iptvService;
        private readonly IBroadcastScheduleService _broadcastScheduleService;
        private readonly IMemoryCache _cache;

        public IPTVController(IIPTVService iptvService, IBroadcastScheduleService broadcastScheduleService, IMemoryCache cache)
        {
            _iptvService = iptvService;
            _broadcastScheduleService = broadcastScheduleService;
            _cache = cache;
        }

        [HttpGet]
        public async Task<IActionResult> GetAllAsync()
        {
            var result = await _cache.GetOrCreateAsync(CacheKeys.IPTVChannels, 
                () => _iptvService.GetChannelsAsync(), 
                TimeSpan.FromHours(4));

            return Ok(result);
        }

        [HttpGet]
        public async Task<IActionResult> GetCurrentSchedule()
        {
            var result = await _cache.GetOrCreateAsync(CacheKeys.CurrentSchedule, 
                () => _broadcastScheduleService.GetCurrentSchedule(), 
                TimeSpan.FromMinutes(10));

            return Ok(result);
        }
    }
}
