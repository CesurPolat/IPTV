using System.Text.Json.Serialization;

namespace Domain.Enums
{

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum Category
    {
        TVChannel = 0,
        Series = 1,
    }
}
