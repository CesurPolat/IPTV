using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Application.Helpers;
using Application.Abstractions;

namespace IPTVAPI.Controllers
{
    [ApiController]
    [Route("[controller]/[action]")]
    public class TestController : ControllerBase
    {

        public readonly ILogger _logger;
        private readonly IConfiguration _configuration;
        private readonly IHttpClientFactory _httpClientFactory;

        public TestController(
            ILogger<TestController> logger,
            IBroadcastScheduleService broadcastScheduleService,
            IConfiguration configuration,
            IHttpClientFactory httpClientFactory)
        {
            _logger = logger;
            _configuration = configuration;
            _httpClientFactory = httpClientFactory;
        }

        [HttpGet]
        [AllowAnonymous]
        public IActionResult GoogleOAuthUrl()
        {
            var settings = GetGoogleOAuthSettings();
            var redirectUri = ResolveRedirectUri(settings.RedirectUri);
            var driveScopes = settings.Scopes
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Where(s => s.Contains("/auth/drive", StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (driveScopes.Count == 0)
            {
                driveScopes = ["https://www.googleapis.com/auth/drive"];
            }

            var scope = string.Join(" ", driveScopes);
            var state = Guid.NewGuid().ToString("N");

            var authorizationUrl =
                "https://accounts.google.com/o/oauth2/v2/auth"
                + $"?client_id={Uri.EscapeDataString(settings.ClientId)}"
                + $"&redirect_uri={Uri.EscapeDataString(redirectUri)}"
                + "&response_type=code"
                + $"&scope={Uri.EscapeDataString(scope)}"
                + $"&state={Uri.EscapeDataString(state)}"
                + "&access_type=offline"
                + "&prompt=consent";

            return Ok(new
            {
                AuthorizationUrl = authorizationUrl,
                RedirectUri = redirectUri
            });
        }

        [HttpGet]
        [AllowAnonymous]
        public async Task<IActionResult> GoogleOAuthCallback(
            [FromQuery] string? code,
            [FromQuery] string? error,
            [FromQuery(Name = "error_description")] string? errorDescription)
        {
            if (!string.IsNullOrWhiteSpace(error))
            {
                return BadRequest(new
                {
                    Error = error,
                    ErrorDescription = errorDescription,
                    Message = "Google OAuth callback asamasinda hata dondu."
                });
            }

            if (string.IsNullOrWhiteSpace(code))
            {
                return BadRequest("Google callback icin code parametresi zorunludur.");
            }

            var settings = GetGoogleOAuthSettings();
            var redirectUri = ResolveRedirectUri(settings.RedirectUri);
            var httpClient = _httpClientFactory.CreateClient();

            var tokenRequestBody = new Dictionary<string, string>
            {
                ["code"] = code,
                ["client_id"] = settings.ClientId,
                ["client_secret"] = settings.ClientSecret,
                ["redirect_uri"] = redirectUri,
                ["grant_type"] = "authorization_code"
            };

            using var tokenResponse = await httpClient.PostAsync(
                "https://oauth2.googleapis.com/token",
                new FormUrlEncodedContent(tokenRequestBody));

            var responseContent = await tokenResponse.Content.ReadAsStringAsync();

            if (!tokenResponse.IsSuccessStatusCode)
            {
                var googleError = JsonSerializer.Deserialize<GoogleTokenErrorResponse>(
                    responseContent,
                    new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });

                _logger.LogWarning(
                    "Google token alma basarisiz oldu. StatusCode: {StatusCode}, Error: {Error}, Description: {ErrorDescription}, RawResponse: {Response}",
                    (int)tokenResponse.StatusCode,
                    googleError?.Error,
                    googleError?.ErrorDescription,
                    responseContent);

                return StatusCode((int)tokenResponse.StatusCode, new
                {
                    Error = googleError?.Error,
                    ErrorDescription = googleError?.ErrorDescription,
                    ErrorUri = googleError?.ErrorUri,
                    Message = "Google token endpoint istegi basarisiz oldu. En sik sebepler: redirect_uri_mismatch, invalid_client, invalid_grant (code tekrar kullanildi veya suresi doldu).",
                    RawResponse = responseContent
                });
            }

            var parsedTokenResponse = JsonSerializer.Deserialize<GoogleTokenResponse>(
                responseContent,
                new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

            if (parsedTokenResponse is null || string.IsNullOrWhiteSpace(parsedTokenResponse.AccessToken))
            {
                return StatusCode(StatusCodes.Status502BadGateway, "Google token cevabi parse edilemedi.");
            }

            return Ok(new
            {
                AccessToken = parsedTokenResponse.AccessToken,
                TokenType = parsedTokenResponse.TokenType,
                ExpiresIn = parsedTokenResponse.ExpiresIn,
                Scope = parsedTokenResponse.Scope,
                RefreshToken = parsedTokenResponse.RefreshToken,
                RefreshTokenExpiresIn = parsedTokenResponse.RefreshTokenExpiresIn,
                IdToken = parsedTokenResponse.IdToken
            });
        }

      
        private GoogleOAuthSettings GetGoogleOAuthSettings()
        {
            var settings = _configuration.GetSection("GoogleOAuth").Get<GoogleOAuthSettings>();

            if (settings is null
                || string.IsNullOrWhiteSpace(settings.ClientId)
                || string.IsNullOrWhiteSpace(settings.ClientSecret))
            {
                throw new InvalidOperationException("GoogleOAuth ayarlari eksik. appsettings dosyasinda GoogleOAuth:ClientId ve GoogleOAuth:ClientSecret alanlarini doldurun.");
            }

            if (settings.Scopes is null || settings.Scopes.Count == 0)
            {
                settings.Scopes = ["https://www.googleapis.com/auth/drive"];
            }

            return settings;
        }

        private string ResolveRedirectUri(string? configuredRedirectUri)
        {
            if (!string.IsNullOrWhiteSpace(configuredRedirectUri))
            {
                return configuredRedirectUri;
            }

            var generatedUrl = Url.ActionLink(nameof(GoogleOAuthCallback), "Test", null, Request.Scheme);
            if (string.IsNullOrWhiteSpace(generatedUrl))
            {
                throw new InvalidOperationException("Google callback redirect uri olusturulamadi.");
            }

            return generatedUrl;
        }

        private sealed class GoogleOAuthSettings
        {
            public string ClientId { get; set; } = string.Empty;
            public string ClientSecret { get; set; } = string.Empty;
            public string? RedirectUri { get; set; }
            public List<string> Scopes { get; set; } = [];
        }

        private sealed class GoogleTokenResponse
        {
            [JsonPropertyName("access_token")]
            public string AccessToken { get; set; } = string.Empty;

            [JsonPropertyName("expires_in")]
            public int ExpiresIn { get; set; }

            [JsonPropertyName("token_type")]
            public string TokenType { get; set; } = string.Empty;

            [JsonPropertyName("scope")]
            public string Scope { get; set; } = string.Empty;

            [JsonPropertyName("refresh_token")]
            public string? RefreshToken { get; set; }

            [JsonPropertyName("refresh_token_expires_in")]
            public int? RefreshTokenExpiresIn { get; set; }

            [JsonPropertyName("id_token")]
            public string? IdToken { get; set; }
        }

        private sealed class GoogleTokenErrorResponse
        {
            [JsonPropertyName("error")]
            public string? Error { get; set; }

            [JsonPropertyName("error_description")]
            public string? ErrorDescription { get; set; }

            [JsonPropertyName("error_uri")]
            public string? ErrorUri { get; set; }
        }

    }
}
