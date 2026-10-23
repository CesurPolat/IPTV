using Domain.Entities;
using AngleSharp;
using System.Text.Json;
using Infrastructure.Services.Proxy;
using System.Web;
using Application.Helpers;
using System.Text.RegularExpressions;


namespace Infrastructure.Services.Scraping
{
    public static class ScrapingService
    {
        public static async Task<string> Exec(this object scriptableClass)
        {
            var serialized = JsonSerializer.Serialize(scriptableClass);
            var baseClass = JsonSerializer.Deserialize<ScriptableClasses>(serialized);

            var result = string.Empty;

            switch (baseClass.ScriptableType)
            {
                case ScriptableClassType.Value:
                    var valueClass = JsonSerializer.Deserialize<ValueClass>(serialized);
                    result = valueClass?.Value ?? throw new InvalidOperationException("Invalid ValueClass data");
                    break;

                case ScriptableClassType.HTML:
                    var htmlClass = JsonSerializer.Deserialize<HTMLScrapingClass>(serialized);
                    result = await ExecHTML(htmlClass ?? throw new InvalidOperationException("Invalid HTMLScrapingClass data"));
                    break;

                case ScriptableClassType.API:
                    var apiClass = JsonSerializer.Deserialize<APIResponseClass>(serialized);
                    result = await ExecAPI(apiClass ?? throw new InvalidOperationException("Invalid APIResponseClass data"));
                    break;

                default:
                    throw new NotImplementedException($"Unknown ScriptableType: {baseClass.ScriptableType}");
            }

            if (baseClass.IsProxyChannelEnabled)
                result = $"{ConfigHelper.APIUrl}Proxy/{HttpUtility.UrlEncode(result, System.Text.Encoding.UTF8)}";

            return result;

        }

        private static async Task<string> ExecAPI(APIResponseClass input)
        {
            HttpClientHandler handler = new HttpClientHandler();

            if (input.IsProxyEnabled)
                handler.GetProxy();

            HttpClient client = new HttpClient(handler);

            if(input.Headers != null)
            {
                foreach (var header in input.Headers)
                {
                    client.DefaultRequestHeaders.Add(header.Key, header.Value);
                }
            }

            HttpResponseMessage response;

            switch (input.RequestType)
            {
                case RequestType.GET:
                    response = client.GetAsync(input.Url).Result;
                    break;
                case RequestType.POST:
                    var content = new StringContent(input.Body, System.Text.Encoding.UTF8, "application/json");
                    response = client.PostAsync(input.Url, content).Result;
                    break;
                case RequestType.PUT:
                    var putContent = new StringContent(input.Body, System.Text.Encoding.UTF8, "application/json");
                    response = client.PutAsync(input.Url, putContent).Result;
                    break;
                case RequestType.DELETE:
                    response = client.DeleteAsync(input.Url).Result;
                    break;
                default:
                    throw new NotImplementedException();
            }

            string result = await response.Content.ReadAsStringAsync();

            if (input.SelectPropertyClass == null)
                return result;

            JsonElement doc = JsonDocument.Parse(result).RootElement;

            var url = GetElement<string>(input.SelectPropertyClass, doc);

            if (url == null)
                throw new Exception("Url not found");


            return url;
        }

        public static T GetElement<T>(SelectPropertyClass selectPropertyClass, JsonElement element)
        {
            var jsonElem = element.GetProperty(selectPropertyClass.PropertyName);
            var isThereNextProperty = selectPropertyClass.NextProperty != null;

            return selectPropertyClass.Type switch
            {
                PropertyType.Object => isThereNextProperty ? GetElement<T>(selectPropertyClass, jsonElem) : (T)(object)jsonElem.ToString(),

                PropertyType.String => (T)(object)element.GetProperty(selectPropertyClass.PropertyName).GetString(),
                PropertyType.Boolean => (T)(object)element.GetProperty(selectPropertyClass.PropertyName).GetBoolean().ToString(),
                PropertyType.Int32 => (T)(object)element.GetProperty(selectPropertyClass.PropertyName).GetInt32().ToString(),
                _ => throw new NotImplementedException()
            };
        }

        public static async Task<string> ExecHTML(HTMLScrapingClass input)
        {
            // Tarayıcı konfigürasyonu  
            var config = Configuration.Default.WithDefaultLoader();
            var context = BrowsingContext.New(config);

            // Sayfa yükleme  
            var document = await context.OpenAsync(input.Url);

            var result = document.Body.InnerHtml;
            if (input.SplitableClasses!=null)
            {
                foreach (var SplitableClass in input.SplitableClasses)
                {
                    result = result.Split(SplitableClass.Separator)[SplitableClass.Index];
                }
            }

            return result;
        }

        public static async Task<string?> ExtractElementText(string html, string selector)
        {
            var config = Configuration.Default;
            using var context = BrowsingContext.New(config);
            using var document = await context.OpenAsync(req => req.Content(html));
            var element = document.QuerySelector(selector);
            return element?.TextContent;
        }

        public static async Task<List<string>> ExtractAllElementsText(string html, string selector)
        {
            var config = Configuration.Default;
            using var context = BrowsingContext.New(config);
            using var document = await context.OpenAsync(req => req.Content(html));
            var elements = document.QuerySelectorAll(selector);
            return elements.Select(e => e.TextContent).ToList();
        }

        public static string? ExtractWithRegex(string html, string pattern, int groupIndex = 1)
        {
            var regex = new Regex(pattern, RegexOptions.Compiled);
            var match = regex.Match(html);
            return (match.Success && match.Groups.Count > groupIndex) ? match.Groups[groupIndex].Value : null;
        }

        public static async Task<string> GetLastRedirectedUrl(string url)
        {
            using var client = new HttpClient();
            client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3");
            client.DefaultRequestHeaders.Add("Referer", "https://redirectdetective.com/");

            var values = new Dictionary<string, string>
            {
                { "w", url },
                { "f", "false" }
            };

            var content = new FormUrlEncodedContent(values);
            var response = await client.PostAsync("https://redirectdetective.com/ld.px", content);
            var responseContent = await response.Content.ReadAsStringAsync();

            var config = Configuration.Default;
            using var context = BrowsingContext.New(config);
            using var document = await context.OpenAsync(req => req.Content(responseContent));

            var links = document.QuerySelectorAll("a.tooltips");
            var lastLink = links.LastOrDefault()?.GetAttribute("href");

            return lastLink?.Trim().Replace("\n", "").Replace("\r", "") ?? url;
        }

    }
}
