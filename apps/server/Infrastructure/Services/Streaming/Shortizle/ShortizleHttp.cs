using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using Application.Abstractions;

namespace Infrastructure.Services.Streaming.Shortizle;

public static class ShortizleHttp
{
    private static readonly HashSet<string> Hosts = new(StringComparer.OrdinalIgnoreCase)
    { "shortizle.com", "storage-pilot.shortizle.com", "stream.shortizle.com", "api.mybigdramapool.com", "media.mybigdramapool.com", "short-depo-test.b-cdn.net" };

    public static void Validate(Uri uri)
    {
        if (uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo.Length != 0 || !Hosts.Contains(uri.IdnHost))
            throw new ShortizleException(502, "invalid_upstream", "Kaynak adresine izin verilmiyor.");
    }

    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) return IsPublic(address.MapToIPv4());
        var b = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetworkV6)
            return (b[0] & 0xe0) == 0x20 && !(b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8);
        return b[0] != 0 && b[0] != 10 && b[0] != 127 && b[0] < 224 &&
            !(b[0] == 169 && b[1] == 254) && !(b[0] == 172 && b[1] >= 16 && b[1] <= 31) &&
            !(b[0] == 192 && b[1] == 168) && !(b[0] == 100 && b[1] >= 64 && b[1] <= 127) &&
            !(b[0] == 198 && (b[1] == 18 || b[1] == 19));
    }

    public static HttpClient CreateClient()
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.None,
            CookieContainer = new CookieContainer(), UseCookies = true, UseProxy = false,
            ConnectTimeout = TimeSpan.FromSeconds(15),
            ConnectCallback = async (context, ct) =>
            {
                var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, ct);
                if (addresses.Length == 0 || addresses.Any(a => !IsPublic(a)))
                    throw new ShortizleException(502, "invalid_upstream", "Özel ağ kaynağı reddedildi.");
                foreach (var address in addresses)
                {
                    var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
                    try { await socket.ConnectAsync(address, context.DnsEndPoint.Port, ct); return new NetworkStream(socket, true); }
                    catch { socket.Dispose(); if (ct.IsCancellationRequested) throw; }
                }
                throw new HttpRequestException("Upstream connection failed.");
            }
        };
        return new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
    }

    public static async Task<HttpResponseMessage> SendAsync(HttpClient client, Uri uri, CancellationToken ct,
        HttpMethod? method = null, string? json = null, Dictionary<string, string>? headers = null)
    {
        method ??= HttpMethod.Get;
        for (var i = 0; i < 6; i++)
        {
            Validate(uri);
            using var request = new HttpRequestMessage(method, uri);
            request.Headers.TryAddWithoutValidation("Accept-Encoding", "identity");
            request.Headers.TryAddWithoutValidation("Origin", "https://shortizle.com");
            request.Headers.TryAddWithoutValidation("Referer", "https://shortizle.com/");
            request.Headers.TryAddWithoutValidation("User-Agent", "IPTVAPI/1.0");
            if (headers != null) foreach (var h in headers) request.Headers.TryAddWithoutValidation(h.Key, h.Value);
            if (json != null) request.Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
            var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if ((int)response.StatusCode is 301 or 302 or 303 or 307 or 308)
            {
                var location = response.Headers.Location;
                response.Dispose();
                if (location == null) throw new ShortizleException(502, "invalid_redirect", "Yönlendirme adresi eksik.");
                var next = new Uri(uri, location);
                // Never redirect authorization bodies or resolver-specific headers to another origin.
                if (next.Authority != uri.Authority && (method != HttpMethod.Get || headers?.Keys.Any(k => k != "Range") == true))
                    throw new ShortizleException(502, "invalid_redirect", "Yetkilendirme yönlendirmesi reddedildi.");
                uri = next;
                continue;
            }
            return response;
        }
        throw new ShortizleException(502, "redirect_limit", "Çok fazla yönlendirme.");
    }

    public static void EnsureSuccess(HttpResponseMessage response)
    {
        var code = (int)response.StatusCode;
        if (code is >= 200 and < 300) return;
        throw code switch
        {
            401 => new ShortizleException(401, "login_required", "Shortizle girişi gerekiyor."),
            403 => new ShortizleException(403, "access_denied", "Shortizle erişimi reddetti; abonelik veya doğrulama gerekebilir."),
            404 => new ShortizleException(404, "not_found", "Bölüm veya kaynak bulunamadı."),
            _ => new ShortizleException(502, "upstream_error", $"Kaynak sunucu HTTP {code} döndürdü.")
        };
    }

    public static async Task<Stream> DecodeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        Stream body = await response.Content.ReadAsStreamAsync(ct);
        foreach (var encoding in response.Content.Headers.ContentEncoding.Reverse())
        {
            body = encoding.ToLowerInvariant() switch
            {
                "identity" => body,
                "gzip" => new GZipStream(body, CompressionMode.Decompress),
                "deflate" => new ZLibStream(body, CompressionMode.Decompress),
                "br" => new BrotliStream(body, CompressionMode.Decompress),
                _ => throw new ShortizleException(502, "unsupported_encoding", "Kaynak sunucunun sıkıştırma biçimi desteklenmiyor.")
            };
        }
        return body;
    }

    public static async Task<string> TextAsync(HttpResponseMessage response, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        ct = deadline.Token;
        await using var body = await DecodeAsync(response, ct);
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int n;
        while ((n = await body.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + n > 4 * 1024 * 1024) throw new ShortizleException(502, "response_too_large", "Kaynak metni çok büyük.");
            buffer.Write(chunk, 0, n);
        }
        return new System.Text.UTF8Encoding(false, true).GetString(buffer.ToArray()).TrimStart('\uFEFF');
    }
}
