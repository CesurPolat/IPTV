using Application.Constants;
using Application.Helpers;
using Infrastructure.Services.Scraping;
using IPTVAPI.Application.Abstractions;
using IPTVAPI.Application.DTOs;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Web;
using Domain.Entities;
using Infrastructure.Services.Proxy;
using Microsoft.Extensions.Caching.Memory;

namespace IPTVAPI.Infrastructure.Services.Streaming
{
    #region Dizipal API DTOs

    /// <summary>
    /// Dizipal API root wrapper
    /// </summary>
    internal class DizipalApiWrapper
    {
        [JsonPropertyName("data")]
        public DizipalApiResponse? Data { get; set; }
    }

    /// <summary>
    /// Dizipal API response wrapper
    /// </summary>
    internal class DizipalApiResponse
    {
        [JsonPropertyName("state")]
        public bool State { get; set; }

        [JsonPropertyName("message")]
        public string? Message { get; set; }

        [JsonPropertyName("html")]
        public string? Html { get; set; }

        [JsonPropertyName("result")]
        public List<DizipalSearchResult>? Result { get; set; }
    }

    /// <summary>
    /// Dizipal API'den gelen ham veri
    /// </summary>
    internal class DizipalSearchResult
    {
        [JsonPropertyName("object_id")]
        public int ObjectId { get; set; }

        [JsonPropertyName("object_related_imdb_id")]
        public string? ObjectRelatedImdbId { get; set; }

        [JsonPropertyName("object_related_imdb_point")]
        public double ObjectRelatedImdbPoint { get; set; }

        [JsonPropertyName("used_min_trust_score")]
        public int UsedMinTrustScore { get; set; }

        [JsonPropertyName("used_slug")]
        public string? UsedSlug { get; set; }

        [JsonPropertyName("used_type")]
        public string? UsedType { get; set; }

        [JsonPropertyName("object_name")]
        public string? ObjectName { get; set; }

        [JsonPropertyName("object_alternative_name")]
        public string? ObjectAlternativeName { get; set; }

        [JsonPropertyName("object_name_alternative")]
        public string? ObjectNameAlternative { get; set; }

        [JsonPropertyName("object_release_year")]
        public int ObjectReleaseYear { get; set; }

        [JsonPropertyName("object_release_date")]
        public string? ObjectReleaseDate { get; set; }

        [JsonPropertyName("object_detail_name")]
        public string? ObjectDetailName { get; set; }

        [JsonPropertyName("object_language")]
        public string? ObjectLanguage { get; set; }

        [JsonPropertyName("object_categories")]
        public string? ObjectCategories { get; set; }

        [JsonPropertyName("object_full_text_source")]
        public string? ObjectFullTextSource { get; set; }

        [JsonPropertyName("object_content_count")]
        public int ObjectContentCount { get; set; }

        [JsonPropertyName("object_poster_url")]
        public string? ObjectPosterUrl { get; set; }

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
                Provider = StreamingSourceProvider.DIZIPAL,
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

    public class DizipalService : IStreamingService
    {
        private const string Pass = "3hPn4uCjTVtfYWcjIcoJQ4cL1WWk1qxXI39egLYOmNv6IblA7eKJz68uU3eLzux1biZLCms0quEjTYniGv5z1JcKbNIsDQFSeIZOBZJz4is6pD7UyWDggWWzTLBQbHcQFpBQdClnuQaMNUHtLHTpzCvZy33p6I7wFBvL4fnXBYH84aUIyWGTRvM2G5cfoNf4705tO2kv";
        private readonly IMemoryCache _cache;

        public DizipalService(IMemoryCache cache)
        {
            _cache = cache;
        }

        private static readonly Dictionary<string, string?[]> DefaultHeaders = new()
        {
            { "User-Agent", new[] { "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" } }
        };

        public async Task<string> GetMediaUrl(string url)
        {
            // Get page HTML for decryption
            var referer = url.Substring(0, url.IndexOf("/", 8));

            var webHTMLResponse = await BrowserConnection.GetConnection(url, DefaultHeaders, referer, RequestType.GET);
            var webHTML = await webHTMLResponse.ReadAsStringAsync();
            var encryptedIframe = await ScrapingService.ExtractElementText(webHTML, "div[data-rm-k=\"true\"]");

            if (encryptedIframe == null)
                throw new InvalidOperationException("Could not find encrypted iframe data.");

            // Decrypt iframe data
            var data = JsonSerializer.Deserialize<EncryptedData>(encryptedIframe);
            if (data == null)
                throw new InvalidOperationException("Could not deserialize encrypted iframe data.");

            var decryptedIframe = CryptoHelper.DecryptData(data.Ciphertext, data.Iv, data.Salt, Pass);
            if (string.IsNullOrEmpty(decryptedIframe))
                throw new InvalidOperationException("Decryption of iframe data failed.");

            var decryptedLink = "https://" + decryptedIframe.Substring(2);
            var uri = new Uri(decryptedLink);

            // Get source token from iframe HTML
            string? sourceToken = null;
            for (int i = 0; i < 5; i++)
            {
                //var iframeHtmlResponse = await FlareSolverrConnection.GetConnection(decryptedLink, DefaultHeaders, referer, RequestType.GET);
                var iframeHtmlResponse = await BrowserConnection.GetConnection(decryptedLink, DefaultHeaders, referer, RequestType.GET);
                var iframeHtml = await iframeHtmlResponse.ReadAsStringAsync();
                sourceToken = ScrapingService.ExtractWithRegex(iframeHtml, @"openPlayer\s*\(\s*['""]([^'""]+)['""]");

                if (!string.IsNullOrEmpty(sourceToken))
                    break;

                if (i < 4) await Task.Delay(1000);
            }

            if (string.IsNullOrEmpty(sourceToken))
                throw new InvalidOperationException("Could not find openPlayer Token in the HTML.");

            var masterLink = await GetSourceData(uri.Host, sourceToken, decryptedLink);
            if (string.IsNullOrEmpty(masterLink))
                throw new InvalidOperationException("Could not find HLS link in source data.");


            return $"{ConfigHelper.APIUrl}Proxy/{HttpUtility.UrlEncode(masterLink)}?referer={HttpUtility.UrlEncode(decryptedLink)}&connectionMode={(int)Domain.Enums.ConnectionMode.BROWSER}&mode={(int)Domain.Enums.ProxyMode.DIZIPAL_MASTER}";
        }

        public async Task<string?> GetSourceData(string domain, string token, string referer)
        {
            try
            {
                var sourceHtmlResponse = await FlareSolverrConnection.GetConnection($"https://{domain}/source2.php?v={token}", DefaultHeaders, referer, RequestType.GET);
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

        public async Task<string> GetLatestDomain()
        {
            return await _cache.GetOrCreateAsync(CacheKeys.DizipalLatestDomain, 
                () => ScrapingService.GetLastRedirectedUrl("https://dizipal1536.com/"), 
                TimeSpan.FromHours(24));
        }

        public async Task<List<StreamingRawResult>> SearchContent(string searchTerm)
        {
            var domain = await GetLatestDomain();
            if (domain.EndsWith("/")) domain = domain.Substring(0, domain.Length - 1);

            var url = $"{domain}/bg/searchcontent";
            var postData = $"searchterm={HttpUtility.UrlEncode(searchTerm)}";

            var response = await FlareSolverrConnection.GetConnection(
                url,
                null,
                domain + "/",
                RequestType.POST,
                postData
            );

            var rawResponse = await response.ReadAsStringAsync();
            var jsonResponse = await ScrapingService.ExtractElementText(rawResponse, "body");

            if (string.IsNullOrEmpty(jsonResponse))
                return new List<StreamingRawResult>();

            // JSON string olarak encode edilmişse, önce string olarak parse et
            if (jsonResponse.TrimStart().StartsWith("\""))
            {
                jsonResponse = JsonSerializer.Deserialize<string>(jsonResponse) ?? jsonResponse;
            }

            var wrapper = JsonSerializer.Deserialize<DizipalApiWrapper>(jsonResponse);
            
            if (wrapper?.Data?.Result == null)
                return new List<StreamingRawResult>();

            return wrapper.Data.Result.Select(r => r.ToStreamingRawResult()).ToList();
        }

        public async Task<StreamingSeriesDetail?> GetSeriesDetail(string seriesId)
        {
            try
            {
                var domain = await GetLatestDomain();
                if (domain.EndsWith("/")) domain = domain.Substring(0, domain.Length - 1);

                var url = $"{domain}/series/{seriesId}";

                var webHTMLResponse = await FlareSolverrConnection.GetConnection(url, DefaultHeaders, domain + "/", RequestType.GET);
                var webHTML = await webHTMLResponse.ReadAsStringAsync();
                var jsonLdList = await ScrapingService.ExtractAllElementsText(webHTML, "script[type='application/ld+json']");

                if (jsonLdList == null || jsonLdList.Count < 2)
                    return null;

                var secondJsonLd = jsonLdList[1];

                return JsonSerializer.Deserialize<StreamingSeriesDetail>(secondJsonLd);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error fetching or parsing series detail: {ex.Message}");
                return null;
            }
        }
    }
}