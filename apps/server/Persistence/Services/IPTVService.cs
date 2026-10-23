using Application.Abstractions;
using Application.DTOs;
using Application.Helpers;
using Application.Repositories;
using Infrastructure.Services.Scraping;
using Microsoft.VisualBasic;

namespace Persistence.Services
{
    public class IPTVService : IIPTVService
    {
        private readonly IContentRepository _contentRepository;

        public IPTVService(IContentRepository contentRepository)
        {
            _contentRepository = contentRepository;
        }

        public async Task<IEnumerable<ContentDTO>> GetChannelsAsync()
        {
            var contents = await _contentRepository.GetAllContentAsync();

            if(contents == null || !contents.Any())
                throw new Exception("No content found");

            var contentDTOs = new List<ContentDTO>();

            foreach (var content in contents)
            {
                
                var source = await content.Source.Exec();

                var contentDTO = new ContentDTO
                {
                    Id = content.Id.ToString(),
                    Name = content.Name,
                    ChannelId = content.ChannelId,
                    Poster = content.Poster,
                    Source = source,
                    Category = content.Category,
                    AdsRegex = content.AdsRegex
                };

                contentDTOs.Add(contentDTO);

            }

            return contentDTOs;
        }
    }
}
