using Application.Abstractions;
using Application.Helpers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace IPTVAPI.Controllers;

[ApiController]
[Route("Streaming/Shortizle/{sessionId}")]
[ShortizleErrors]
public sealed class ShortizleController(IShortizlePlayback playback) : ControllerBase
{
    public sealed record FailoverRequest(int Revision, int? SourceNumber = null, string? Group = null);

    [HttpGet("audio")]
    public async Task<ShortizleAudioOptions> Audio(string sessionId, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        return await playback.GetAudioOptionsAsync(sessionId, cancellationToken);
    }

    [HttpPost("failover")]
    public async Task<IActionResult> Failover(string sessionId, [FromBody] FailoverRequest request, CancellationToken cancellationToken)
    {
        var revision = await playback.SwitchSourceAsync(sessionId, request.Revision, cancellationToken, request.SourceNumber, request.Group);
        var file = await playback.GetPlaybackFileAsync(sessionId, revision, cancellationToken);
        Response.Headers.CacheControl = "no-store";
        var selection = request.SourceNumber is int number ? $"&source={number}" : "";
        return Content($"{PlaybackBase(Request)}/Streaming/Shortizle/{sessionId}/{file}?revision={revision}{selection}", "text/plain");
    }
    // APIUrl is initialized by the existing recorder startup path; it can be empty when recording is disabled.
    internal static string PlaybackBase(HttpRequest request) => string.IsNullOrWhiteSpace(ConfigHelper.APIUrl)
        ? $"{request.Scheme}://{request.Host}{request.PathBase}" : ConfigHelper.APIUrl.TrimEnd('/');

    [HttpGet("master.m3u8")]
    public Task GetMaster(string sessionId, [FromQuery] int? revision = null) => Write(sessionId, null, revision);

    [HttpGet("media.mp4")]
    public Task GetMedia(string sessionId, [FromQuery] int? revision = null) => Write(sessionId, null, revision);

    [HttpGet("resource/{resourceId}")]
    public Task GetResource(string sessionId, string resourceId) => Write(sessionId, resourceId);

    private async Task Write(string sessionId, string? resourceId, int? revision = null)
    {
        using var resource = await playback.OpenAsync(sessionId, resourceId, Request.Headers.Range.FirstOrDefault(),
            id => $"{PlaybackBase(Request)}/Streaming/Shortizle/{sessionId}/resource/{id}", HttpContext.RequestAborted, revision);
        Response.StatusCode = resource.Status;
        Response.ContentType = resource.ContentType;
        Response.Headers.CacheControl = "no-store";
        foreach (var h in resource.Headers) Response.Headers[h.Key] = h.Value;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
        deadline.CancelAfter(TimeSpan.FromMinutes(2));
        await resource.Body.CopyToAsync(Response.Body, deadline.Token);
    }
}

// Only applied to the resolver endpoint and Shortizle media routes.
public sealed class ShortizleErrorsAttribute : ExceptionFilterAttribute
{
    public override void OnException(ExceptionContext context)
    {
        if (context.HttpContext.Response.HasStarted || context.HttpContext.RequestAborted.IsCancellationRequested) return;
        var error = context.Exception switch
        {
            ShortizleException ex => ex,
            OperationCanceledException => new ShortizleException(504, "upstream_timeout", "Kaynak sunucu zaman aşımına uğradı."),
            HttpRequestException => new ShortizleException(502, "upstream_error", "Kaynak sunucuya erişilemedi."),
            System.Text.Json.JsonException or InvalidOperationException or UriFormatException or System.IO.InvalidDataException or System.Text.DecoderFallbackException
                => new ShortizleException(502, "invalid_response", "Kaynak sunucu yanıtı geçersiz."),
            _ => null
        };
        if (error == null) return;
        context.HttpContext.Response.Clear();
        context.HttpContext.Response.Headers.CacheControl = "no-store";
        var problem = new ProblemDetails { Status = error.Status, Title = error.Code, Detail = error.Message };
        problem.Extensions["code"] = error.Code;
        context.Result = new ObjectResult(problem) { StatusCode = error.Status, ContentTypes = { "application/problem+json" } };
        context.ExceptionHandled = true;
    }
}
