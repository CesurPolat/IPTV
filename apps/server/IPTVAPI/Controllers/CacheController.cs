using Application.Constants;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using System.Reflection;

namespace IPTVAPI.Controllers
{
    [ApiController]
    [Route("[controller]/[action]")]
    public class CacheController : ControllerBase
    {
        private readonly IMemoryCache _cache;

        public CacheController(IMemoryCache cache)
        {
            _cache = cache;
        }

        [HttpGet]
        public IActionResult Clear(string? key = null)
        {
            if (!string.IsNullOrEmpty(key))
            {
                _cache.Remove(key);
                return Ok(new { Message = $"Cache cleared for key: {key}" });
            }

            // Clear all known keys from CacheKeys
            var fields = typeof(CacheKeys).GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
                .Where(fi => fi.IsLiteral && !fi.IsInitOnly && fi.FieldType == typeof(string));

            var clearedKeys = new List<string>();
            foreach (var field in fields)
            {
                var cacheKey = field.GetValue(null)?.ToString();
                if (!string.IsNullOrEmpty(cacheKey))
                {
                    _cache.Remove(cacheKey);
                    clearedKeys.Add(cacheKey);
                }
            }

            return Ok(new { Message = "All known caches cleared", ClearedKeys = clearedKeys });
        }
    }
}
