using Application.Repositories;
using Persistence.Repositories;
using Application.Abstractions;
using Persistence.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Persistence
{
    public static class DependencyInjection
    {
        public static void AddPersistence(this IServiceCollection services)
        {
            #region Repositories

            services.AddScoped<IContentRepository, ContentRepository>();

            #endregion Repositories

            #region Services

            services.AddTransient<IIPTVService, IPTVService>();

            #endregion Services
        }
    }
}
