using PuppeteerSharp;
using IPTVAPI.Application.DTOs;
using System.Net;
using Application.Helpers;
using Domain.Entities;

namespace Infrastructure.Services.Proxy
{
    public static class BrowserConnection
    {

        public static async Task<ProxyResponse> GetConnection(string url, Dictionary<string, string?[]>? headers = null, string? referer = null, RequestType method = RequestType.GET, string? body = null)
        {
            var connectOptions = new ConnectOptions
            {
                BrowserWSEndpoint = ConfigHelper.BrowserWSEndpoint
            };

            await using var browser = await Puppeteer.ConnectAsync(connectOptions);
            await using var page = await browser.NewPageAsync();

            // Stealth plugin benzeri davranış için User-Agent ve otomasyon gizleme
            await page.SetUserAgentAsync("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");

            if (!string.IsNullOrEmpty(referer))
            {
                await page.SetExtraHttpHeadersAsync(new Dictionary<string, string>
                {
                    { "Referer", referer }
                });
            }

            var response = await page.GoToAsync(url, new NavigationOptions { WaitUntil = new[] { WaitUntilNavigation.DOMContentLoaded } });

            var content = await page.GetContentAsync();
            var contentBytes = System.Text.Encoding.UTF8.GetBytes(content);
            var memoryStream = new MemoryStream(contentBytes);

            var proxyResponse = new ProxyResponse
            {
                StatusCode = response != null ? (HttpStatusCode)response.Status : HttpStatusCode.OK,
                Content = memoryStream,
                MediaType = response?.Headers?.ContainsKey("content-type") == true ? response.Headers["content-type"] : "text/html"
            };

            if (response?.Headers != null)
            {
                foreach (var header in response.Headers)
                {
                    proxyResponse.Headers.Add(header.Key, new[] { header.Value });
                }
            }

            return proxyResponse;
        }

    }
}
