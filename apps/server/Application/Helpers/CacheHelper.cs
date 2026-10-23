using Microsoft.Extensions.Caching.Memory;

namespace Application.Helpers
{
    public static class CacheHelper
    {
        public static async Task<T> GetOrCreateAsync<T>(
            this IMemoryCache cache, 
            string cacheKey, 
            Func<Task<T>> createItem, 
            TimeSpan? absoluteExpiration = null)
        {
            if (!cache.TryGetValue(cacheKey, out T? cacheEntry))
            {
                cacheEntry = await createItem();

                var cacheEntryOptions = new MemoryCacheEntryOptions();
                if (absoluteExpiration.HasValue)
                {
                    cacheEntryOptions.AbsoluteExpirationRelativeToNow = absoluteExpiration.Value;
                }

                cache.Set(cacheKey, cacheEntry, cacheEntryOptions);
            }

            return cacheEntry!;
        }

        public static void Set<T>(this IMemoryCache cache, string cacheKey, T value, TimeSpan? expiration = null)
        {
            if (expiration.HasValue)
            {
                cache.Set(cacheKey, value, expiration.Value);
            }
            else
            {
                cache.Set(cacheKey, value);
            }
        }

        public static void Remove(this IMemoryCache cache, string cacheKey)
        {
            cache.Remove(cacheKey);
        }
    }
}
