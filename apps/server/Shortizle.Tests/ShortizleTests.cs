using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Application.Abstractions;
using Infrastructure.Services.Streaming.Shortizle;
using IPTVAPI.Controllers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using IPTVAPI.Application.Abstractions;
using IPTVAPI.Application.DTOs;

namespace Shortizle.Tests;

[TestClass]
public sealed class ShortizleTests
{
    private static readonly Uri Episode = new("https://shortizle.com/watch/example/1/1");
    private const string Master = "https://api.mybigdramapool.com/media/master.m3u8";
    private static string Page(string sources) => "<script type='application/json' data-page='app'>{\"props\":{\"externalSources\":" + sources + "}}</script>";
    private static HttpResponseMessage Response(string value, string contentType = "application/json", HttpStatusCode status = HttpStatusCode.OK)
        => new(status) { Content = new StringContent(value, Encoding.UTF8, contentType) };
    private static HttpClient Client(Func<HttpRequestMessage, HttpResponseMessage> send) => new(new Handler(send));
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            Assert.AreEqual("identity", request.Headers.GetValues("Accept-Encoding").Single());
            Assert.AreEqual("https://shortizle.com", request.Headers.GetValues("Origin").Single());
            Assert.IsFalse(request.Headers.Contains("Authorization"));
            var response = send(request); response.RequestMessage = request;
            return Task.FromResult(response);
        }
    }
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private static async Task<ShortizleException> Error(string code, Func<Task> action)
    {
        try { await action(); Assert.Fail("Expected " + code); }
        catch (ShortizleException ex) { Assert.AreEqual(code, ex.Code); return ex; }
        throw new Exception("Unreachable");
    }
    private static string Id(string line) => line.Split('/').Last();

    [TestMethod]
    public void ParsesBothInertiaFormatsAndOrderedGroups()
    {
        var sources = "{\"dublaj\":[{\"id\":1,\"url\":\"/a\"}],\"altyazi\":[{\"id\":2,\"resolve_url\":\"/b\"}]}";
        var script = ShortizleParser.ParsePage(Page(sources));
        var json = "{\"props\":{\"externalSources\":" + sources + "}}";
        var attr = ShortizleParser.ParsePage("<div data-page=\"" + WebUtility.HtmlEncode(json) + "\"></div>");
        CollectionAssert.AreEqual(new[] { "1", "2" }, ShortizleParser.Sources(script).Select(s => s["id"]!.ToString()).ToArray());
        Assert.AreEqual(script.ToJsonString(), attr.ToJsonString());
    }

    [TestMethod]
    public async Task RejectsLoginChallengeMalformedAndMissingProps()
    {
        await Error("login_required", () => Task.FromResult(ShortizleParser.ParsePage("<input type=password>")));
        await Error("invalid_page", () => Task.FromResult(ShortizleParser.ParsePage("<h1>Just a moment...</h1>")));
        await Error("invalid_page", () => Task.FromResult(ShortizleParser.ParsePage("<script type='application/json' data-page='app'>{broken}</script>")));
        await Error("invalid_page", () => Task.FromResult(ShortizleParser.ParsePage("<div data-page='{}'></div>")));
    }

    [TestMethod]
    public async Task ValidatesUrlsAndPublicAddresses()
    {
        foreach (var url in new[] { "http://shortizle.com/watch/a/1/1", "https://shortizle.com.evil.test/watch/a/1/1", "https://shortizle.com/watch/a/0/1", "https://shortizle.com/watch/a/1/1?url=bad" })
            Assert.IsFalse(ShortizleService.IsEpisode(new Uri(url)));
        foreach (var url in new[] { "https://127.0.0.1/", "https://shortizle.com:444/a", "http://shortizle.com/a", "https://user@shortizle.com/", "https://evil.test/" })
            await Error("invalid_upstream", () => { ShortizleHttp.Validate(new Uri(url)); return Task.CompletedTask; });
        foreach (var ip in new[] { "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "::ffff:127.0.0.1" })
            Assert.IsFalse(ShortizleHttp.IsPublic(IPAddress.Parse(ip)), ip);
        Assert.IsTrue(ShortizleHttp.IsPublic(IPAddress.Parse("8.8.8.8")));
    }

    [TestMethod]
    public async Task DecodesSupportedEncodingsAndRejectsZstd()
    {
        foreach (var encoding in new[] { "identity", "gzip", "deflate", "br" })
        {
            using var buffer = new MemoryStream();
            if (encoding == "identity") buffer.Write(Encoding.UTF8.GetBytes("\uFEFF#EXTM3U\n"));
            else
            {
                using Stream compressed = encoding switch
                {
                    "gzip" => new GZipStream(buffer, CompressionLevel.Fastest, true),
                    "deflate" => new ZLibStream(buffer, CompressionLevel.Fastest, true),
                    _ => new BrotliStream(buffer, CompressionLevel.Fastest, true)
                };
                compressed.Write(Encoding.UTF8.GetBytes("\uFEFF#EXTM3U\n"));
            }
            using var response = new HttpResponseMessage { Content = new ByteArrayContent(buffer.ToArray()) };
            response.Content.Headers.ContentEncoding.Add(encoding);
            Assert.AreEqual("#EXTM3U\n", await ShortizleHttp.TextAsync(response, default));
        }
        using var zstd = Response("not a decoded manifest"); zstd.Content.Headers.ContentEncoding.Add("zstd");
        await Error("unsupported_encoding", () => ShortizleHttp.TextAsync(zstd, default));
    }

    [TestMethod]
    public void RewritesAllHlsReferencesAgainstFinalUri()
    {
        var found = new List<(Uri Uri, bool Manifest)>();
        var text = "\uFEFF#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI=\"../sub/list.m3u8\"\n#EXT-X-I-FRAME-STREAM-INF:URI=\"iframe.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n#EXT-X-KEY:METHOD=AES-128,URI=\"key?k=1&x=2\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1,\nhttps://stream.shortizle.com/v1/part\n";
        var rewritten = ShortizleParser.Rewrite(text, new Uri(Master), (u, p) => { found.Add((u, p)); return "/resource/" + found.Count; });
        Assert.AreEqual(6, found.Count);
        Assert.AreEqual("https://api.mybigdramapool.com/sub/list.m3u8", found[0].Uri.AbsoluteUri);
        Assert.IsTrue(found.Take(3).All(x => x.Manifest));
        Assert.IsTrue(found.Skip(3).All(x => !x.Manifest));
        Assert.IsFalse(rewritten.Contains("https://"));
    }

    [TestMethod]
    public async Task FallsBackFromNonHlsAndReturnsOnlyOpaqueResources()
    {
        using var service = new ShortizleService(() => Client(r => r.RequestUri!.Host == "shortizle.com"
            ? Response(Page("[{\"type\":\"iframe\",\"url\":\"https://shortizle.com/embed\"},{\"url\":\"" + Master + "\"}]"))
            : Response("#EXTM3U\n#EXTINF:1,\nsegment.ts\n", "application/vnd.apple.mpegurl")));
        var id = await service.ResolveAsync(Episode, default);
        using var result = await service.OpenAsync(id, null, null, x => "/resource/" + x, default);
        var text = await new StreamReader(result.Body).ReadToEndAsync();
        Assert.IsFalse(text.Contains("segment.ts")); Assert.IsFalse(text.Contains("https://"));
        Assert.AreEqual(32, Path.GetFileNameWithoutExtension(Id(text.Split('\n')[2])).Length);
        Assert.IsFalse(result.Headers.ContainsKey("Content-Encoding"));
        Assert.IsFalse(result.Headers.ContainsKey("Content-Length"));
    }

    [TestMethod]
    public async Task RejectsInvalidManifestAndUnsupportedSources()
    {
        using var service = new ShortizleService(() => Client(r => r.RequestUri!.Host == "shortizle.com"
            ? Response(Page("[{\"url\":\"" + Master + "\"}]")) : Response("<html>login</html>", "application/vnd.apple.mpegurl")));
        await Error("invalid_manifest", () => service.ResolveAsync(Episode, default));
        using var unsupported = new ShortizleService(() => Client(_ => Response(Page("[{\"type\":\"mp4\",\"url\":\"/video.mp4\"}]"))));
        await Error("unsupported_source", () => unsupported.ResolveAsync(Episode, default));
        await Error("invalid_manifest", () => { ShortizleParser.ValidateManifest("#EXTM3UX\n"); return Task.CompletedTask; });
    }

    [TestMethod]
    public async Task DenialsAndPaywallRemainExplicit()
    {
        foreach (var (status, code) in new[] { (401, "login_required"), (403, "access_denied"), (404, "not_found"), (500, "upstream_error") })
        {
            using var service = new ShortizleService(() => Client(_ => Response("denied", status: (HttpStatusCode)status)));
            var error = await Error(code, () => service.ResolveAsync(Episode, default));
            Assert.AreEqual(status == 500 ? 502 : status, error.Status);
        }
        using var paywall = new ShortizleService(() => Client(_ => Response("<script type='application/json' data-page='app'>{\"props\":{\"access_granted\":false}}</script>")));
        await Error("access_denied", () => paywall.ResolveAsync(Episode, default));
    }

    [TestMethod]
    public async Task RedirectedManifestUsesFinalBaseAndBlocksInvalidChildren()
    {
        using var service = new ShortizleService(() => Client(r =>
        {
            if (r.RequestUri!.Host == "shortizle.com") return Response(Page("[{\"url\":\"" + Master + "\"}]"));
            if (r.RequestUri.AbsolutePath == "/media/master.m3u8")
            {
                var redirect = Response("", status: HttpStatusCode.Redirect);
                redirect.Headers.Location = new Uri("https://stream.shortizle.com/final/master.m3u8");
                return redirect;
            }
            if (r.RequestUri.AbsolutePath.EndsWith("m3u8")) return Response("#EXTM3U\n#EXTINF:1,\nsegment.ts\n");
            Assert.AreEqual("https://stream.shortizle.com/final/segment.ts", r.RequestUri.AbsoluteUri);
            return Response("correct-base", "video/mp2t");
        }));
        var id = await service.ResolveAsync(Episode, default);
        using var root = await service.OpenAsync(id, null, null, x => x, default);
        var child = (await new StreamReader(root.Body).ReadToEndAsync()).Split('\n')[2];
        using var segment = await service.OpenAsync(id, child, null, x => x, default);
        Assert.AreEqual("correct-base", await new StreamReader(segment.Body).ReadToEndAsync());
        using var unsafeChildren = new ShortizleService(() => Client(r => r.RequestUri!.Host == "shortizle.com"
            ? Response(Page("[{\"url\":\"" + Master + "\"}]")) : Response("#EXTM3U\nhttps://127.0.0.1/secret\n")));
        var unsafeId = await unsafeChildren.ResolveAsync(Episode, default);
        await Error("invalid_upstream", () => unsafeChildren.OpenAsync(unsafeId, null, null, x => x, default));
    }

    [TestMethod]
    public async Task ProtectedStorageUsesSessionTicketAndSameClient()
    {
        var calls = new List<string>();
        var resolves = 0;
        using var service = new ShortizleService(() => Client(r =>
        {
            calls.Add(r.RequestUri!.AbsolutePath);
            return r.RequestUri.AbsolutePath switch
            {
                "/watch/example/1/1" => Response(Page("[{\"resolve_url\":\"/resolve\"}]")),
                "/resolve" => Resolve(),
                "/session" => Response("{\"sid\":\"" + new string('a', 64) + "\"}"),
                "/authorize" => Authorize(r),
                _ => Response("#EXTM3U\n#EXT-X-ENDLIST", "application/vnd.apple.mpegurl")
            };
            HttpResponseMessage Resolve()
            {
                resolves++;
                if (resolves == 2) Assert.AreEqual(new string('a', 64), r.Headers.GetValues("X-Storage-Session").Single());
                return Response("{\"type\":\"protected-storage\",\"base_url\":\"https://storage-pilot.shortizle.com\",\"ticket\":\"" + new string('b', 64) + "\"}");
            }
            HttpResponseMessage Authorize(HttpRequestMessage request)
            {
                Assert.AreEqual(HttpMethod.Post, request.Method);
                Assert.AreEqual(new string('b', 64), JsonNode.Parse(request.Content!.ReadAsStringAsync().Result)!["ticket"]!.ToString());
                return Response("{\"url\":\"https://storage-pilot.shortizle.com/s/manifest.m3u8\",\"expires\":" + DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds() + "}");
            }
        }));
        await service.ResolveAsync(Episode, default);
        CollectionAssert.AreEqual(new[] { "/watch/example/1/1", "/resolve", "/session", "/resolve", "/authorize", "/s/manifest.m3u8" }, calls);
    }

    [TestMethod]
    public async Task GatewayValidatesEndpointAndCredentialedResponse()
    {
        using var service = new ShortizleService(() => Client(r => r.RequestUri!.AbsolutePath switch
        {
            "/watch/example/1/1" => Response(Page("[{\"resolve_url\":\"/resolve\"}]")),
            "/resolve" => Response("{\"gateway_bootstrap\":{\"url\":\"https://stream.shortizle.com/authorize\",\"token\":\"test-token\"}}"),
            "/authorize" => Response("{\"type\":\"hls\",\"credentialed\":true,\"url\":\"https://stream.shortizle.com/v1/extensionless\"}"),
            _ => Response("#EXTM3U\n#EXT-X-ENDLIST")
        }));
        await service.ResolveAsync(Episode, default);
        using var invalid = new ShortizleService(() => Client(_ => Response(Page("[{\"gateway_bootstrap\":{\"url\":\"https://evil.test/authorize\",\"token\":\"t\"}}]"))));
        await Error("invalid_authorization", () => invalid.ResolveAsync(Episode, default));
    }

    [TestMethod]
    public async Task RangeResponsesPreserveStatusAndBytes()
    {
        var requestedRanges = new List<string>();
        using var service = new ShortizleService(() => Client(r =>
        {
            if (r.RequestUri!.Host == "shortizle.com") return Response(Page("[{\"url\":\"" + Master + "\"}]"));
            if (r.RequestUri.AbsolutePath.EndsWith(".m3u8")) return Response("#EXTM3U\n#EXTINF:1,\nsegment.m4s\n");
            var range = r.Headers.Range!.ToString(); requestedRanges.Add(range);
            var response = Response(range == "bytes=0-2" ? "abc" : "", "video/mp4", range == "bytes=0-2" ? HttpStatusCode.PartialContent : HttpStatusCode.RequestedRangeNotSatisfiable);
            response.Content.Headers.TryAddWithoutValidation("Content-Range", range == "bytes=0-2" ? "bytes 0-2/10" : "bytes */10");
            response.Headers.TryAddWithoutValidation("Accept-Ranges", "bytes");
            return response;
        }));
        var id = await service.ResolveAsync(Episode, default);
        using var master = await service.OpenAsync(id, null, null, x => x, default);
        var resourceId = (await new StreamReader(master.Body).ReadToEndAsync()).Split('\n')[2];
        using var part = await service.OpenAsync(id, resourceId, "bytes=0-2", x => x, default);
        Assert.AreEqual(206, part.Status); Assert.AreEqual("abc", await new StreamReader(part.Body).ReadToEndAsync());
        Assert.AreEqual("bytes 0-2/10", part.Headers["Content-Range"]);
        using var unsatisfied = await service.OpenAsync(id, resourceId, "bytes=20-", x => x, default);
        Assert.AreEqual(416, unsatisfied.Status); Assert.AreEqual("bytes */10", unsatisfied.Headers["Content-Range"]);
    }

    [TestMethod]
    public async Task RefreshIsSingleAndDoesNotRemapOldSegments()
    {
        var clock = new Clock(); var pages = 0; var version = 0; var requested = new List<string>();
        using var service = new ShortizleService(() => Client(r =>
        {
            var path = r.RequestUri!.AbsolutePath; requested.Add(path);
            if (path.StartsWith("/watch/")) { pages++; return Response(Page("[{\"id\":42,\"resolve_url\":\"/resolve?signature=" + pages + "\"}]")); }
            if (path == "/resolve") { version++; return Response("{\"type\":\"hls\",\"url\":\"https://stream.shortizle.com/v" + version + "/master.m3u8\",\"expires\":" + clock.Now.AddMinutes(2).ToUnixTimeSeconds() + "}"); }
            return path.EndsWith("m3u8") ? Response("#EXTM3U\n#EXTINF:1,\nsegment.ts\n") : Response("segment", "video/mp2t");
        }), clock);
        var id = await service.ResolveAsync(Episode, default);
        using var old = await service.OpenAsync(id, null, null, x => x, default);
        var oldId = (await new StreamReader(old.Body).ReadToEndAsync()).Split('\n')[2];
        clock.Now = clock.Now.AddSeconds(70);
        var results = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => service.OpenAsync(id, null, null, x => x, default)));
        foreach (var r in results) r.Dispose();
        Assert.AreEqual(2, pages);
        using var segment = await service.OpenAsync(id, oldId, null, x => x, default);
        Assert.AreEqual("/v1/segment.ts", requested.Last());
        clock.Now = clock.Now.AddMinutes(31);
        var expired = await Error("session_expired", () => service.OpenAsync(id, null, null, x => x, default));
        Assert.AreEqual(410, expired.Status);
    }

    [TestMethod]
    public async Task SessionsHaveSeparateClientsAndResourceNamespaces()
    {
        var clients = 0;
        using var service = new ShortizleService(() =>
        {
            clients++;
            return Client(r => r.RequestUri!.Host == "shortizle.com" ? Response(Page("[{\"url\":\"" + Master + "\"}]")) : Response("#EXTM3U\n#EXTINF:1,\nsegment.ts\n"));
        });
        var first = await service.ResolveAsync(Episode, default); var second = await service.ResolveAsync(Episode, default);
        Assert.AreEqual(2, clients); Assert.AreNotEqual(first, second);
        using var root = await service.OpenAsync(first, null, null, x => x, default);
        var id = (await new StreamReader(root.Body).ReadToEndAsync()).Split('\n')[2];
        await Error("resource_not_found", () => service.OpenAsync(second, id, null, x => x, default));
    }

    [TestMethod]
    public async Task RedirectsAreValidatedBeforeFollowing()
    {
        var calls = 0;
        using var client = Client(_ => { calls++; var response = Response("", status: HttpStatusCode.Redirect); response.Headers.Location = new Uri("https://127.0.0.1/secret"); return response; });
        await Error("invalid_upstream", () => ShortizleHttp.SendAsync(client, Episode, default));
        Assert.AreEqual(1, calls);
        using var loop = Client(_ => { var response = Response("", status: HttpStatusCode.Redirect); response.Headers.Location = new Uri("/loop", UriKind.Relative); return response; });
        await Error("redirect_limit", () => ShortizleHttp.SendAsync(loop, Episode, default));
    }

    [TestMethod]
    public void MapsErrorsToProblemDetails()
    {
        foreach (var (exception, status, code) in new (Exception, int, string)[]
        {
            (new ShortizleException(403, "access_denied", "denied"),403,"access_denied"),
            (new TaskCanceledException(),504,"upstream_timeout"),
            (new HttpRequestException(),502,"upstream_error")
        })
        {
            var action = new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor());
            var context = new ExceptionContext(action, new List<IFilterMetadata>()) { Exception = exception };
            new ShortizleErrorsAttribute().OnException(context);
            Assert.IsTrue(context.ExceptionHandled);
            var result = (ObjectResult)context.Result!;
            Assert.AreEqual(status, result.StatusCode);
            Assert.AreEqual(code, ((ProblemDetails)result.Value!).Extensions["code"]);
        }
    }

    [TestMethod]
    public async Task LiveSmoke()
    {
        if (Environment.GetEnvironmentVariable("SHORTIZLE_LIVE_TEST") != "1") { Assert.Inconclusive("Opt-in live network check: SHORTIZLE_LIVE_TEST=1"); return; }
        using var service = new ShortizleService();
        var id = await service.ResolveAsync(new Uri("https://shortizle.com/watch/ustanin-oyunu-rjes/1/1"), default);
        string? resourceId = null;
        for (var depth = 0; depth < 5; depth++)
        {
            using var response = await service.OpenAsync(id, resourceId, null, x => "/resource/" + x, default);
            if (response.ContentType != "application/vnd.apple.mpegurl")
            {
                var buffer = new byte[188]; Assert.IsTrue(await response.Body.ReadAsync(buffer) > 0);
                return;
            }
            var text = await new StreamReader(response.Body).ReadToEndAsync();
            resourceId = Id(text.Split('\n').First(l => !l.StartsWith('#') && !string.IsNullOrWhiteSpace(l)));
        }
        Assert.Fail("No media bytes reached");
    }

    private sealed class LegacyStub : IStreamingService
    {
        public Task<string> GetMediaUrl(string url) => Task.FromResult("legacy");
        public Task<List<StreamingRawResult>> SearchContent(string term) => Task.FromResult(new List<StreamingRawResult>());
        public Task<StreamingSeriesDetail?> GetSeriesDetail(string id) => Task.FromResult<StreamingSeriesDetail?>(null);
    }

    [TestMethod]
    public async Task LiveHttpPlaybackDecodesVideoFrame()
    {
        if (Environment.GetEnvironmentVariable("SHORTIZLE_LIVE_TEST") != "1") { Assert.Inconclusive("Opt-in live HTTP/ffmpeg check"); return; }
        var builder = WebApplication.CreateBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddControllers().AddApplicationPart(typeof(ShortizleController).Assembly);
        builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
        builder.Services.AddSingleton<ShortizleService>();
        builder.Services.AddSingleton<IShortizleResolver>(sp => sp.GetRequiredService<ShortizleService>());
        builder.Services.AddSingleton<IShortizlePlayback>(sp => sp.GetRequiredService<ShortizleService>());
        builder.Services.AddKeyedSingleton<IStreamingService, LegacyStub>("Dizipal");
        builder.Services.AddKeyedSingleton<IStreamingService, LegacyStub>("Roketdizi");
        await using var app = builder.Build();
        app.UseCors();
        app.MapControllers();
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        global::Application.Helpers.ConfigHelper.APIUrl = address + "/";
        using var client = new HttpClient();
        var episode = "https://shortizle.com/watch/ustanin-oyunu-rjes/1/1";
        using var resolve = await client.GetAsync(address + "/Streaming/GetMediaUrl?url=" + Uri.EscapeDataString(episode));
        var playback = await resolve.Content.ReadAsStringAsync();
        Assert.AreEqual(HttpStatusCode.OK, resolve.StatusCode, playback);
        Assert.AreEqual("text/plain", resolve.Content.Headers.ContentType!.MediaType);
        Assert.IsTrue(playback.StartsWith(address + "/Streaming/Shortizle/"));
        Assert.IsTrue(playback.EndsWith("/master.m3u8"));
        var start = new System.Diagnostics.ProcessStartInfo("ffmpeg")
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true
        };
        // The upstream gateway legitimately uses extensionless media; the API validates every upstream URL.
        foreach (var arg in new[] { "-hide_banner", "-loglevel", "error", "-allowed_extensions", "ALL", "-allowed_segment_extensions", "ALL", "-extension_picky", "0", "-rw_timeout", "15000000", "-i", playback, "-map", "0:v:0", "-frames:v", "1", "-an", "-f", "null", "-" }) start.ArgumentList.Add(arg);
        using var process = System.Diagnostics.Process.Start(start)!;
        var stderr = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch { process.Kill(entireProcessTree: true); throw; }
        Assert.AreEqual(0, process.ExitCode, await stderr);
        if (Environment.GetEnvironmentVariable("SHORTIZLE_PREVIEW") == "1")
        {
            // Optional local UI verification; generated output stays under ignored bin/.
            await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "shortizle-preview-url.txt"), playback);
            await Task.Delay(TimeSpan.FromMinutes(2));
        }
        await app.StopAsync();
    }
}
