using System.Text.Json.Serialization;

namespace IPTVAPI.Application.DTOs;

public class FlareSolverrResponse
{
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("solution")]
    public FlareSolverrSolution? Solution { get; set; }

    [JsonPropertyName("startTimestamp")]
    public long StartTimestamp { get; set; }

    [JsonPropertyName("endTimestamp")]
    public long EndTimestamp { get; set; }

    [JsonPropertyName("version")]
    public string? Version { get; set; }
}

public class FlareSolverrSolution
{
    [JsonPropertyName("url")]
    public string? Url { get; set; }

    [JsonPropertyName("status")]
    public int Status { get; set; }

    [JsonPropertyName("cookies")]
    public List<FlareSolverrCookie>? Cookies { get; set; }

    [JsonPropertyName("userAgent")]
    public string? UserAgent { get; set; }

    [JsonPropertyName("headers")]
    public Dictionary<string, string>? Headers { get; set; }

    [JsonPropertyName("response")]
    public string? Response { get; set; }
}

public class FlareSolverrCookie
{
    [JsonPropertyName("domain")]
    public string? Domain { get; set; }

    [JsonPropertyName("httpOnly")]
    public bool HttpOnly { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("path")]
    public string? Path { get; set; }

    [JsonPropertyName("sameSite")]
    public string? SameSite { get; set; }

    [JsonPropertyName("secure")]
    public bool Secure { get; set; }

    [JsonPropertyName("value")]
    public string? Value { get; set; }
}
