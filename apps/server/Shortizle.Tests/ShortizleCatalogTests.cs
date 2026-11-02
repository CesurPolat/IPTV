using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Application.Abstractions;
using Infrastructure.Services.Streaming.Shortizle;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using IPTVAPI.Controllers;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Shortizle.Tests;

[TestClass]
public sealed class ShortizleCatalogTests
{
    // Reduced fixtures preserve the upstream Archive and title page shapes.
    private const string Archive = """
        {"heading":"Koleksiyonlar","titles":{"data":[],"meta":{"total":0}},
         "collections":[{"key":"popular","title":"En Çok İzlenenler","items":[
           {"id":5175,"type":"series","slug":"ustanin-oyunu-rjes","name":"USTANIN OYUNU","episode_count":61,
            "poster_gradient":"url('https://shortizle.com/storage/posters/5175.webp') center/cover no-repeat","has_dublaj":true,"has_altyazi":true},
           {"type":"series","slug":"ustanin-oyunu-rjes","name":"Duplicate"},
           {"type":"movie","slug":"film","name":"Film"},
           {"type":"series","slug":"../invalid","name":"Invalid"},
           {"type":"series","slug":"missing-poster","name":"No poster","poster_gradient":"linear-gradient(red, blue)"}]}]}
        """;
    private const string Detail = """
        {"title":{"slug":"ustanin-oyunu-rjes","type":"series","name":"USTANIN OYUNU","description":"Açıklama",
          "poster":"/storage/posters/5175.webp","seasons":[{"number":2,"episodes":[]},{"number":1,"episodes":[
            {"number":2,"name":"Bölüm 2"},{"number":1,"name":"Bölüm 1","is_upcoming":false},
            {"number":3,"name":"Yakında","is_upcoming":true},{"number":0},{"number":1,"name":"Duplicate"}]}]}}
        """;
    private static JsonObject Props(string json) => ShortizleParser.ParsePage("<script data-page='app' type='application/json'>{\"props\":" + json + "}</script>");
    private const string SearchPage = """
        {"titles":{"current_page":2,"last_page":42,"per_page":30,"total":1250,"data":[
          {"id":5175,"slug":"ustanin-oyunu-rjes","name":"USTANIN OYUNU","type":"series","episode_count":61},
          {"slug":"film","name":"Film","type":"movie"}]},
        "options":{"genres":[{"slug":"aksiyon","name":"Aksiyon"}],"platforms":[{"value":"reelshort","label":"ReelShort"}]}}
        """;

    [TestMethod]
    public void MapsSearchPaginationAndFilterOptions()
    {
        var result = ShortizleCatalogService.ParseSearch(Props(SearchPage));
        Assert.AreEqual(2, result.Page); Assert.AreEqual(42, result.LastPage); Assert.AreEqual(30, result.PerPage); Assert.AreEqual(1250, result.Total);
        Assert.AreEqual("ustanin-oyunu-rjes", result.Items.Single().Slug);
        Assert.AreEqual("aksiyon", result.Options.Genres.Single().Value);
        Assert.AreEqual("ReelShort", result.Options.Platforms.Single().Label);
        var empty = ShortizleCatalogService.ParseSearch(Props("{\"titles\":{\"current_page\":1,\"last_page\":1,\"per_page\":30,\"total\":0,\"data\":[]}}"));
        Assert.AreEqual(0, empty.Items.Count);
    }

    [TestMethod]
    public async Task EncodesSearchTextAndRejectsInvalidFilters()
    {
        var path = ShortizleCatalogService.SearchPath(new ShortizleSearchQuery("selam & ? Türkçe", ["aksiyon", "aile", "aksiyon"], "reelshort", "dublaj", "popular", "grid", 2));
        Assert.IsTrue(path.Contains("q=selam%20%26%20%3F%20T%C3%BCrk%C3%A7e"));
        Assert.IsTrue(path.Contains("genres%5B%5D=aksiyon"));
        Assert.IsTrue(path.Contains("platform=reelshort"));
        Assert.AreEqual(2, path.Split("genres%5B%5D=").Length - 1);
        foreach (var query in new[] { new ShortizleSearchQuery(Page: 0), new ShortizleSearchQuery(Kind: "invalid"),
            new ShortizleSearchQuery(Sort: "unknown"), new ShortizleSearchQuery(View: "invalid"),
            new ShortizleSearchQuery(Genres: ["../secret"]), new ShortizleSearchQuery(Platform: "https://evil.test"),
            new ShortizleSearchQuery(Q: new string('x', 201)) })
            await Expect("invalid_search", () => Task.FromResult(ShortizleCatalogService.SearchPath(query)));
        await Expect("invalid_search_response", () => Task.FromResult(ShortizleCatalogService.ParseSearch(new JsonObject())));
        await Expect("invalid_search_response", () => Task.FromResult(ShortizleCatalogService.ParseSearch(Props("{\"titles\":{\"data\":[]}}"))));
    }

    [TestMethod]
    public async Task ReadsPlainInertiaJsonAndSeparatesSearchCacheKeys()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var paths = new List<string>();
        var service = new ShortizleCatalogService(cache, () => new HttpClient(new Handler(r =>
        {
            paths.Add(r.RequestUri!.PathAndQuery);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"component\":\"site/Archive\",\"props\":" + SearchPage + "}", Encoding.UTF8, "application/json") };
        })));
        var query = new ShortizleSearchQuery("selam", ["aksiyon"], "reelshort", "dublaj");
        await service.SearchAsync(query, default); await service.SearchAsync(query, default);
        await service.SearchAsync(query with { Page = 2 }, default);
        await service.SearchAsync(query with { Kind = "altyazi" }, default);
        Assert.AreEqual(3, paths.Count);
        Assert.IsTrue(paths.All(p => p.StartsWith("/archive?")));
    }

    [TestMethod]
    public async Task HttpSearchBindsRepeatedGenresAndReturnsValidationErrors()
    {
        var builder = WebApplication.CreateBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddControllers().AddApplicationPart(typeof(ShortizleCatalogController).Assembly);
        using var cache = new MemoryCache(new MemoryCacheOptions());
        string? upstreamQuery = null;
        builder.Services.AddSingleton<IShortizleCatalog>(new ShortizleCatalogService(cache, () => new HttpClient(new Handler(r =>
        {
            upstreamQuery = r.RequestUri!.Query;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"props\":" + SearchPage + "}") };
        }))));
        await using var app = builder.Build(); app.MapControllers(); await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient();
        using var response = await client.GetAsync(address + "/Streaming/Shortizle/search?q=selam%26test&genres%5B%5D=aksiyon&genres%5B%5D=aile&platform=reelshort&kind=dublaj&sort=popular&view=list&page=2");
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var result = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        Assert.AreEqual(2, result["page"]!.GetValue<int>());
        Assert.AreEqual(1, result["items"]!.AsArray().Count);
        Assert.IsTrue(upstreamQuery!.Contains("genres%5B%5D=aksiyon"));
        Assert.IsTrue(upstreamQuery.Contains("genres%5B%5D=aile"));
        Assert.IsTrue(upstreamQuery.Contains("q=selam%26test"));
        using var invalid = await client.GetAsync(address + "/Streaming/Shortizle/search?sort=unsafe");
        Assert.AreEqual(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.AreEqual("invalid_search", JsonNode.Parse(await invalid.Content.ReadAsStringAsync())!["code"]!.ToString());
        await app.StopAsync();
    }

    [TestMethod]
    public void MapsGroupedSeriesPostersAndLanguageFlags()
    {
        var result = ShortizleCatalogService.ParseCollections(Props(Archive));
        Assert.AreEqual("Koleksiyonlar", result.Heading);
        var row = result.Collections.Single();
        Assert.AreEqual("popular", row.Key);
        Assert.AreEqual(2, row.Items.Count);
        var series = row.Items[0];
        Assert.AreEqual("https://shortizle.com/icerik/ustanin-oyunu-rjes", series.Url);
        Assert.AreEqual("https://shortizle.com/storage/posters/5175.webp", series.PosterUrl);
        Assert.AreEqual(61, series.EpisodeCount);
        Assert.IsTrue(series.HasDublaj && series.HasAltyazi);
        Assert.IsNull(row.Items[1].PosterUrl);
    }

    [TestMethod]
    public void PrefersDesktopMetadataAndFallsBackToCollections()
    {
        var props = Props(Archive);
        props["desktopCollections"] = JsonNode.Parse("""
            [{"key":"top","title":"En İyi Seçimler","items":[{"type":"series","slug":"example","name":"Example","description":"Desktop description"}]}]
            """);
        var desktop = ShortizleCatalogService.ParseCollections(props);
        Assert.AreEqual("Desktop description", desktop.Collections.Single().Items.Single().Description);
        props["desktopCollections"] = new JsonArray();
        Assert.AreEqual("popular", ShortizleCatalogService.ParseCollections(props).Collections.Single().Key);
        props["collections"] = new JsonArray();
        Assert.AreEqual(0, ShortizleCatalogService.ParseCollections(props).Collections.Count);
    }

    [TestMethod]
    public void MapsRealSeasonAndEpisodeNumbersWithoutInventingUpcomingEpisodes()
    {
        var series = ShortizleCatalogService.ParseSeries(Props(Detail), "ustanin-oyunu-rjes");
        Assert.AreEqual("https://shortizle.com/storage/posters/5175.webp", series.Image);
        Assert.AreEqual(2, series.Seasons!.Count);
        Assert.AreEqual(1, series.Seasons[0].SeasonNumber);
        Assert.AreEqual(2, series.Seasons[0].NumberOfEpisodes);
        Assert.AreEqual("https://shortizle.com/watch/ustanin-oyunu-rjes/1/1", series.Seasons[0].Episodes![0].Url);
        Assert.AreEqual(2, series.Seasons[0].Episodes![1].EpisodeNumber);
        Assert.AreEqual(0, series.Seasons[1].Episodes!.Count);
    }

    [TestMethod]
    public async Task CachesSuccessfulPagesAndDoesNotCacheFailures()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var calls = 0;
        var service = new ShortizleCatalogService(cache, () => new HttpClient(new Handler(r =>
        {
            calls++;
            Assert.AreEqual("shortizle.com", r.RequestUri!.Host);
            Assert.IsTrue(r.RequestUri.AbsolutePath is "/koleksiyonlar" or "/icerik/ustanin-oyunu-rjes");
            if (calls == 1) return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
            var data = r.RequestUri.AbsolutePath == "/koleksiyonlar" ? Archive : Detail;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<script data-page='app' type='application/json'>{\"props\":" + data + "}</script>", Encoding.UTF8) };
        })));
        await Expect("upstream_error", () => service.GetCollectionsAsync(default));
        await service.GetCollectionsAsync(default);
        await service.GetCollectionsAsync(default);
        await service.GetSeriesAsync("ustanin-oyunu-rjes", default);
        await service.GetSeriesAsync("ustanin-oyunu-rjes", default);
        Assert.AreEqual(3, calls);
    }

    [TestMethod]
    public async Task RejectsMissingSchemasUnsafeSlugsAndUnsafePosterSchemes()
    {
        await Expect("invalid_catalog", () => Task.FromResult(ShortizleCatalogService.ParseCollections(new JsonObject())));
        await Expect("invalid_series", () => Task.FromResult(ShortizleCatalogService.ParseSeries(Props(Detail), "wrong-slug")));
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ShortizleCatalogService(cache, () => throw new Exception("Must not fetch unsafe slug"));
        await Expect("invalid_slug", () => service.GetSeriesAsync("../admin", default));
        Assert.IsNull(ShortizleCatalogService.Poster(new JsonObject { ["poster"] = "javascript:alert(1)" }));
    }

    [TestMethod]
    public async Task LiveCatalog()
    {
        if (Environment.GetEnvironmentVariable("SHORTIZLE_LIVE_TEST") != "1") { Assert.Inconclusive("Opt-in live catalog check"); return; }
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ShortizleCatalogService(cache);
        var catalog = await service.GetCollectionsAsync(default);
        Assert.IsTrue(catalog.Collections.Count > 0);
        var title = catalog.Collections.SelectMany(c => c.Items).First();
        var detail = await service.GetSeriesAsync(title.Slug, default);
        Assert.AreEqual(title.Name, detail.Name);
        Assert.IsTrue(detail.Seasons!.SelectMany(s => s.Episodes!).Any());
        var search = await service.SearchAsync(new ShortizleSearchQuery(Kind: "dublaj", Sort: "popular", Page: 1), default);
        Assert.IsTrue(search.Total > 0 && search.Items.Count > 0);
        // Upstream occasionally returns has_dublaj=false even with kind=dublaj; preserve its metadata.
        Assert.IsTrue(search.Items.Any(item => item.HasDublaj));
        var filtered = await service.SearchAsync(new ShortizleSearchQuery("selam", ["aksiyon"], "reelshort", "dublaj"), default);
        Assert.IsTrue(filtered.Page == 1 && filtered.Total >= 0);
    }

    private static async Task Expect(string code, Func<Task> operation)
    {
        try { await operation(); Assert.Fail("Expected " + code); }
        catch (ShortizleException ex) { Assert.AreEqual(code, ex.Code); }
    }
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        { var response = send(request); response.RequestMessage = request; return Task.FromResult(response); }
    }
}
