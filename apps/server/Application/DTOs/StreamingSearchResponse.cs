using System.Text.Json.Serialization;

namespace IPTVAPI.Application.DTOs;

public enum StreamingSourceProvider
{
    DIZIPAL = 0,
    ROKETDIZI = 1
}

/// <summary>
/// Base class containing common streaming content metadata
/// </summary>
public abstract class StreamingContentBase
{
    [JsonPropertyName("imdb_id")]
    public string? ImdbId { get; set; }

    [JsonPropertyName("imdb_point")]
    public double ImdbPoint { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("alternative_name")]
    public string? AlternativeName { get; set; }

    [JsonPropertyName("release_year")]
    public int ReleaseYear { get; set; }

    [JsonPropertyName("language")]
    public string? Language { get; set; }

    [JsonPropertyName("categories")]
    public string[]? Categories { get; set; }

    // Image URLs
    [JsonPropertyName("poster_url")]
    public string? PosterUrl { get; set; }

    [JsonPropertyName("back_url")]
    public string? BackUrl { get; set; }

    [JsonPropertyName("face_url")]
    public string? FaceUrl { get; set; }

    [JsonPropertyName("logo_url")]
    public string? LogoUrl { get; set; }

    [JsonPropertyName("square_url")]
    public string? SquareUrl { get; set; }
}

/// <summary>
/// IMDB ID'ye göre gruplanmış içerik sonucu
/// </summary>
public class StreamingSearchResult : StreamingContentBase
{
    [JsonPropertyName("provider_results")]
    public List<ProviderResult> ProviderResults { get; set; } = new List<ProviderResult>();
}

/// <summary>
/// Her provider'dan gelen sonuç bilgisi
/// </summary>
public class ProviderResult
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("provider")]
    public StreamingSourceProvider Provider { get; set; }

    [JsonPropertyName("slug")]
    public string? Slug { get; set; }
}

/// <summary>
/// Service'lerden dönen ham sonuç (internal kullanım)
/// </summary>
public class StreamingRawResult : StreamingContentBase
{
    public int Id { get; set; }
    public StreamingSourceProvider Provider { get; set; }
    public string? Slug { get; set; }
}
