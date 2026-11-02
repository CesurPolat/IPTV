using Application.Abstractions;
using Microsoft.AspNetCore.Mvc;

namespace IPTVAPI.Controllers;

[ApiController]
[Route("Streaming/Shortizle")]
[ShortizleErrors]
public sealed class ShortizleCatalogController(IShortizleCatalog catalog) : ControllerBase
{
    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery(Name = "genres[]")] string[]? genres,
        string? q = null, string? platform = null, string? kind = null, string sort = "popular", string view = "grid",
        int page = 1, CancellationToken cancellationToken = default)
        => Ok(await catalog.SearchAsync(new ShortizleSearchQuery(q ?? "", genres, platform ?? "", kind ?? "", sort, view, page), cancellationToken));

    [HttpGet("collections")]
    public async Task<IActionResult> Collections(CancellationToken cancellationToken)
        => Ok(await catalog.GetCollectionsAsync(cancellationToken));

    [HttpGet("series/{slug}")]
    public async Task<IActionResult> Series(string slug, CancellationToken cancellationToken)
        => Ok(await catalog.GetSeriesAsync(slug, cancellationToken));
}
