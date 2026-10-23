using Application.Abstractions;
using IPTVAPI.Application.Abstractions;
using IPTVAPI.Application.DTOs;
using Microsoft.AspNetCore.Mvc;

namespace IPTVAPI.Controllers
{
    [ApiController]
    [Route("[controller]/[action]")]
    public class StreamingController : ControllerBase
    {
        private readonly IStreamingService _dizipalService;
        private readonly IStreamingService _roketdiziService;

        public StreamingController(
            [FromKeyedServices("Dizipal")] IStreamingService dizipalService, 
            [FromKeyedServices("Roketdizi")] IStreamingService roketdiziService)
        {
            _dizipalService = dizipalService;
            _roketdiziService = roketdiziService;
        }

        [HttpGet]
        public async Task<IActionResult> GetMediaUrl(string url)
        {
            var decodedUrl = System.Web.HttpUtility.UrlDecode(url);
            
            // URL'e göre hangi servisin kullanılacağına karar ver
            var service = decodedUrl.Contains("roketdizi", StringComparison.OrdinalIgnoreCase) 
                ? _roketdiziService 
                : _dizipalService;
            
            return Ok(await service.GetMediaUrl(decodedUrl));
        }

        [HttpGet]
        public async Task<IActionResult> Search(string searchTerm)
        {
            // Her iki servisten paralel olarak arama yap
            var roketdiziTask = _roketdiziService.SearchContent(searchTerm);
            var dizipalTask = _dizipalService.SearchContent(searchTerm);

            await Task.WhenAll(dizipalTask, roketdiziTask);

            var dizipalResults = dizipalTask.Result;
            var roketdiziResults = roketdiziTask.Result;

            // Tüm sonuçları birleştir
            var allRawResults = new List<StreamingRawResult>();
            allRawResults.AddRange(roketdiziResults);
            allRawResults.AddRange(dizipalResults);

            // IMDB ID'ye göre grupla
            var groupedResults = allRawResults
                .Where(r => !string.IsNullOrEmpty(r.ImdbId))
                .GroupBy(r => r.ImdbId)
                .Select(group =>
                {
                    var first = group.First();
                    return new StreamingSearchResult
                    {
                        ImdbId = first.ImdbId,
                        ImdbPoint = first.ImdbPoint,
                        Type = first.Type,
                        Name = first.Name,
                        AlternativeName = first.AlternativeName,
                        ReleaseYear = first.ReleaseYear,
                        Language = first.Language,
                        Categories = first.Categories,
                        PosterUrl = first.PosterUrl,
                        BackUrl = first.BackUrl,
                        FaceUrl = first.FaceUrl,
                        LogoUrl = first.LogoUrl,
                        SquareUrl = first.SquareUrl,
                        ProviderResults = group.Select(r => new ProviderResult
                        {
                            Id = r.Id,
                            Provider = r.Provider,
                            Slug = r.Slug
                        }).ToList()
                    };
                })
                .ToList();

            // IMDB ID'si olmayan sonuçları da ekle (ayrı ayrı)
            var noImdbResults = allRawResults
                .Where(r => string.IsNullOrEmpty(r.ImdbId))
                .Select(r => new StreamingSearchResult
                {
                    ImdbId = r.ImdbId,
                    ImdbPoint = r.ImdbPoint,
                    Type = r.Type,
                    Name = r.Name,
                    AlternativeName = r.AlternativeName,
                    ReleaseYear = r.ReleaseYear,
                    Language = r.Language,
                    Categories = r.Categories,
                    PosterUrl = r.PosterUrl,
                    BackUrl = r.BackUrl,
                    FaceUrl = r.FaceUrl,
                    LogoUrl = r.LogoUrl,
                    SquareUrl = r.SquareUrl,
                    ProviderResults = new List<ProviderResult>
                    {
                        new ProviderResult
                        {
                            Id = r.Id,
                            Provider = r.Provider,
                            Slug = r.Slug
                        }
                    }
                })
                .ToList();

            groupedResults.AddRange(noImdbResults);

            return Ok(groupedResults);
        }

        [HttpGet]
        public async Task<IActionResult> GetSeriesDetail(string seriesId)
        {
            var decodedId = System.Web.HttpUtility.UrlDecode(seriesId);
            return Ok(await _dizipalService.GetSeriesDetail(decodedId));
        }
    }
}
