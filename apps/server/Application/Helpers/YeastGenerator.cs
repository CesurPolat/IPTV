namespace Application.Helpers;

public static class YeastGenerator
{
    private static char[] _alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_".ToCharArray();
    private static string? _last;
    private static int _count = 0;
    private static long _map = 0;

    public static string Yeast()
    {
        string now = Encode(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

        if (now != _last)
        {
            _count = 0;
            _last = now;
            return now;
        }

        return $"{now}.{Encode(_count++)}";
    }

    private static string Encode(long num)
    {
        string encoded = "";
        do
        {
            encoded = _alphabet[num % _alphabet.Length] + encoded;
            num = num / _alphabet.Length;
        } while (num > 0);

        return encoded;
    }
}