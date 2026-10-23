
using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Bson;

namespace Domain.Entities
{
    public class Version
    {
        [BsonId]
        public ObjectId Id { get; set; }
        public string VersionId { get; set; }

    }
}
