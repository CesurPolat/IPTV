using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Bson;
using System.Text.Json.Serialization;

namespace Domain.Entities
{
    public interface IScriptableClasses
    {
        public ScriptableClassType ScriptableType { get; set; }
    }

    public class ScriptableClasses : IScriptableClasses
    {
        public ScriptableClassType ScriptableType { get; set; }
        public bool IsProxyEnabled { get; set; } = false;
        public bool IsProxyChannelEnabled { get; set; } = false;
    }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum ScriptableClassType
    {
        Value,
        HTML,
        API
    }


    #region Value Classes
    public class ValueClass : ScriptableClasses
    {
        public string Value { get; set; }
    }

    #endregion Value Classes

    #region HTML Classes
    public class HTMLScrapingClass : ScriptableClasses
    {
        /// <summary>
        /// The url of the source page
        /// </summary>
        public string Url { get; set; }
        public string? HTMLSelector { get; set; }
        public List<SplitableClass> SplitableClasses { get; set; }
    }

    public class SplitableClass
    {
        public string Separator { get; set; }
        public int Index { get; set; }
    }
    #endregion HTML Classes

    #region API Classes
    public class APIResponseClass : ScriptableClasses
    {
        public string Url { get; set; }
        public RequestType RequestType { get; set; }
        public Dictionary<string, string>? Headers { get; set; }
        public string? Body { get; set; }
        public SelectPropertyClass? SelectPropertyClass { get; set; }
    }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum RequestType
    {
        GET,
        POST,
        PUT,
        DELETE,
        HEAD,
        OPTIONS,
        PATCH
    }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum PropertyType
    {
        Object,
        String,
        Boolean,
        Int32,
    }

    public class SelectPropertyClass
    {
        public PropertyType Type { get; set; }
        public string PropertyName { get; set; }
        public SelectPropertyClass? NextProperty { get; set; }
    }

    #endregion API Classes

}
