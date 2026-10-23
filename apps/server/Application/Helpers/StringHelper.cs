using System.Text.RegularExpressions;

namespace Application.Helpers;

/// <summary>
/// String işlemleri için yardımcı metodlar
/// </summary>
public static class StringHelper
{
    /// <summary>
    /// Tüm escape karakterlerini temizler (\/, \u015f vb.)
    /// </summary>
    public static string? UnescapeString(string? input)
    {
        if (string.IsNullOrEmpty(input))
            return input;

        // Önce JSON escape karakterlerini temizle (\/, \\ vb.)
        var result = input
            .Replace("\\/", "/")
            .Replace("\\\\", "\\")
            .Replace("\\n", "\n")
            .Replace("\\r", "\r")
            .Replace("\\t", "\t")
            .Replace("\\\"", "\"");

        // Sonra Unicode escape karakterlerini decode et
        result = Regex.Replace(
            result,
            @"\\u([0-9A-Fa-f]{4})",
            match => ((char)Convert.ToInt32(match.Groups[1].Value, 16)).ToString()
        );

        return result;
    }

    /// <summary>
    /// Unicode escape karakterlerini decode eder (örn: \u015f -> ş)
    /// </summary>
    public static string DecodeUnicodeEscapes(string input)
    {
        return UnescapeString(input) ?? input;
    }

    /// <summary>
    /// Değerin geçerli bir URL olup olmadığını kontrol eder
    /// </summary>
    public static bool IsValidUrl(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return false;

        return value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
               value.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Değerin kategori listesi olup olmadığını kontrol eder (URL değilse ve sayı değilse)
    /// </summary>
    public static bool IsCategories(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return false;

        // URL ise kategori değildir
        if (IsValidUrl(value))
            return false;

        // Sayı ise kategori değildir (örn: "0")
        if (int.TryParse(value, out _))
            return false;

        return true;
    }

    /// <summary>
    /// Virgülle ayrılmış string'i array'e çevirir ve her elemanı decode eder
    /// </summary>
    public static string[]? ParseCategories(string? categoriesSource)
    {
        if (string.IsNullOrEmpty(categoriesSource))
            return null;

        return categoriesSource
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(c => DecodeUnicodeEscapes(c.Trim()))
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .ToArray();
    }

    public static string SanitizeName(string name)
    {
        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = string.Concat(name.Trim().Select(c => invalidChars.Contains(c) ? '_' : c));
        return string.IsNullOrWhiteSpace(sanitized) ? "default" : sanitized;
    }

    /// <summary>
    /// Metni URL-safe hale getirir (RFC 3986).
    /// </summary>
    public static string UrlEncode(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return string.Empty;

        return Uri.EscapeDataString(value);
    }

    /// <summary>
    /// URL-encoded metni çözer.
    /// </summary>
    public static string UrlDecode(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return string.Empty;

        return Uri.UnescapeDataString(value);
    }
}
