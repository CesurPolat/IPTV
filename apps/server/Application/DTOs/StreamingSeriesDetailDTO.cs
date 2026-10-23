using System.Text.Json;
using System.Text.Json.Serialization;

namespace IPTVAPI.Application.DTOs;

public class StreamingSeriesDetail
{
    [JsonPropertyName("@context")]
    public string? Context { get; set; }

    [JsonPropertyName("@type")]
    public string? Type { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("image")]
    public string? Image { get; set; }

    [JsonPropertyName("url")]
    public string? Url { get; set; }

    [JsonPropertyName("aggregateRating")]
    public AggregateRating? AggregateRating { get; set; }

    [JsonPropertyName("commentCount")]
    public int? CommentCount { get; set; }

    [JsonPropertyName("dateModified")]
    public string? DateModified { get; set; }

    [JsonPropertyName("datePublished")]
    public string? DatePublished { get; set; }

    [JsonPropertyName("timeRequired")]
    public string? TimeRequired { get; set; }

    [JsonPropertyName("actor")]
    [JsonConverter(typeof(SingleOrArrayConverter<StreamingActor>))]
    public List<StreamingActor>? Actors { get; set; }

    [JsonPropertyName("countryOfOrigin")]
    public CountryOfOrigin? CountryOfOrigin { get; set; }

    [JsonPropertyName("director")]
    public StreamingPerson? Director { get; set; }

    [JsonPropertyName("trailer")]
    [JsonConverter(typeof(SingleOrArrayConverter<StreamingTrailer>))]
    public List<StreamingTrailer>? Trailers { get; set; }

    [JsonPropertyName("containsSeason")]
    [JsonConverter(typeof(SingleOrArrayConverter<StreamingSeason>))]
    public List<StreamingSeason>? Seasons { get; set; }
}

public class AggregateRating
{
    [JsonPropertyName("@type")]
    public string? Type { get; set; }

    [JsonPropertyName("bestRating")]
    public int BestRating { get; set; }

    [JsonPropertyName("ratingValue")]
    public double RatingValue { get; set; }

    [JsonPropertyName("worstRating")]
    public int WorstRating { get; set; }

    [JsonPropertyName("ratingCount")]
    public int RatingCount { get; set; }
}

public class StreamingActor
{
    [JsonPropertyName("@type")]
    public string? Type { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("url")]
    public string? Url { get; set; }

    [JsonPropertyName("additionalName")]
    public string? AdditionalName { get; set; }
}

public class StreamingPerson
{
    [JsonPropertyName("@type")]
    public string? Type { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }
}

public class CountryOfOrigin
{
    [JsonPropertyName("@type")]
    public string? Type { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }
}

public class StreamingTrailer
{
    [JsonPropertyName("@type")]
    public string? Type { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("thumbnailUrl")]
    public string? ThumbnailUrl { get; set; }

    [JsonPropertyName("contentUrl")]
    public string? ContentUrl { get; set; }

    [JsonPropertyName("duration")]
    public string? Duration { get; set; }

    [JsonPropertyName("uploadDate")]
    public string? UploadDate { get; set; }
}

public class StreamingSeason
{
    [JsonPropertyName("@type")]
    public string? Type { get; set; }

    [JsonPropertyName("url")]
    public string? Url { get; set; }

    [JsonPropertyName("seasonNumber")]
    public int SeasonNumber { get; set; }

    [JsonPropertyName("numberOfEpisodes")]
    public int NumberOfEpisodes { get; set; }

    [JsonPropertyName("dateModified")]
    public string? DateModified { get; set; }

    [JsonPropertyName("datePublished")]
    public string? DatePublished { get; set; }

    [JsonPropertyName("episode")]
    [JsonConverter(typeof(SingleOrArrayConverter<StreamingEpisode>))]
    public List<StreamingEpisode>? Episodes { get; set; }
}

public class StreamingEpisode
{
    [JsonPropertyName("@type")]
    public string? Type { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("url")]
    public string? Url { get; set; }

    [JsonPropertyName("episodeNumber")]
    public int EpisodeNumber { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("dateModified")]
    public string? DateModified { get; set; }

    [JsonPropertyName("datePublished")]
    public string? DatePublished { get; set; }
}

public class SingleOrArrayConverter<T> : JsonConverter<List<T>>
{
    public override List<T> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.StartArray)
        {
            return JsonSerializer.Deserialize<List<T>>(ref reader, options) ?? new List<T>();
        }
        else
        {
            var singleItem = JsonSerializer.Deserialize<T>(ref reader, options);
            return singleItem != null ? new List<T> { singleItem } : new List<T>();
        }
    }

    public override void Write(Utf8JsonWriter writer, List<T> value, JsonSerializerOptions options)
    {
        JsonSerializer.Serialize(writer, value, options);
    }
}
