using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Application.Abstractions;
using IPTVAPI.Application.DTOs;
using Microsoft.Extensions.Caching.Memory;

namespace Infrastructure.Services.Streaming.Shortizle;

public sealed class ShortizleCatalogService : IShortizleCatalog
{
    private readonly IMemoryCache _cache;
    private readonly Func<HttpClient> _clients;
    public ShortizleCatalogService(IMemoryCache cache) : this(cache, ShortizleHttp.CreateClient) { }
    public ShortizleCatalogService(IMemoryCache cache, Func<HttpClient> clients) { _cache = cache; _clients = clients; }

    public async Task<ShortizleCatalog> GetCollectionsAsync(CancellationToken cancellationToken)
    {
        const string key = "shortizle:collections";
        if (_cache.TryGetValue<ShortizleCatalog>(key, out var cached)) return cached!;
        var result = ParseCollections(await Fetch("/koleksiyonlar", cancellationToken));
        _cache.Set(key, result, TimeSpan.FromMinutes(5));
        return result;
    }

    public async Task<StreamingSeriesDetail> GetSeriesAsync(string slug, CancellationToken cancellationToken)
    {
        ValidateSlug(slug);
        var key = "shortizle:series:" + slug;
        if (_cache.TryGetValue<StreamingSeriesDetail>(key, out var cached)) return cached!;
        var result = ParseSeries(await Fetch("/icerik/" + slug, cancellationToken), slug);
        _cache.Set(key, result, TimeSpan.FromMinutes(5));
        return result;
    }

    public async Task<ShortizleSearchResult> SearchAsync(ShortizleSearchQuery query, CancellationToken cancellationToken)
    {
        var path = SearchPath(query);
        var key = "shortizle:archive:" + path;
        if (_cache.TryGetValue<ShortizleSearchResult>(key, out var cached)) return cached!;
        var result = ParseSearch(await Fetch(path, cancellationToken));
        _cache.Set(key, result, TimeSpan.FromMinutes(2));
        return result;
    }

    public static string SearchPath(ShortizleSearchQuery query)
    {
        if (query.Q.Length > 200 || query.Page < 1 || query.Page > 100000 ||
            query.Kind is not ("" or "dublaj" or "altyazi") || query.Sort is not ("popular" or "new" or "rating") ||
            query.View is not ("grid" or "list") || (query.Platform.Length > 0 && !Slug(query.Platform)) ||
            query.Genres?.Length > 20 || query.Genres?.Any(g => !Slug(g)) == true)
            throw new ShortizleException(400, "invalid_search", "Arama filtreleri geçersiz.");
        var values = new List<KeyValuePair<string, string>>
        {
            new("q", query.Q.Trim()), new("kind", query.Kind), new("sort", query.Sort), new("view", query.View),
            new("page", query.Page.ToString(System.Globalization.CultureInfo.InvariantCulture))
        };
        if (query.Platform.Length > 0) values.Add(new("platform", query.Platform));
        foreach (var genre in (query.Genres ?? []).Distinct().OrderBy(g => g, StringComparer.Ordinal)) values.Add(new("genres[]", genre));
        return "/archive?" + string.Join("&", values.Select(p => Uri.EscapeDataString(p.Key) + "=" + Uri.EscapeDataString(p.Value)));
    }

    private async Task<JsonObject> Fetch(string path, CancellationToken ct)
    {
        using var client = _clients();
        using var response = await ShortizleHttp.SendAsync(client, new Uri("https://shortizle.com" + path), ct);
        ShortizleHttp.EnsureSuccess(response);
        var text = await ShortizleHttp.TextAsync(response, ct);
        if (text.TrimStart().StartsWith('{'))
        {
            try { return JsonNode.Parse(text)?["props"] as JsonObject ?? throw new ShortizleException(502, "invalid_page", "Sayfa props verisi bulunamadı."); }
            catch (System.Text.Json.JsonException) { throw new ShortizleException(502, "invalid_page", "Sayfa JSON verisi geçersiz."); }
        }
        return ShortizleParser.ParsePage(text);
    }

    private static string? Text(JsonObject obj, string key) => obj[key] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
    private static int Number(JsonObject obj, string key) => obj[key] is JsonValue v && v.TryGetValue<int>(out var n) ? n : 0;
    private static bool Flag(JsonObject obj, string key) => obj[key] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
    private static bool Slug(string? slug) => slug != null && Regex.IsMatch(slug, "^[a-zA-Z0-9_-]{1,200}$");
    private static void ValidateSlug(string slug)
    {
        if (!Slug(slug)) throw new ShortizleException(400, "invalid_slug", "Geçerli bir dizi kimliği gerekiyor.");
    }

    public static string? Poster(JsonObject title)
    {
        var value = Text(title, "poster");
        if (string.IsNullOrWhiteSpace(value))
        {
            var match = Regex.Match(Text(title, "poster_gradient") ?? "", "url\\(\\s*['\"]?(?<url>[^'\"\\s)]+)['\"]?\\s*\\)", RegexOptions.IgnoreCase);
            value = match.Success ? match.Groups["url"].Value : null;
        }
        if (string.IsNullOrWhiteSpace(value) || !Uri.TryCreate(new Uri("https://shortizle.com"), value, out var uri) ||
            uri.Scheme != "https" || uri.UserInfo.Length != 0) return null;
        return uri.AbsoluteUri;
    }

    public static ShortizleCatalog ParseCollections(JsonObject props)
    {
        var rows = props["desktopCollections"] is JsonArray desktop && desktop.Count > 0 ? desktop : props["collections"] as JsonArray;
        if (rows == null) throw new ShortizleException(502, "invalid_catalog", "Koleksiyon verisi bulunamadı.");
        var collections = new List<ShortizleCollection>();
        foreach (var row in rows.OfType<JsonObject>())
        {
            if (row["items"] is not JsonArray items) continue;
            var titles = MapTitles(items);
            if (titles.Count > 0) collections.Add(new ShortizleCollection(Text(row, "key") ?? collections.Count.ToString(), Text(row, "title") ?? "Diziler", titles));
        }
        return new ShortizleCatalog(Text(props, "heading") ?? "Koleksiyonlar", collections, ParseOptions(props));
    }

    private static List<ShortizleTitle> MapTitles(JsonArray items)
    {
        var titles = new List<ShortizleTitle>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in items.OfType<JsonObject>())
        {
            var slug = Text(item, "slug"); var name = Text(item, "name");
            if (Text(item, "type") != "series" || !Slug(slug) || string.IsNullOrWhiteSpace(name) || !seen.Add(slug!)) continue;
            titles.Add(new ShortizleTitle(item["id"]?.ToString() ?? slug!, slug!, name,
                "https://shortizle.com/icerik/" + slug, Poster(item), Text(item, "description") ?? Text(item, "description_short"),
                Math.Max(0, Number(item, "episode_count")), Flag(item, "has_dublaj"), Flag(item, "has_altyazi"), Flag(item, "is_adult")));
        }
        return titles;
    }

    private static ShortizleSearchOptions ParseOptions(JsonObject props)
    {
        var options = props["options"] as JsonObject;
        List<ShortizleFilterOption> Map(string key, string value, string label) => (options?[key] as JsonArray ?? new JsonArray())
            .OfType<JsonObject>().Where(o => Slug(Text(o, value)) && !string.IsNullOrWhiteSpace(Text(o, label)))
            .Select(o => new ShortizleFilterOption(Text(o, value)!, Text(o, label)!)).DistinctBy(o => o.Value).ToList();
        return new ShortizleSearchOptions(Map("genres", "slug", "name"), Map("platforms", "value", "label"));
    }

    public static ShortizleSearchResult ParseSearch(JsonObject props)
    {
        if (props["titles"] is not JsonObject titles || titles["data"] is not JsonArray data)
            throw new ShortizleException(502, "invalid_search_response", "Arama sonuçları bulunamadı.");
        var meta = titles["meta"] as JsonObject ?? titles;
        var page = Number(meta, "current_page"); var lastPage = Number(meta, "last_page");
        var perPage = Number(meta, "per_page"); var total = Number(meta, "total");
        if (page < 1 || lastPage < 1 || perPage < 1 || total < 0 || !meta.ContainsKey("total"))
            throw new ShortizleException(502, "invalid_search_response", "Arama sayfalama bilgisi geçersiz.");
        return new ShortizleSearchResult(MapTitles(data), page, lastPage, perPage, total, ParseOptions(props));
    }

    public static StreamingSeriesDetail ParseSeries(JsonObject props, string slug)
    {
        ValidateSlug(slug);
        if (props["title"] is not JsonObject title || Text(title, "slug") != slug || Text(title, "type") != "series" || string.IsNullOrWhiteSpace(Text(title, "name")))
            throw new ShortizleException(502, "invalid_series", "Dizi detay verisi geçersiz.");
        if (title["seasons"] is not JsonArray seasons) throw new ShortizleException(502, "invalid_series", "Sezon verisi bulunamadı.");
        var result = new StreamingSeriesDetail { Name = Text(title, "name"), Description = Text(title, "description"),
            Image = Poster(title), Url = "https://shortizle.com/icerik/" + slug, Seasons = new() };
        foreach (var season in seasons.OfType<JsonObject>())
        {
            var seasonNumber = Number(season, "number");
            if (seasonNumber < 1 || season["episodes"] is not JsonArray episodes) continue;
            var mapped = episodes.OfType<JsonObject>().Where(e => Number(e, "number") > 0 && !Flag(e, "is_upcoming"))
                .DistinctBy(e => Number(e, "number")).OrderBy(e => Number(e, "number")).Select(e => new StreamingEpisode
                {
                    Name = Text(e, "name") ?? $"Bölüm {Number(e, "number")}", EpisodeNumber = Number(e, "number"),
                    Url = $"https://shortizle.com/watch/{slug}/{seasonNumber}/{Number(e, "number")}", Description = Text(e, "description")
                }).ToList();
            result.Seasons.Add(new StreamingSeason { SeasonNumber = seasonNumber, NumberOfEpisodes = mapped.Count, Episodes = mapped });
        }
        result.Seasons = result.Seasons.OrderBy(s => s.SeasonNumber).ToList();
        return result;
    }
}
