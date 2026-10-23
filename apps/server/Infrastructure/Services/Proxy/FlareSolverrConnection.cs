using System.Text;
using System.Text.Json;
using IPTVAPI.Application.DTOs;
using System.Net;
using Application.Helpers;
using Domain.Entities;

namespace Infrastructure.Services.Proxy
{
    public static class FlareSolverrConnection
    {
        private static readonly HttpClient _httpClient = new HttpClient();

        public static async Task<ProxyResponse> GetConnection(string url, Dictionary<string, string?[]>? headers = null, string? referer = null, RequestType method = RequestType.GET, string? body = null)
        {
            var requestBody = new
            {
                cmd = method == RequestType.POST ? "request.post" : "request.get",
                url = url,
                postData = method == RequestType.POST ? body : null,
                maxTimeout = 60000
            };

            var jsonBody = JsonSerializer.Serialize(requestBody);
            var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");

            var flareSolverrUrl = string.IsNullOrEmpty(ConfigHelper.FlareSolverrUrl) 
                ? "http://localhost:8191/v1" 
                : ConfigHelper.FlareSolverrUrl;

            try
            {
                var response = await _httpClient.PostAsync(flareSolverrUrl, content);
                var responseString = await response.Content.ReadAsStringAsync();

                var flareSolverrResponse = JsonSerializer.Deserialize<FlareSolverrResponse>(responseString);

                if (flareSolverrResponse?.Status == "ok" && flareSolverrResponse.Solution != null)
                {
                    var solution = flareSolverrResponse.Solution;
                    var contentBytes = Encoding.UTF8.GetBytes(solution.Response ?? string.Empty);
                    var memoryStream = new MemoryStream(contentBytes);

                    var proxyResponse = new ProxyResponse
                    {
                        StatusCode = (HttpStatusCode)solution.Status,
                        Content = memoryStream,
                        MediaType = "text/html"
                    };

                    if (solution.Headers != null)
                    {
                        foreach (var header in solution.Headers)
                        {
                            proxyResponse.Headers.Add(header.Key, new[] { header.Value });
                        }
                    }

                    return proxyResponse;
                }

                return new ProxyResponse
                {
                    StatusCode = HttpStatusCode.InternalServerError,
                    Content = new MemoryStream(Encoding.UTF8.GetBytes(flareSolverrResponse?.Message ?? "FlareSolverr failed"))
                };
            }
            catch (Exception ex)
            {
                return new ProxyResponse
                {
                    StatusCode = HttpStatusCode.InternalServerError,
                    Content = new MemoryStream(Encoding.UTF8.GetBytes($"FlareSolverr Error: {ex.Message}"))
                };
            }
        }
    }
}
