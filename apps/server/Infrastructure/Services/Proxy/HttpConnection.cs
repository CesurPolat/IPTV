
using System.Net;
using IPTVAPI.Application.DTOs;
using Domain.Entities;
using System.Text;

namespace Infrastructure.Services.Proxy
{
    public static class HttpConnection
    {

        public static async Task<ProxyResponse> GetConnection(string url, Dictionary<string, string?[]>? headers = null, string? referer = null, RequestType method = RequestType.GET, string? body = null, string contentType = "application/json")
        {
            
            var handler = new HttpClientHandler
            {
                AutomaticDecompression = DecompressionMethods.Brotli | DecompressionMethods.GZip | DecompressionMethods.Deflate
            };

            HttpClient httpClient = new HttpClient(handler);

            if (headers != null)
            {
                foreach (var header in headers)
                {
                    if (header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase))
                        continue;

                    httpClient.DefaultRequestHeaders.TryAddWithoutValidation(header.Key, header.Value);
                }
            }

            if (!string.IsNullOrEmpty(referer))
            {
                httpClient.DefaultRequestHeaders.Remove("Referer");
                httpClient.DefaultRequestHeaders.TryAddWithoutValidation("Referer", referer);
            }

            if (string.IsNullOrEmpty(url))
                throw new ArgumentException("URL cannot be null or empty.", nameof(url));

            var requestMethod = method switch
            {
                RequestType.POST => HttpMethod.Post,
                RequestType.PUT => HttpMethod.Put,
                RequestType.DELETE => HttpMethod.Delete,
                RequestType.HEAD => HttpMethod.Head,
                RequestType.OPTIONS => HttpMethod.Options,
                RequestType.PATCH => HttpMethod.Patch,
                _ => HttpMethod.Get
            };

            using var request = new HttpRequestMessage(requestMethod, url);

            if (method == RequestType.POST || method == RequestType.PUT || method == RequestType.PATCH)
            {
                request.Content = new StringContent(body ?? string.Empty, Encoding.UTF8, contentType);
            }

            var response = await httpClient.SendAsync(request);
            
            var proxyResponse = new ProxyResponse
            {
                StatusCode = response.StatusCode,
                MediaType = response.Content.Headers.ContentType?.MediaType,
                Content = await response.Content.ReadAsStreamAsync()
            };

            foreach (var header in response.Headers)
            {
                proxyResponse.Headers.Add(header.Key, header.Value);
            }

            foreach (var header in response.Content.Headers)
            {
                if (!proxyResponse.Headers.ContainsKey(header.Key))
                    proxyResponse.Headers.Add(header.Key, header.Value);
            }

            return proxyResponse;

        }

    }
}
