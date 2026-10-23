using IPTVAPI.Application.DTOs;

namespace IPTVAPI.Application.Abstractions;

public interface IStreamingService
{
    Task<string> GetMediaUrl(string url);
    Task<List<StreamingRawResult>> SearchContent(string searchTerm);
    Task<StreamingSeriesDetail?> GetSeriesDetail(string seriesId);
}
