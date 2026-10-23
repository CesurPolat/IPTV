using Domain.Enums;
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Domain.Entities
{
    [BsonIgnoreExtraElements]
    public class Content
    {
        [BsonId]
        public ObjectId Id { get; set; }
        public string Name { get; set; }
        public string ChannelId { get; set; }
        public string Poster { get; set; }
        public object Source { get; set; }
        public Category Category { get; set; }

        [BsonElement("adsRegex")]
        public string AdsRegex { get; set; }
    }

}
