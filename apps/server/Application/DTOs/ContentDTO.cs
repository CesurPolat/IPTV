using Domain.Enums;

namespace Application.DTOs
{
    public class ContentDTO
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string ChannelId { get; set; }
        public string Poster { get; set; }
        public string Source { get; set; }
        public Category Category { get; set; }
        public string AdsRegex { get; set; }
    }
}
