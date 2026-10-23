using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Application.Helpers;
using IPTVAPI.Application.Abstractions;

namespace IPTVAPI.Infrastructure.Services.SocketIO;

public class SocketIOService : ISocketIOService
{
    private readonly HttpClient _httpClient;
    private ClientWebSocket? _webSocket;
    private CancellationTokenSource? _cts;

    public event Action<string>? OnMessageReceived;
    public event Action? OnConnected;
    public event Action? OnDisconnected;

    private readonly Dictionary<string, string> _defaultHeaders = new()
    {
        { "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36" }
    };

    public SocketIOService()
    {
        _httpClient = new HttpClient();
    }

    public async Task StartAsync(string baseUrl, Dictionary<string, string>? customHeaders = null)
    {
        _cts = new CancellationTokenSource();
        
        var headers = new Dictionary<string, string>(_defaultHeaders);
        if (customHeaders != null)
        {
            foreach (var kvp in customHeaders)
            {
                headers[kvp.Key] = kvp.Value;
            }
        }

        string sid = await InitializeHandshakeAsync(baseUrl, headers, _cts.Token);
        if (string.IsNullOrEmpty(sid))
        {
            throw new Exception("Handshake failed: SID not found.");
        }

        await ConnectWebSocketAsync(baseUrl, sid, headers, _cts.Token);
    }

    private async Task<string> InitializeHandshakeAsync(string baseUrl, Dictionary<string, string> headers, CancellationToken ct)
    {
        string t = YeastGenerator.Yeast();
        string url = $"{baseUrl.TrimEnd('/')}/socket.io/?EIO=3&transport=polling&t={t}";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var header in headers)
        {
            if (header.Key.Equals("Origin", StringComparison.OrdinalIgnoreCase) || 
                header.Key.Equals("Referer", StringComparison.OrdinalIgnoreCase))
            {
                request.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }
            else
            {
                _httpClient.DefaultRequestHeaders.TryAddWithoutValidation(header.Key, header.Value);
            }
        }

        var response = await _httpClient.SendAsync(request, ct);
        var content = await response.Content.ReadAsStringAsync(ct);

        var match = Regex.Match(content, "\"sid\":\"([^\"]+)\"");
        return match.Success ? match.Groups[1].Value : string.Empty;
    }

    private async Task ConnectWebSocketAsync(string baseUrl, string sid, Dictionary<string, string> headers, CancellationToken ct)
    {
        var wsUrl = baseUrl.Replace("http://", "ws://").Replace("https://", "wss://").TrimEnd('/') 
                    + $"/socket.io/?EIO=3&transport=websocket&sid={sid}";

        _webSocket = new ClientWebSocket();
        foreach (var header in headers)
        {
            _webSocket.Options.SetRequestHeader(header.Key, header.Value);
        }
        _webSocket.Options.SetRequestHeader("Cookie", $"io={sid}");

        await _webSocket.ConnectAsync(new Uri(wsUrl), ct);
        OnConnected?.Invoke();

        // Socket.io EIO=3 manual upgrade sequence
        await SendAsync("2probe", ct);

        _ = Task.Run(() => ReceiveLoopAsync(ct), ct);
    }

    private async Task ReceiveLoopAsync(CancellationToken ct)
    {
        var buffer = new byte[1024 * 32]; // Increased buffer size
        try
        {
            while (_webSocket?.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await _webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await StopAsync();
                    break;
                }

                var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                
                if (message == "3probe")
                {
                    await SendAsync("5", ct);
                }
                else if (message.StartsWith("2")) // Ping
                {
                    await SendAsync("3", ct); // Pong
                }
                else
                {
                    OnMessageReceived?.Invoke(message);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Console.WriteLine($"WebSocket Error: {ex.Message}");
        }
        finally
        {
            OnDisconnected?.Invoke();
        }
    }

    public async Task SendAsync(string message, CancellationToken ct = default)
    {
        if (_webSocket?.State == WebSocketState.Open)
        {
            var bytes = Encoding.UTF8.GetBytes(message);
            await _webSocket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
        }
    }

    public async Task StopAsync()
    {
        if (_webSocket != null)
        {
            if (_webSocket.State == WebSocketState.Open)
            {
                await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
            }
            _webSocket.Dispose();
            _webSocket = null;
        }
        _cts?.Cancel();
    }
}
