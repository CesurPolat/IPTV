using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using AngleSharp.Html.Parser;
using Application.Abstractions;

namespace Infrastructure.Services.Streaming.Shortizle;

public static class ShortizleParser
{
    public static JsonObject ParsePage(string html)
    {
        var doc = new HtmlParser().ParseDocument(html);
        var script = doc.QuerySelector("script[type='application/json'][data-page]");
        var json = script?.TextContent ?? doc.QuerySelector("[data-page]")?.GetAttribute("data-page");
        if (string.IsNullOrWhiteSpace(json))
        {
            if (doc.QuerySelector("input[type=password]") != null)
                throw new ShortizleException(401, "login_required", "Shortizle girişi gerekiyor.");
            throw new ShortizleException(502, "invalid_page", "Sayfa verisi bulunamadı; giriş veya site doğrulaması gerekebilir.");
        }
        try
        {
            return JsonNode.Parse(json)?["props"] as JsonObject
                ?? throw new ShortizleException(502, "invalid_page", "Beklenen props verisi bulunamadı.");
        }
        catch (System.Text.Json.JsonException) { throw new ShortizleException(502, "invalid_page", "Sayfa JSON verisi geçersiz."); }
    }

    public static IEnumerable<JsonObject> Sources(JsonObject props)
        => Candidates(props).Select(candidate => candidate.Source);

    public static IEnumerable<(JsonObject Source, string Group)> Candidates(JsonObject props)
    {
        foreach (var key in new[] { "externalSources", "sources" })
        {
            if (props[key] is JsonObject groups && groups.Any(pair => pair.Key is "dublaj" or "altyazi" or "fragman"))
            {
                foreach (var group in groups)
                    foreach (var source in Walk(group.Value)) yield return (source, group.Key);
            }
            else foreach (var source in Walk(props[key])) yield return (source, "main");
        }
        if (props["currentEpisode"] is JsonObject episode)
        {
            foreach (var source in Walk(episode["sources"])) yield return (source, "main");
            if (episode["video_url"] is JsonValue url && url.TryGetValue<string>(out var value) && !string.IsNullOrWhiteSpace(value))
                yield return (new JsonObject { ["url"] = value }, "main");
        }
    }

    private static IEnumerable<JsonObject> Walk(JsonNode? node)
    {
        if (node is JsonArray array)
            foreach (var item in array) foreach (var s in Walk(item)) yield return s;
        else if (node is JsonObject obj)
        {
            if (obj.ContainsKey("url") || obj.ContainsKey("resolve_url") || obj.ContainsKey("gateway_bootstrap")) yield return obj;
            else foreach (var pair in obj) foreach (var s in Walk(pair.Value)) yield return s;
        }
    }

    public static void ValidateManifest(string text)
    {
        if (!Regex.IsMatch(text.TrimStart('\uFEFF'), "\\A#EXTM3U(?:\\r?\\n|$)"))
            throw new ShortizleException(502, "invalid_manifest", "Kaynak geçerli bir HLS manifesti değil.");
    }

    public static string Rewrite(string text, Uri finalUri, Func<Uri, bool, string> register)
    {
        ValidateManifest(text);
        var lines = text.TrimStart('\uFEFF').Replace("\r\n", "\n").Split('\n');
        var nextPlaylist = false;
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            if (line.Length == 0) continue;
            if (line.StartsWith('#'))
            {
                var playlist = line.StartsWith("#EXT-X-MEDIA:") || line.StartsWith("#EXT-X-I-FRAME-STREAM-INF:") || line.StartsWith("#EXT-X-RENDITION-REPORT:");
                lines[i] = Regex.Replace(lines[i], "(?<prefix>\\bURI=)\"(?<uri>[^\"]+)\"", m =>
                    m.Groups["prefix"].Value + "\"" + register(new Uri(finalUri, m.Groups["uri"].Value), playlist) + "\"");
                if (line.StartsWith("#EXT-X-STREAM-INF:")) nextPlaylist = true;
            }
            else
            {
                lines[i] = register(new Uri(finalUri, line), nextPlaylist);
                nextPlaylist = false;
            }
        }
        return string.Join("\n", lines);
    }
}
