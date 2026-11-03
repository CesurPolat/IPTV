namespace Application.Abstractions;

public interface IShortizleResolver
{
    Task<string> ResolveAsync(Uri episode, CancellationToken cancellationToken);
}

public interface IShortizlePlayback
{
    Task<int> SwitchSourceAsync(string sessionId, int revision, CancellationToken cancellationToken, int? sourceNumber = null);
    Task<ShortizleResource> OpenAsync(string sessionId, string? resourceId, string? range,
        Func<string, string> resourceUrl, CancellationToken cancellationToken, int? revision = null);
}

public sealed class ShortizleException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

public sealed class ShortizleResource : IDisposable
{
    public required Stream Body { get; init; }
    public required string ContentType { get; init; }
    public int Status { get; init; } = 200;
    public Dictionary<string, string> Headers { get; init; } = new();
    public IDisposable? Owner { get; init; }
    public void Dispose() { Body.Dispose(); Owner?.Dispose(); }
}
