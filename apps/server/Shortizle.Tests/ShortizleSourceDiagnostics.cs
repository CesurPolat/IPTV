using System.Diagnostics;
using System.Text.Json.Nodes;
using Application.Abstractions;
using Infrastructure.Services.Streaming.Shortizle;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Shortizle.Tests;

[TestClass]
public class ShortizleSourceDiagnostics
{
    [TestMethod]
    public async Task InspectEpisodeSources()
    {
        var episode = Environment.GetEnvironmentVariable("SHORTIZLE_DIAG_EPISODE");
        if (string.IsNullOrWhiteSpace(episode)) { Assert.Inconclusive("Opt-in: SHORTIZLE_DIAG_EPISODE=/watch URL"); return; }
        using var service = new ShortizleService();
        var id = await service.ResolveAsync(new Uri(episode), default);
        var revision = 0;
        var builder = WebApplication.CreateBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        app.MapGet("/master.m3u8", (Microsoft.AspNetCore.Http.HttpContext context) => Write(context, null));
        app.MapGet("/resource/{resourceId}", (Microsoft.AspNetCore.Http.HttpContext context, string resourceId) => Write(context, resourceId));
        async Task Write(Microsoft.AspNetCore.Http.HttpContext context, string? resourceId)
        {
            try
            {
                using var resource = await service.OpenAsync(id, resourceId, context.Request.Headers.Range.FirstOrDefault(), x => "/resource/" + x, default, revision);
                context.Response.StatusCode = resource.Status;
                foreach (var header in resource.Headers) context.Response.Headers[header.Key] = header.Value;
                context.Response.ContentType = resource.ContentType;
                await resource.Body.CopyToAsync(context.Response.Body);
            }
            catch (ShortizleException ex)
            {
                Console.WriteLine($"PROXY_ERROR {ex.Status} {ex.Code}");
                context.Response.StatusCode = ex.Status;
            }
        }
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        for (var number = 1; number <= 12; number++)
        {
            try { revision = await service.SwitchSourceAsync(id, revision, default, number); }
            catch (ShortizleException ex)
            {
                Console.WriteLine($"SOURCE {number}: {ex.Status} {ex.Code}");
                if (ex.Code == "source_not_found") break;
                continue;
            }
            var start = new ProcessStartInfo("ffprobe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
            foreach (var arg in new[] { "-v", "error", "-allowed_extensions", "ALL", "-allowed_segment_extensions", "ALL", "-extension_picky", "0", "-rw_timeout", "15000000", "-analyzeduration", "3000000", "-probesize", "3000000", "-show_entries", "stream=codec_name,codec_type,width,height", "-of", "json", address + "/master.m3u8" }) start.ArgumentList.Add(arg);
            using var process = Process.Start(start)!;
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(50));
            try { await process.WaitForExitAsync(timeout.Token); }
            catch (OperationCanceledException) { process.Kill(true); await process.WaitForExitAsync(); }
            var output = await stdout;
            var errors = await stderr;
            if (process.ExitCode != 0) {
                // Upstream URLs can contain credentials; never print raw ffprobe errors.
                var sanitized = System.Text.RegularExpressions.Regex.Replace(errors, "https?://[^\\s]+", "[media-url]");
                Console.WriteLine($"SOURCE {number} ERROR: {sanitized[..Math.Min(1500, sanitized.Length)]}");
            }
            var streams = JsonNode.Parse(string.IsNullOrWhiteSpace(output) ? "{}" : output)?["streams"];
            Console.WriteLine($"SOURCE {number}: exit={process.ExitCode} streams={streams?.ToJsonString() ?? "unknown"}");
        }
        await app.StopAsync();
    }
}
