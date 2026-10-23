
using System.Text.RegularExpressions;
using System.Web;
using Domain.Enums;

namespace Application.Helpers
{
    public static class HLSHelper
    {

        public static bool IsHLSContent(this string content)
        {
            return content.Contains("#EXTM3U", StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsMediaPlaylist(this string content)
        {
            return content.Contains("#EXT-X-MEDIA", StringComparison.OrdinalIgnoreCase);
        }

        public static string SetBaseUrl(this string content, string baseUrl, string? referer = null, ConnectionMode connectionMode = ConnectionMode.HTTP, ProxyMode mode = ProxyMode.NONE)
        {
            var queryParams = new List<string>();
            switch(mode)
            {
                case ProxyMode.DIZIPAL_MASTER:
                    connectionMode = ConnectionMode.BROWSER;
                    queryParams.Add("mode=" + ((int)ProxyMode.DIZIPAL_PLAYLIST));
                    break;
                case ProxyMode.DIZIPAL_PLAYLIST:
                    connectionMode = ConnectionMode.HTTP;
                    queryParams.Add("mode=" + ((int)ProxyMode.DIZIPAL_DIRECT));
                    content = content.Replace(".jpg", ".ts");
                    break;
            }

            if (!string.IsNullOrEmpty(referer))
                queryParams.Add($"referer={HttpUtility.UrlEncode(mode == ProxyMode.DIZIPAL_PLAYLIST ? referer.Substring(0, referer.LastIndexOf("/") + 1) : referer)}");
            if (connectionMode != ConnectionMode.HTTP)
                queryParams.Add($"connectionMode={(int)connectionMode}");

            string[] lines = content.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries);
            var queryString = queryParams.Count > 0 ? "?" + string.Join("&", queryParams) : string.Empty;

            for (int i = 0; i < lines.Length; i++)
            {
                if (lines[0].StartsWith("<html>", StringComparison.OrdinalIgnoreCase))
                {
                    if (i == 0)
                        lines[0] = lines[0].Substring(lines[0].IndexOf("#"), lines[0].Length - lines[0].IndexOf("#"));
                    else if (i == lines.Length - 1)
                        lines[i] = lines[i].Substring(0, lines[i].Length - 14);
                }

                if (!lines[i].StartsWith('#'))
                {
                    lines[i] = baseUrl + HttpUtility.UrlEncode(lines[i]) + queryString;
                }
                else if (lines[i].StartsWith("#EXT-X-MEDIA", StringComparison.OrdinalIgnoreCase))
                {
                    lines[i] = Regex.Replace(lines[i], @"URI=[""'](.*?)[""']", match =>
                    {
                        var uri = match.Groups[1].Value;
                        if (string.IsNullOrEmpty(uri)) return match.Value;
                        return $"URI=\"{baseUrl}{HttpUtility.UrlEncode(uri)}{queryString}\"";
                    });
                }
            }

            return string.Join('\n', lines);
        }

    }
}
