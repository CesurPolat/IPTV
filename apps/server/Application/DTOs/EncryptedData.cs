using System.Text.Json.Serialization;

namespace IPTVAPI.Application.DTOs
{
    public class EncryptedData
    {
        [JsonPropertyName("ciphertext")]
        public string Ciphertext { get; set; } = string.Empty;

        [JsonPropertyName("iv")]
        public string Iv { get; set; } = string.Empty;

        [JsonPropertyName("salt")]
        public string Salt { get; set; } = string.Empty;
    }
}
