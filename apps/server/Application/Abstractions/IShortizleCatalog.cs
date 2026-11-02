using IPTVAPI.Application.DTOs;

namespace Application.Abstractions;

public interface IShortizleCatalog
{
    Task<ShortizleCatalog> GetCollectionsAsync(CancellationToken cancellationToken);
    Task<StreamingSeriesDetail> GetSeriesAsync(string slug, CancellationToken cancellationToken);
    Task<ShortizleSearchResult> SearchAsync(ShortizleSearchQuery query, CancellationToken cancellationToken);
}

public sealed record ShortizleCatalog(string Heading, IReadOnlyList<ShortizleCollection> Collections, ShortizleSearchOptions? Options = null);
public sealed record ShortizleCollection(string Key, string Title, IReadOnlyList<ShortizleTitle> Items);
public sealed record ShortizleTitle(string Id, string Slug, string Name, string Url, string? PosterUrl,
    string? Description, int EpisodeCount, bool HasDublaj, bool HasAltyazi, bool IsAdult);

public sealed record ShortizleSearchQuery(string Q = "", string[]? Genres = null, string Platform = "",
    string Kind = "", string Sort = "popular", string View = "grid", int Page = 1);
public sealed record ShortizleFilterOption(string Value, string Label);
public sealed record ShortizleSearchOptions(IReadOnlyList<ShortizleFilterOption> Genres, IReadOnlyList<ShortizleFilterOption> Platforms);
public sealed record ShortizleSearchResult(IReadOnlyList<ShortizleTitle> Items, int Page, int LastPage, int PerPage, int Total, ShortizleSearchOptions Options);
