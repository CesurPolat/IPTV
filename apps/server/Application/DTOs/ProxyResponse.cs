using System.Net;

namespace IPTVAPI.Application.DTOs
{
    public class ProxyResponse : IDisposable
    {
        public HttpStatusCode StatusCode { get; set; } = HttpStatusCode.OK;
        public Dictionary<string, IEnumerable<string>> Headers { get; set; } = new();
        public Stream Content { get; set; } = Stream.Null;
        public string? MediaType { get; set; }

        public async Task<string> ReadAsStringAsync()
        {
            if (Content == null || Content == Stream.Null) 
                return string.Empty;

            if (Content.CanSeek) 
                Content.Position = 0;

            using var reader = new StreamReader(Content, System.Text.Encoding.UTF8, true, -1, true);
            return await reader.ReadToEndAsync();
        }

        public void Dispose()
        {
            Content?.Dispose();
        }
    }
}
