using System.Collections.Concurrent;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Application.Abstractions;

namespace Infrastructure.Services.Streaming.Shortizle;

public sealed class ShortizleService : IShortizleResolver, IShortizlePlayback, IDisposable
{
    private sealed record Resource(Uri Uri, bool Manifest);
    private sealed record MasterSnapshot(Resource Resource, DateTimeOffset? Expires);
    private sealed class Session(HttpClient client, Uri episode) : IDisposable
    {
        public HttpClient Client { get; } = client;
        public Uri Episode { get; } = episode;
        public Resource Master { get; set; } = null!;
        public DateTimeOffset? Expires { get; set; }
        public DateTimeOffset LastUsed { get; set; } = DateTimeOffset.UtcNow;
        public string SourceKey { get; set; } = "";
        public string SourceGroup { get; set; } = "";
        public string[] SourceGroups { get; set; } = [];
        public int Revision { get; set; }
        public Dictionary<int, MasterSnapshot> Masters { get; } = new();
        public HashSet<string> FailedSources { get; } = new(StringComparer.Ordinal);
        public ConcurrentDictionary<string, Resource> Resources { get; } = new();
        public Dictionary<Resource, string> ResourceIds { get; } = new();
        public SemaphoreSlim Gate { get; } = new(1, 1);
        public void Dispose() => Client.Dispose();
    }

    private readonly ConcurrentDictionary<string, Session> _sessions = new();
    private readonly Func<HttpClient> _clients;
    private readonly TimeProvider _time;
    private readonly Timer _cleanup;
    public ShortizleService() : this(ShortizleHttp.CreateClient) { }
    public ShortizleService(Func<HttpClient> clients, TimeProvider? time = null)
    {
        _clients = clients;
        _time = time ?? TimeProvider.System;
        _cleanup = new Timer(_ => Cleanup(), null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
    }

    public static bool IsEpisode(Uri uri) => uri.Scheme == "https" && uri.Host.Equals("shortizle.com", StringComparison.OrdinalIgnoreCase)
        && uri.IsDefaultPort && uri.UserInfo.Length == 0 && uri.Query.Length == 0 && uri.Fragment.Length == 0
        && Regex.IsMatch(uri.AbsolutePath, "^/watch/[a-zA-Z0-9_-]+/[1-9][0-9]*/[1-9][0-9]*/?$");

    public async Task<string> ResolveAsync(Uri episode, CancellationToken cancellationToken)
    {
        if (!IsEpisode(episode)) throw new ShortizleException(400, "invalid_url", "Geçerli bir Shortizle bölüm adresi gerekiyor.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(90));
        cancellationToken = deadline.Token;
        var session = new Session(_clients(), episode);
        try
        {
            await ResolveSession(session, false, cancellationToken);
            session.Masters[0] = new(session.Master, session.Expires);
            session.LastUsed = _time.GetUtcNow();
            var id = Guid.NewGuid().ToString("N");
            _sessions[id] = session;
            return id;
        }
        catch { session.Dispose(); throw; }
    }

    private static string? Str(JsonObject obj, string key) => obj[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
    private static bool Hex(string? value) => value != null && Regex.IsMatch(value, "^[0-9a-f]{64}$");

    private static async Task<JsonObject> Json(Session session, Uri uri, CancellationToken ct,
        HttpMethod? method = null, string? body = null, Dictionary<string, string>? headers = null)
    {
        using var response = await ShortizleHttp.SendAsync(session.Client, uri, ct, method, body, headers);
        ShortizleHttp.EnsureSuccess(response);
        try { return JsonNode.Parse(await ShortizleHttp.TextAsync(response, ct)) as JsonObject ?? throw new System.Text.Json.JsonException(); }
        catch (System.Text.Json.JsonException) { throw new ShortizleException(502, "invalid_response", "Çözümleyici JSON yanıtı geçersiz."); }
    }

    private static Uri ResolverUri(Session session, string url)
    {
        var uri = new Uri(session.Episode, url);
        ShortizleHttp.Validate(uri);
        if (uri.Host != "shortizle.com") throw new ShortizleException(502, "invalid_upstream", "Çözümleyici aynı sitede olmalı.");
        return uri;
    }

    private static async Task<JsonObject> ResolveSource(Session session, JsonObject source, CancellationToken ct)
    {
        var headers = new Dictionary<string, string> { ["Accept"] = "application/json", ["X-Storage-Pilot"] = "1", ["X-Protected-Storage"] = "1" };
        var resolveUrl = Str(source, "resolve_url");
        var result = resolveUrl == null ? source : await Json(session, ResolverUri(session, resolveUrl), ct, headers: headers);
        if (Str(result, "type") == "protected-storage")
        {
            if (Str(result, "base_url") != "https://storage-pilot.shortizle.com")
                throw new ShortizleException(502, "invalid_authorization", "Storage adresi geçersiz.");
            var storage = await Json(session, new Uri("https://storage-pilot.shortizle.com/session"), ct, HttpMethod.Post, "{}");
            var sid = Str(storage, "sid");
            if (!Hex(sid) || resolveUrl == null) throw new ShortizleException(502, "invalid_authorization", "Storage oturumu geçersiz.");
            headers["X-Storage-Session"] = sid!;
            result = await Json(session, ResolverUri(session, resolveUrl), ct, headers: headers);
            var baseUrl = Str(result, "base_url");
            if (Str(result, "type") != "protected-storage" || !Hex(Str(result, "ticket")) ||
                !Uri.TryCreate(baseUrl, UriKind.Absolute, out var storageBase) || storageBase.AbsoluteUri.TrimEnd('/') != "https://storage-pilot.shortizle.com")
                throw new ShortizleException(502, "invalid_authorization", "Storage bileti geçersiz.");
            result = await Json(session, new Uri("https://storage-pilot.shortizle.com/authorize"), ct, HttpMethod.Post,
                new JsonObject { ["ticket"] = Str(result, "ticket") }.ToJsonString());
            if (!Uri.TryCreate(Str(result, "url"), UriKind.Absolute, out var authorized) ||
                authorized.Host != "storage-pilot.shortizle.com" || result["expires"] == null)
                throw new ShortizleException(502, "invalid_authorization", "Storage yetkilendirme yanıtı geçersiz.");
            result["type"] = "hls";
        }
        if (result["gateway_bootstrap"] is JsonObject gateway)
        {
            if (Str(gateway, "url") != "https://stream.shortizle.com/authorize" || string.IsNullOrWhiteSpace(Str(gateway, "token")) || Str(gateway, "token")!.Length > 20000)
                throw new ShortizleException(502, "invalid_authorization", "Gateway yetkilendirmesi geçersiz.");
            result = await Json(session, new Uri("https://stream.shortizle.com/authorize"), ct, HttpMethod.Post,
                new JsonObject { ["token"] = Str(gateway, "token") }.ToJsonString());
            if (result["credentialed"]?.ToString() != "true" || Str(result, "url") is not string gatewayUrl ||
                !Uri.TryCreate(gatewayUrl, UriKind.Absolute, out var gatewayUri) || gatewayUri.Host != "stream.shortizle.com" ||
                !gatewayUri.AbsolutePath.StartsWith("/v1/") || gatewayUri.Query.Length != 0 || gatewayUri.Fragment.Length != 0)
                throw new ShortizleException(502, "invalid_authorization", "Gateway yanıtı geçersiz.");
            if (Str(result, "subtitle_url") is string gatewaySubtitle &&
                (!Uri.TryCreate(gatewaySubtitle, UriKind.Absolute, out var sub) || sub.Host != "stream.shortizle.com" ||
                !sub.AbsolutePath.StartsWith("/v1/") || sub.Query.Length != 0 || sub.Fragment.Length != 0))
                throw new ShortizleException(502, "invalid_authorization", "Gateway altyazı adresi geçersiz.");
        }
        if (result["credentialed"] != null && (result["credentialed"] is not JsonValue flag || !flag.TryGetValue<bool>(out _)))
            throw new ShortizleException(502, "invalid_response", "Credentialed alanı geçersiz.");
        if (Str(result, "subtitle_url") is string subtitle) ShortizleHttp.Validate(new Uri(session.Episode, subtitle));
        return result;
    }

    private static DateTimeOffset? Expiry(JsonObject result)
    {
        var node = result["expires_at"] ?? result["expires"];
        if (node == null) return null;
        if (long.TryParse(node.ToString(), out var seconds))
        {
            try { return DateTimeOffset.FromUnixTimeSeconds(seconds); } catch (ArgumentOutOfRangeException) { }
        }
        if (DateTimeOffset.TryParse(node.ToString(), out var date)) return date;
        throw new ShortizleException(502, "invalid_response", "Kaynak süre bilgisi geçersiz.");
    }

    private async Task ResolveSession(Session session, bool refresh, CancellationToken ct, bool fallback = false, int? sourceNumber = null, string? group = null)
    {
        using var page = await ShortizleHttp.SendAsync(session.Client, session.Episode, ct);
        ShortizleHttp.EnsureSuccess(page);
        var props = ShortizleParser.ParsePage(await ShortizleHttp.TextAsync(page, ct));
        if (props["access_granted"] is JsonValue access && access.TryGetValue<bool>(out var granted) && !granted)
            throw new ShortizleException(403, "access_denied", "Bu bölüm için giriş veya abonelik gerekiyor.");
        ShortizleException? lastError = null;
        var index = 0;
        var groupIndex = 0;
        var candidates = ShortizleParser.Candidates(props).ToArray();
        session.SourceGroups = candidates.Select(c => c.Group).Where(g => g != "fragman").Distinct().ToArray();
        // Prefer Turkish dubbing regardless of the upstream object's property order.
        foreach (var candidate in candidates.OrderBy(c => c.Group == "dublaj" ? 0 : 1))
        {
            if (group != null && candidate.Group != group) continue;
            var source = candidate.Source;
            var resolver = Str(source, "resolve_url");
            var identity = resolver ?? Str(source, "url") ?? $"/unknown/{index}";
            var key = candidate.Group + ":" + (source["id"]?.ToString() ??
                (Uri.TryCreate(session.Episode, identity, out var sourceUri) ? sourceUri.GetLeftPart(UriPartial.Path) : identity.Split('?')[0]));
            index++;
            if (sourceNumber.HasValue) {
                if (candidate.Group != (group ?? session.SourceGroup) || candidate.Group == "fragman") continue;
                if (++groupIndex != sourceNumber.Value) continue;
            }
            if (refresh && key != session.SourceKey) continue;
            if (candidate.Group == "fragman" || (fallback && (candidate.Group != session.SourceGroup || session.FailedSources.Contains(key)))) continue;
            try
            {
                using var sourceDeadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
                sourceDeadline.CancelAfter(TimeSpan.FromSeconds(20));
                var sourceCt = sourceDeadline.Token;
                var result = await ResolveSource(session, source, sourceCt);
                var type = Str(result, "type");
                if (type != null && type != "hls" && type != "native") throw new ShortizleException(502, "unsupported_source", "Kaynak türü desteklenmiyor.");
                var url = Str(result, "url") ?? throw new ShortizleException(502, "unsupported_source", "HLS adresi bulunamadı.");
                var uri = new Uri(session.Episode, url);
                var isManifest = type != "native";
                var probeHeaders = isManifest ? null : new Dictionary<string, string> { ["Range"] = "bytes=0-11" };
                using var manifest = await ShortizleHttp.SendAsync(session.Client, uri, sourceCt, headers: probeHeaders);
                ShortizleHttp.EnsureSuccess(manifest);
                if (isManifest) ShortizleParser.ValidateManifest(await ShortizleHttp.TextAsync(manifest, sourceCt));
                else {
                    using var body = await ShortizleHttp.DecodeAsync(manifest, sourceCt);
                    var header = new byte[12];
                    await body.ReadExactlyAsync(header, sourceCt);
                    if (!header.AsSpan(4, 4).SequenceEqual("ftyp"u8))
                        throw new ShortizleException(502, "invalid_media", "Native kaynak geçerli bir MP4 dosyası değil.");
                }
                var expires = Expiry(result);
                if (expires <= _time.GetUtcNow().AddSeconds(60)) throw new ShortizleException(502, "expired_source", "Kaynak süresi yetersiz.");
                session.Master = new Resource(uri, isManifest);
                session.Expires = expires;
                session.SourceKey = key;
                session.SourceGroup = candidate.Group;
                return;
            }
            catch (ShortizleException ex) { lastError = ex; if (ex.Status is 401 or 403) throw; if (fallback) session.FailedSources.Add(key); }
            catch (HttpRequestException) { lastError = new ShortizleException(502, "source_unavailable", "Kaynağa erişilemedi."); if (fallback) session.FailedSources.Add(key); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            { lastError = new ShortizleException(504, "source_timeout", "Kaynak zaman aşımına uğradı."); if (fallback) session.FailedSources.Add(key); }
            catch (Exception ex) when (ex is IOException or DecoderFallbackException or UriFormatException)
            { lastError = new ShortizleException(502, "invalid_response", "Kaynak yanıtı geçersiz."); if (fallback) session.FailedSources.Add(key); }
        }
        if (sourceNumber.HasValue) throw lastError ?? new ShortizleException(404, "source_not_found", "Bu numarada kaynak bulunamadı.");
        if (fallback) throw new ShortizleException(502, "sources_exhausted", "Aynı dilde çalışan başka kaynak bulunamadı. Bölüm listesinden tekrar açabilirsiniz.");
        throw lastError ?? new ShortizleException(502, "unsupported_source", "Kullanılabilir HLS kaynağı bulunamadı.");
    }

    public async Task<int> SwitchSourceAsync(string sessionId, int revision, CancellationToken cancellationToken, int? sourceNumber = null, string? group = null)
    {
        if (group is not (null or "dublaj" or "altyazi" or "main")) throw new ShortizleException(400, "invalid_group", "Ses dili geçersiz.");
        if (revision < 0) throw new ShortizleException(400, "invalid_revision", "Kaynak sürümü geçersiz.");
        if (sourceNumber is < 1) throw new ShortizleException(400, "invalid_source", "Kaynak numarası geçersiz.");
        if (!_sessions.TryGetValue(sessionId, out var session)) throw Gone();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(90));
        await session.Gate.WaitAsync(deadline.Token);
        try
        {
            if (session.LastUsed < _time.GetUtcNow().AddMinutes(-30)) throw Gone();
            session.LastUsed = _time.GetUtcNow();
            if (revision < session.Revision) return session.Revision;
            if (revision != session.Revision) throw new ShortizleException(409, "invalid_revision", "Kaynak sürümü geçersiz.");
            if (!sourceNumber.HasValue && group == null) session.FailedSources.Add(session.SourceKey);
            await ResolveSession(session, false, deadline.Token, fallback: !sourceNumber.HasValue && group == null, sourceNumber: sourceNumber, group: group);
            session.Masters[++session.Revision] = new(session.Master, session.Expires);
            return session.Revision;
        }
        finally { session.Gate.Release(); }
    }

    public async Task<string> GetPlaybackFileAsync(string sessionId, int revision, CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionId, out var session)) throw Gone();
        await session.Gate.WaitAsync(cancellationToken);
        try
        {
            if (session.LastUsed < _time.GetUtcNow().AddMinutes(-30)) throw Gone();
            if (!session.Masters.TryGetValue(revision, out var snapshot))
                throw new ShortizleException(400, "invalid_revision", "Kaynak sürümü geçersiz.");
            return snapshot.Resource.Manifest ? "master.m3u8" : "media.mp4";
        }
        finally { session.Gate.Release(); }
    }

    public async Task<ShortizleAudioOptions> GetAudioOptionsAsync(string sessionId, CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionId, out var session)) throw Gone();
        await session.Gate.WaitAsync(cancellationToken);
        try
        {
            if (session.LastUsed < _time.GetUtcNow().AddMinutes(-30)) throw Gone();
            return new(session.SourceGroup, session.SourceGroups.ToArray());
        }
        finally { session.Gate.Release(); }
    }

    public async Task<ShortizleResource> OpenAsync(string sessionId, string? resourceId, string? range,
        Func<string, string> resourceUrl, CancellationToken cancellationToken, int? revision = null)
    {
        if (!_sessions.TryGetValue(sessionId, out var session)) throw Gone();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(90));
        cancellationToken = deadline.Token;
        await session.Gate.WaitAsync(cancellationToken);
        try
        {
            if (session.LastUsed < _time.GetUtcNow().AddMinutes(-30)) throw Gone();
            session.LastUsed = _time.GetUtcNow();
            // Bare master URLs belong to the initial source, even after another request switches.
            var requestedRevision = revision ?? 0;
            if (resourceId == null && !session.Masters.ContainsKey(requestedRevision))
                throw new ShortizleException(400, "invalid_revision", "Kaynak sürümü geçersiz.");
            if (resourceId == null && requestedRevision == session.Revision && session.Expires <= _time.GetUtcNow().AddSeconds(60)) {
                await ResolveSession(session, true, cancellationToken);
                session.Masters[session.Revision] = new(session.Master, session.Expires);
            }
            if (resourceId == null && session.Masters[requestedRevision].Expires <= _time.GetUtcNow())
                throw new ShortizleException(410, "source_expired", "Bu kaynağın süresi doldu; bölümü tekrar açın.");
            // Resource IDs retain their exact upstream URLs across refresh; never remap old segments.
            var resource = resourceId == null ? session.Masters[requestedRevision].Resource : session.Resources.TryGetValue(resourceId, out var found) ? found
                : throw new ShortizleException(404, "resource_not_found", "Kaynak bulunamadı.");
            if (range != null && !System.Net.Http.Headers.RangeHeaderValue.TryParse(range, out _))
                throw new ShortizleException(400, "invalid_range", "Range başlığı geçersiz.");
            var headers = !resource.Manifest && range != null ? new Dictionary<string, string> { ["Range"] = range } : null;
            var response = await ShortizleHttp.SendAsync(session.Client, resource.Uri, cancellationToken, headers: headers);
            try
            {
                if ((int)response.StatusCode != 416) ShortizleHttp.EnsureSuccess(response);
                var mediaType = response.Content.Headers.ContentType?.MediaType ?? "application/octet-stream";
                if ((resource.Manifest || mediaType.Equals("application/vnd.apple.mpegurl", StringComparison.OrdinalIgnoreCase) ||
                    mediaType.Equals("application/x-mpegurl", StringComparison.OrdinalIgnoreCase)) && (int)response.StatusCode != 416)
                {
                    var text = await ShortizleHttp.TextAsync(response, cancellationToken);
                    var finalUri = response.RequestMessage?.RequestUri ?? resource.Uri;
                    var rewritten = ShortizleParser.Rewrite(text, finalUri, (uri, isManifest) =>
                    {
                        ShortizleHttp.Validate(uri);
                        var entry = new Resource(uri, isManifest);
                        if (!session.ResourceIds.TryGetValue(entry, out var id))
                        {
                            if (session.Resources.Count >= 20000) throw new ShortizleException(502, "resource_limit", "Oynatma kaynağı sınırı aşıldı.");
                            // Preserve only a known media suffix for players that validate HLS extensions.
                            var suffix = isManifest ? ".m3u8" : Path.GetExtension(uri.AbsolutePath).ToLowerInvariant();
                            if (suffix is not (".m3u8" or ".ts" or ".m4s" or ".mp4" or ".aac" or ".vtt" or ".webvtt" or ".key" or ".mp3" or ".cmfv" or ".cmfa")) suffix = "";
                            id = Guid.NewGuid().ToString("N") + suffix; session.ResourceIds[entry] = id; session.Resources[id] = entry;
                        }
                        return resourceUrl(id);
                    });
                    response.Dispose();
                    return new ShortizleResource { Body = new MemoryStream(Encoding.UTF8.GetBytes(rewritten)), ContentType = "application/vnd.apple.mpegurl" };
                }
                if (response.Content.Headers.ContentEncoding.Any(e => e != "identity") && (int)response.StatusCode == 206)
                    throw new ShortizleException(502, "encoded_range", "Sıkıştırılmış byte-range yanıtı desteklenmiyor.");
                var outputHeaders = new Dictionary<string, string>();
                if (response.Content.Headers.ContentEncoding.All(encoding => encoding == "identity") && response.Content.Headers.ContentLength is long contentLength)
                    outputHeaders["Content-Length"] = contentLength.ToString(System.Globalization.CultureInfo.InvariantCulture);
                foreach (var name in new[] { "Content-Range", "Accept-Ranges" })
                {
                    if (response.Content.Headers.TryGetValues(name, out var values) || response.Headers.TryGetValues(name, out values))
                        outputHeaders[name] = string.Join(", ", values);
                }
                return new ShortizleResource { Body = await ShortizleHttp.DecodeAsync(response, cancellationToken), ContentType = mediaType,
                    Status = (int)response.StatusCode, Headers = outputHeaders, Owner = response };
            }
            catch { response.Dispose(); throw; }
        }
        finally { session.Gate.Release(); }
    }

    private static ShortizleException Gone() => new(410, "session_expired", "API oturumu sona erdi; yeni oynatma URL’si isteyin.");
    private void Cleanup()
    {
        foreach (var item in _sessions)
        {
            if (!item.Value.Gate.Wait(0)) continue;
            try
            {
                if (item.Value.LastUsed < _time.GetUtcNow().AddMinutes(-30) && _sessions.TryRemove(item.Key, out var removed)) removed.Dispose();
            }
            finally { item.Value.Gate.Release(); }
        }
    }
    public void Dispose() { _cleanup.Dispose(); foreach (var s in _sessions.Values) s.Dispose(); _sessions.Clear(); }
}
