using Application.Helpers;
using Domain.Enums;
using Domain.Entities;
using Infrastructure.Services.Proxy;
using IPTVAPI.Application.DTOs;
using Microsoft.AspNetCore.Mvc;
using System.Net;
using System.Web;
using System.Text;

namespace IPTVAPI.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class ProxyController : ControllerBase
    {

        public ProxyController()
        {

        }

        [Route("{*url}")]
        [HttpGet]
        [HttpPost]
        [HttpPut]
        [HttpDelete]
        [HttpHead]
        [HttpOptions]
        [HttpPatch]
        public async Task<IActionResult> GetAllAsync(string url, string? referer = null, ConnectionMode connectionMode = ConnectionMode.HTTP, ProxyMode mode = ProxyMode.NONE)
        {
            url = HttpUtility.UrlDecode(url, System.Text.Encoding.UTF8);
            referer = HttpUtility.UrlDecode(referer ?? string.Empty, System.Text.Encoding.UTF8);
            var baseUrl = url.Substring(0, url.LastIndexOf("/") + 1);

            if(mode == ProxyMode.DIZIPAL_DIRECT)
                url = url.Replace(".ts", ".jpg");

            // Map Request.Method to RequestType
            RequestType requestMethod = RequestType.GET;
            Enum.TryParse(Request.Method, true, out requestMethod);

            string? body = null;
            if (Request.ContentLength > 0 || requestMethod == RequestType.POST || requestMethod == RequestType.PUT || requestMethod == RequestType.PATCH)
            {
                using var reader = new StreamReader(Request.Body, Encoding.UTF8);
                body = await reader.ReadToEndAsync();
            }

            ProxyResponse response;

            switch (connectionMode)
            {
                case ConnectionMode.BROWSER:
                    response = await BrowserConnection.GetConnection(url, Request.Headers.ToDictionary(h => h.Key, h => h.Value.ToArray()), referer, requestMethod, body);
                    break;
                case ConnectionMode.FLARESOLVERR:
                    response = await FlareSolverrConnection.GetConnection(url, Request.Headers.ToDictionary(h => h.Key, h => h.Value.ToArray()), referer, requestMethod, body);
                    break;
                default:
                    response = await HttpConnection.GetConnection(url, Request.Headers.ToDictionary(h => h.Key, h => h.Value.ToArray()), referer, requestMethod, body, Request.ContentType ?? "application/json");
                    break;
            }


            if (connectionMode == ConnectionMode.HTTP)
            {
                foreach (var header in response.Headers)
                {
                    if (header.Key.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase))
                        continue;

                    if(header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) && mode == ProxyMode.DIZIPAL_DIRECT)
                        continue;

                    Response.Headers.Append(header.Key, string.Join(", ", header.Value));
                }
            }

            var mediaType = response.MediaType;

            if (mode == ProxyMode.DIZIPAL_DIRECT || requestMethod == RequestType.HEAD)
                return StatusCode((int)response.StatusCode, response.Content);

            if (mediaType == "application/vnd.apple.mpegurl" || (mode >= ProxyMode.DIZIPAL_MASTER && mode <= ProxyMode.DIZIPAL_PLAYLIST))
            {
                var contentString = await response.ReadAsStringAsync();

                if (!contentString.IsHLSContent())
                    return Content(contentString, mediaType ?? "text/plain");

                string hlsResult;
                if (contentString.IsMediaPlaylist())
                    hlsResult = contentString.SetBaseUrl($"{ConfigHelper.APIUrl}Proxy/", referer, connectionMode, mode);
                else
                    hlsResult = contentString.SetBaseUrl($"{ConfigHelper.APIUrl}Proxy/{HttpUtility.UrlEncode(baseUrl)}", referer, connectionMode, mode);

                return Content(hlsResult, "application/vnd.apple.mpegurl");
            }

            return StatusCode((int)response.StatusCode, response.Content);
        }
    }
}
