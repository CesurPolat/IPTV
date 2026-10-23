using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace IPTVAPI.Application.Abstractions;

public interface ISocketIOService
{
    event Action<string>? OnMessageReceived;
    event Action? OnConnected;
    event Action? OnDisconnected;

    Task StartAsync(string baseUrl, Dictionary<string, string>? customHeaders = null);
    Task SendAsync(string message, CancellationToken ct = default);
    Task StopAsync();
}
