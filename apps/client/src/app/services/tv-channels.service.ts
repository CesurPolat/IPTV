import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap, map, switchMap, firstValueFrom } from 'rxjs';
import { NotificationService } from './notification.service';
import { environment } from '../../environments/environment';

export interface Channel {
  id: string;
  name: string;
  poster: string;
  source: string;
  recordingSource?: string;
  category: string;
  
  channelId?: string;
  currentShow?: string;
  originalIndex?: number;
  adsRegex?: string;
}

export interface DizipalEpisode {
  name: string;
  url: string;
  episodeNumber: number;
  description?: string;
}

export interface DizipalSeason {
  seasonNumber: number;
  numberOfEpisodes: number;
  episode: DizipalEpisode | DizipalEpisode[];
}

export interface DizipalSeriesDetail {
  name: string;
  description: string;
  image: string;
  url: string;
  containsSeason: DizipalSeason | DizipalSeason[];
}

export interface BroadcastSchedule {
  channelId: string;
  showTitle: string;
  showTime: string;
  date: string;
}

export type TvChannelFilterMode = 'all' | 'include' | 'exclude';

@Injectable({
  providedIn: 'root'
})
export class TvChannelsService {

  private static baseUrl = environment.baseUrl;
  private readonly tvChannelFilterModeStorageKey = 'tvChannelFilterMode';
  private readonly tvChannelFilterIdsStorageKey = 'tvChannelFilterIds';

  private channels: Channel[] = [];
  private tvChannelFilterMode: TvChannelFilterMode = 'all';
  private selectedTvChannelIds = new Set<string>();

  constructor(
    private http: HttpClient,
    private notificationService: NotificationService
  ) {
    this.tvChannelFilterMode = this.readTvChannelFilterMode();
    this.selectedTvChannelIds = this.readSelectedTvChannelIds();
  }

  loadChannels(): Observable<Channel[]> {
    return this.loadRawChannels().pipe(
      map((channels) => this.applyTvChannelFilter(channels))
    );
  }

  getAvailableTvChannels(): Observable<Channel[]> {
    return this.loadRawChannels().pipe(
      map((channels) => channels.filter((channel) => channel.category === 'TVChannel'))
    );
  }

  getTvChannelFilterMode(): TvChannelFilterMode {
    return this.tvChannelFilterMode;
  }

  setTvChannelFilterMode(mode: TvChannelFilterMode): void {
    this.tvChannelFilterMode = mode;
    try {
      localStorage.setItem(this.tvChannelFilterModeStorageKey, mode);
    } catch {
      // Ignore storage write issues to avoid breaking settings UI.
    }
  }

  getSelectedTvChannelIds(): string[] {
    return Array.from(this.selectedTvChannelIds);
  }

  isTvChannelSelected(channel: Channel): boolean {
    return this.selectedTvChannelIds.has(this.getTvChannelSelectionKey(channel));
  }

  toggleTvChannelSelection(channel: Channel): void {
    const key = this.getTvChannelSelectionKey(channel);
    if (this.selectedTvChannelIds.has(key)) {
      this.selectedTvChannelIds.delete(key);
    } else {
      this.selectedTvChannelIds.add(key);
    }

    this.persistSelectedTvChannelIds();
  }

  private loadRawChannels(): Observable<Channel[]> {
    const hasChannels = this.channels.length > 0;
    const channelsLoadTime = parseInt(localStorage.getItem('channelsLoadTime') || '0');
    const isCacheValid = channelsLoadTime > Date.now();

    if (hasChannels && isCacheValid) {
      return this.getCurrentSchedule(this.channels);
    }

    return this.http.get<Channel[]>(`${TvChannelsService.baseUrl}/iptv/GetAll`).pipe(
      tap(data => {
        const loadTime = new Date();
        loadTime.setHours(loadTime.getHours() + 3);
        localStorage.setItem('channelsLoadTime', loadTime.getTime().toString());
      }),
      switchMap((data: Channel[]) => this.getCurrentSchedule(data).pipe(
        tap(channelsWithSchedule => {
          this.channels = channelsWithSchedule;
        })
      ))
    );
  }

  private applyTvChannelFilter(channels: Channel[]): Channel[] {
    if (this.tvChannelFilterMode === 'all') {
      return channels;
    }

    return channels.filter((channel) => {
      if (channel.category !== 'TVChannel') {
        return true;
      }

      const isSelected = this.selectedTvChannelIds.has(this.getTvChannelSelectionKey(channel));
      return this.tvChannelFilterMode === 'include' ? isSelected : !isSelected;
    });
  }

  private getTvChannelSelectionKey(channel: Channel): string {
    return channel.channelId || channel.id || channel.name;
  }

  private readTvChannelFilterMode(): TvChannelFilterMode {
    try {
      const stored = localStorage.getItem(this.tvChannelFilterModeStorageKey);
      if (stored === 'all' || stored === 'include' || stored === 'exclude') {
        return stored;
      }
    } catch {
      // Ignore storage read issues and fall back to defaults.
    }

    return 'all';
  }

  private readSelectedTvChannelIds(): Set<string> {
    try {
      const stored = localStorage.getItem(this.tvChannelFilterIdsStorageKey);
      if (!stored) {
        return new Set<string>();
      }

      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return new Set<string>(parsed.filter((item): item is string => typeof item === 'string'));
      }
    } catch {
      // Ignore storage read issues and fall back to defaults.
    }

    return new Set<string>();
  }

  private persistSelectedTvChannelIds(): void {
    try {
      localStorage.setItem(this.tvChannelFilterIdsStorageKey, JSON.stringify(Array.from(this.selectedTvChannelIds)));
    } catch {
      // Ignore storage write issues to avoid breaking settings UI.
    }
  }

  getCurrentSchedule(_channel: Channel[]): Observable<Channel[]> {
    return this.http.get<BroadcastSchedule[]>(`${TvChannelsService.baseUrl}/iptv/GetCurrentSchedule`).pipe(
      map(data => {
        data.forEach(schedule => {
          const channel = _channel.find(channel => channel.channelId === schedule.channelId);
          if (channel) {
            channel.currentShow = schedule.showTitle;
          }
        });
        return _channel;
      })
    );
  }

  async searchContent(searchTerm: string): Promise<Channel[]> {
    if (!searchTerm || searchTerm.length < 2) return [];

    try {
      const results = await firstValueFrom(
        this.http.get<any[]>(`${TvChannelsService.baseUrl}/streaming/Search?searchTerm=${encodeURIComponent(searchTerm)}`)
      );

      return (results || []).map((item: any) => ({
        id: item.object_id.toString(),
        name: item.object_name,
        poster: item.object_poster_url,
        // Slug'ı source olarak kullanıyoruz, player component'inde işlenmesi gerekebilir
        source: item.used_slug,
        category: item.used_type,
        originalIndex: -1 // API'den gelenler için işaret
      }));
    } catch (error) {
      console.error('Search content error:', error);
      this.notificationService.showError('İçerik aranırken bir hata oluştu: ' + error);
      return [];
    }
  }

  async getSeriesDetails(seriesId: string): Promise<DizipalSeriesDetail | null> {
    if (!seriesId) return null;

    try {
      const result = await firstValueFrom(
        this.http.get<DizipalSeriesDetail>(`${TvChannelsService.baseUrl}/Streaming/GetSeriesDetail?seriesId=${encodeURIComponent(seriesId)}`)
      );
      
      if (result && result.image) {
        result.image = result.image.replace('f/f', '1920/1080');
      }

      const seasons = Array.isArray(result.containsSeason) ? result.containsSeason : [result.containsSeason];
      seasons.forEach((season: DizipalSeason) => {
        const episodes = Array.isArray(season.episode) ? season.episode : [season.episode];
        episodes.forEach(episode => {
          if (episode && episode.url) {
            episode.url = `${TvChannelsService.baseUrl}/Streaming/GetMediaUrl?url=${encodeURIComponent(episode.url)}`;
          }
        });
      });
      
      return result;
    } catch (error) {
      console.error('Get series details error:', error);
      this.notificationService.showError('Dizi detayları yüklenirken bir hata oluştu');
      return null;
    }
  }

  async getVideoUrl(proxyUrl: string): Promise<string> {
    try {
      const response = await fetch(proxyUrl);
      return response.text();
    } catch (error) {
      console.error('Get video URL error:', error);
      return proxyUrl;
    }
  }

}
