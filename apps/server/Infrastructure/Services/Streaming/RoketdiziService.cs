using Application.Helpers;
using Domain.Entities;
using Infrastructure.Services.Proxy;
using Infrastructure.Services.Scraping;
using IPTVAPI.Application.Abstractions;
using IPTVAPI.Application.DTOs;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Web;

namespace IPTVAPI.Infrastructure.Services.Streaming
{
    public class RoketdiziService : IStreamingService
    {
        private const string Pass = "3hPn4uCjTVtfYWcjIcoJQ4cL1WWk1qxXI39egLYOmNv6IblA7eKJz68uU3eLzux1biZLCms0quEjTYniGv5z1JcKbNIsDQFSeIZOBZJz4is6pD7UyWDggWWzTLBQbHcQFpBQdClnuQaMNUHtLHTpzCvZy33p6I7wFBvL4fnXBYH84aUIyWGTRvM2G5cfoNf4705tO2kv";

        private readonly HttpClient _httpClient;
        private static readonly JsonSerializerOptions _jsonOptions = new() { PropertyNameCaseInsensitive = true };

        public RoketdiziService()
        {
            _httpClient = new HttpClient();
            _httpClient.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        }

        public async Task<string> GetMediaUrl(string url)
        {
            // Get page HTML for decryption
            var referer = url.Substring(0, url.IndexOf("/", 8));

            var webHTMLResponse = await FlareSolverrConnection.GetConnection(url, null, referer, RequestType.GET);
            var webHTML = await webHTMLResponse.ReadAsStringAsync();
            var contentData = await ScrapingService.ExtractElementText(webHTML, "script#__NEXT_DATA__");

            if (contentData == null)
                throw new InvalidOperationException("Could not find content data.");

            // Parse Next.js data wrapper
            var nextData = JsonSerializer.Deserialize<NextDataWrapper>(contentData, _jsonOptions);
            var secureData = nextData?.Props?.PageProps?.SecureData;

            if (string.IsNullOrEmpty(secureData))
                throw new InvalidOperationException("Could not find secureData in Next.js data.");

            // Decode Base64 secure data
            var decodedSecureData = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(secureData));

            string? iframeUrl = null;

            using var doc = JsonDocument.Parse(decodedSecureData);
            var root = doc.RootElement;

            if (root.TryGetProperty("RelatedResults", out var relatedResults))
            {
                if (url.Contains("/film/"))
                {
                    // Film için: getMoviePartSourcesById_XXXXX pattern ile eşleşen key'leri ara
                    foreach (var prop in relatedResults.EnumerateObject())
                    {
                        if (prop.Name.StartsWith("getMoviePartSourcesById_"))
                        {
                            if (prop.Value.TryGetProperty("result", out var result) &&
                                result.ValueKind == JsonValueKind.Array &&
                                result.GetArrayLength() > 0)
                            {
                                var firstSource = result[0];
                                if (firstSource.TryGetProperty("source_content", out var sourceContent))
                                {
                                    var sourceHtml = sourceContent.GetString();
                                    // iframe src'yi çıkar: src="//domain/path"
                                    iframeUrl = ScrapingService.ExtractWithRegex(sourceHtml, @"src=[""']//([^""']+)[""']");
                                    if (!string.IsNullOrEmpty(iframeUrl))
                                    {
                                        iframeUrl = "https://" + iframeUrl;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                else if (url.Contains("/dizi/"))
                {
                    // Dizi için: getEpisodeSources içinden iframe URL'ini al
                    if (relatedResults.TryGetProperty("getEpisodeSources", out var episodeSources) &&
                        episodeSources.TryGetProperty("result", out var result) &&
                        result.ValueKind == JsonValueKind.Array &&
                        result.GetArrayLength() > 0)
                    {
                        var firstSource = result[0];
                        if (firstSource.TryGetProperty("source_content", out var sourceContent))
                        {
                            var sourceHtml = sourceContent.GetString();
                            // iframe src'yi çıkar: src="//domain/path"
                            iframeUrl = ScrapingService.ExtractWithRegex(sourceHtml, @"src=[""']//([^""']+)[""']");
                            if (!string.IsNullOrEmpty(iframeUrl))
                            {
                                iframeUrl = "https://" + iframeUrl;
                            }
                        }
                    }
                }
            }

            if (string.IsNullOrEmpty(iframeUrl))
                throw new InvalidOperationException("Could not find iframe URL in content data.");

            var uri = new Uri(iframeUrl);

            // Get source token from iframe HTML
            string? sourceToken = null;
            for (int i = 0; i < 5; i++)
            {
                //var iframeHtmlResponse = await FlareSolverrConnection.GetConnection(iframeUrl, null, referer, RequestType.GET);
                var iframeHtmlResponse = await BrowserConnection.GetConnection(iframeUrl, null, referer, RequestType.GET);
                var iframeHtml = await iframeHtmlResponse.ReadAsStringAsync();
                sourceToken = ScrapingService.ExtractWithRegex(iframeHtml, @"openPlayer\s*\(\s*['""]([^'""]+)['""]");

                if (!string.IsNullOrEmpty(sourceToken))
                    break;

                if (i < 4) await Task.Delay(1000);
            }

            if (string.IsNullOrEmpty(sourceToken))
                throw new InvalidOperationException("Could not find openPlayer Token in the HTML.");

            var masterLink = await GetSourceData(uri.Host, sourceToken, iframeUrl);
            if (string.IsNullOrEmpty(masterLink))
                throw new InvalidOperationException("Could not find HLS link in source data.");

            return $"{ConfigHelper.APIUrl}Proxy/{HttpUtility.UrlEncode(masterLink)}?referer={HttpUtility.UrlEncode(iframeUrl)}&connectionMode={(int)Domain.Enums.ConnectionMode.BROWSER}&mode={(int)Domain.Enums.ProxyMode.DIZIPAL_MASTER}";
        }

        public async Task<List<StreamingRawResult>> SearchContent(string searchTerm)
        {
            try
            {
                var url = $"https://roketdizi.to/api/bg/searchContent?searchterm={HttpUtility.UrlEncode(searchTerm)}";
                var response = await _httpClient.PostAsync(url, null);
                response.EnsureSuccessStatusCode();

                var jsonString = await response.Content.ReadAsStringAsync();
                var wrapper = JsonSerializer.Deserialize<RoketdiziSearchWrapper>(jsonString, _jsonOptions);

                if (wrapper == null || !wrapper.Success || string.IsNullOrEmpty(wrapper.Response))
                    return new List<StreamingRawResult>();

                var decodedJson = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(wrapper.Response));
                var data = JsonSerializer.Deserialize<RoketdiziData>(decodedJson, _jsonOptions);

                return data?.Result?.Select(r => r.ToStreamingRawResult()).ToList() ?? new List<StreamingRawResult>();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error searching content on Roketdizi: {ex.Message}");
                return new List<StreamingRawResult>();
            }
        }

        public async Task<StreamingSeriesDetail?> GetSeriesDetail(string seriesId)
        {
            try
            {

                var pageUrl = $"https://roketdizi.to/{seriesId}";
                var webHTMLResponse = await FlareSolverrConnection.GetConnection(pageUrl, null, "https://roketdizi.to/", RequestType.GET);
                var webHTML = await webHTMLResponse.ReadAsStringAsync();
                var jsonLdList = await ScrapingService.ExtractAllElementsText(webHTML, "script[type='application/ld+json']");

                if (jsonLdList != null)
                {
                    foreach (var jsonLd in jsonLdList)
                    {
                        try
                        {
                            var detail = JsonSerializer.Deserialize<StreamingSeriesDetail>(jsonLd, _jsonOptions);
                            if (detail != null && (!string.IsNullOrEmpty(detail.Name) || !string.IsNullOrEmpty(detail.Type)))
                            {
                                return detail;
                            }
                        }
                        catch { }
                    }
                }

                return null;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error fetching or parsing series detail from Roketdizi: {ex.Message}");
                return null;
            }
        }

        public async Task<string?> GetSourceData(string domain, string token, string referer)
        {
            try
            {
                var sourceHtmlResponse = await FlareSolverrConnection.GetConnection($"https://{domain}/source2.php?v={token}", null, referer, RequestType.GET);
                var sourceHtml = await sourceHtmlResponse.ReadAsStringAsync();
                var jsonText = await ScrapingService.ExtractElementText(sourceHtml, "body");

                if (string.IsNullOrEmpty(jsonText))
                    return null;

                using var doc = JsonDocument.Parse(jsonText.Trim());

                if (doc.RootElement.TryGetProperty("playlist", out var playlist) &&
                    playlist.ValueKind == JsonValueKind.Array &&
                    playlist.GetArrayLength() > 0)
                {
                    var firstPlaylist = playlist[0];
                    if (firstPlaylist.TryGetProperty("sources", out var sources) &&
                        sources.ValueKind == JsonValueKind.Array &&
                        sources.GetArrayLength() > 0)
                    {
                        var firstSource = sources[0];
                        if (firstSource.TryGetProperty("file", out var file))
                        {
                            return file.GetString()?.Replace("m.php", "master.m3u8");
                        }
                    }
                }
                return null;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error fetching or parsing source data: {ex.Message}");
                return null;
            }
        }


        #region Roketdizi API DTOs

        private class NextDataWrapper
        {
            [JsonPropertyName("props")]
            public NextDataProps? Props { get; set; }
        }

        private class NextDataProps
        {
            [JsonPropertyName("pageProps")]
            public NextDataPageProps? PageProps { get; set; }
        }

        private class NextDataPageProps
        {
            [JsonPropertyName("secureData")]
            public string? SecureData { get; set; }

            [JsonPropertyName("contentUrl")]
            public string? ContentUrl { get; set; }

            [JsonPropertyName("id")]
            public int Id { get; set; }
        }

        private class RoketdiziSearchWrapper
        {
            [JsonPropertyName("success")]
            public bool Success { get; set; }

            [JsonPropertyName("response")]
            public string? Response { get; set; }

            [JsonPropertyName("meta")]
            public RoketdiziMeta? Meta { get; set; }
        }

        private class RoketdiziMeta
        {
            [JsonPropertyName("requestId")]
            public string? RequestId { get; set; }

            [JsonPropertyName("responseTime")]
            public string? ResponseTime { get; set; }

            [JsonPropertyName("timestamp")]
            public string? Timestamp { get; set; }
        }

        private class RoketdiziData
        {
            [JsonPropertyName("state")]
            public bool State { get; set; }

            [JsonPropertyName("message")]
            public string? Message { get; set; }

            [JsonPropertyName("code")]
            public int Code { get; set; }

            [JsonPropertyName("result")]
            public List<RoketdiziSearchResult>? Result { get; set; }
        }

        private class RoketdiziSearchResult
        {
            [JsonPropertyName("object_id")]
            public int ObjectId { get; set; }

            [JsonPropertyName("object_related_imdb_id")]
            public string? ObjectRelatedImdbId { get; set; }

            [JsonPropertyName("object_related_imdb_point")]
            public double ObjectRelatedImdbPoint { get; set; }

            [JsonPropertyName("used_slug")]
            public string? UsedSlug { get; set; }

            [JsonPropertyName("used_type")]
            public string? UsedType { get; set; }

            [JsonPropertyName("object_name")]
            public string? ObjectName { get; set; }

            [JsonPropertyName("object_release_year")]
            public int ObjectReleaseYear { get; set; }

            [JsonPropertyName("object_language")]
            public string? ObjectLanguage { get; set; }

            [JsonPropertyName("object_categories")]
            public string? ObjectCategories { get; set; }

            [JsonPropertyName("object_poster_url")]
            public string? ObjectPosterUrl { get; set; }

            [JsonPropertyName("object_alternative_name")]
            public string? ObjectAlternativeName { get; set; }

            [JsonPropertyName("object_back_url")]
            public string? ObjectBackUrl { get; set; }

            [JsonPropertyName("object_face_url")]
            public string? ObjectFaceUrl { get; set; }

            [JsonPropertyName("object_logo_url")]
            public string? ObjectLogoUrl { get; set; }

            [JsonPropertyName("object_square_url")]
            public string? ObjectSquareUrl { get; set; }

            /// <summary>
            /// Converts to StreamingRawResult
            /// </summary>
            public StreamingRawResult ToStreamingRawResult()
            {
                // Kategoriler bazen logo_url içinde gelebiliyor, kontrol et
                var categoriesSource = !string.IsNullOrEmpty(ObjectCategories)
                    ? ObjectCategories
                    : (StringHelper.IsCategories(ObjectLogoUrl) ? ObjectLogoUrl : null);

                // LogoUrl gerçek bir URL mi kontrol et
                var logoUrl = StringHelper.IsValidUrl(ObjectLogoUrl) ? ObjectLogoUrl : null;

                return new StreamingRawResult
                {
                    Id = ObjectId,
                    Provider = StreamingSourceProvider.ROKETDIZI,
                    Slug = StringHelper.UnescapeString(UsedSlug),
                    ImdbId = ObjectRelatedImdbId,
                    ImdbPoint = ObjectRelatedImdbPoint,
                    Type = UsedType,
                    Name = StringHelper.UnescapeString(ObjectName),
                    AlternativeName = StringHelper.UnescapeString(ObjectAlternativeName),
                    ReleaseYear = ObjectReleaseYear,
                    Language = StringHelper.UnescapeString(ObjectLanguage),
                    Categories = StringHelper.ParseCategories(categoriesSource),
                    PosterUrl = ObjectPosterUrl == "0" ? null : ObjectPosterUrl,
                    BackUrl = ObjectBackUrl == "0" ? null : ObjectBackUrl,
                    FaceUrl = ObjectFaceUrl == "0" ? null : ObjectFaceUrl,
                    LogoUrl = logoUrl == "0" ? null : logoUrl,
                    SquareUrl = ObjectSquareUrl == "0" ? null : ObjectSquareUrl
                };
            }
        }

        #endregion
    }
}
