import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, tap, map, switchMap, firstValueFrom, timeout } from 'rxjs';
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

export interface ShortizleTitle {
  id: string;
  slug: string;
  name: string;
  url: string;
  posterUrl: string | null;
  description: string | null;
  episodeCount: number;
  hasDublaj: boolean;
  hasAltyazi: boolean;
  isAdult: boolean;
}

export interface ShortizleCollection {
  key: string;
  title: string;
  items: ShortizleTitle[];
}

export interface ShortizleCatalog {
  heading: string;
  collections: ShortizleCollection[];
  options?: ShortizleSearchOptions;
}

export interface ShortizleSearchOptions {
  genres: { value: string; label: string }[];
  platforms: { value: string; label: string }[];
}
export interface ShortizleSearchQuery {
  q: string; genres: string[]; platform: string; kind: string; sort: string; view: string; page: number;
}
export interface ShortizleSearchResult {
  items: ShortizleTitle[]; page: number; lastPage: number; perPage: number; total: number; options: ShortizleSearchOptions;
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
      const [legacy, shortizle] = await Promise.allSettled([
        firstValueFrom(this.http.get<any[]>(`${TvChannelsService.baseUrl}/streaming/Search?searchTerm=${encodeURIComponent(searchTerm)}`).pipe(timeout(15000))),
        this.searchShortizle({ q: searchTerm, genres: [], platform: '', kind: 'dublaj', sort: 'popular', view: 'grid', page: 1 })
      ]);
      if (legacy.status === 'rejected' && shortizle.status === 'rejected') throw shortizle.reason;
      const results: Channel[] = legacy.status === 'fulfilled' ? (legacy.value || []).map((item: any) => ({
        id: String(item.object_id ?? item.provider_results?.[0]?.id ?? item.name ?? ''),
        name: item.object_name ?? item.name ?? '',
        poster: item.object_poster_url ?? item.poster_url ?? '',
        source: item.used_slug ?? item.provider_results?.[0]?.slug ?? '',
        category: /series/i.test(item.used_type ?? item.type ?? '') ? 'Series' : (item.used_type ?? item.type ?? ''),
        originalIndex: -1
      })).filter((item: Channel) => !!item.source) : [];
      if (shortizle.status === 'fulfilled') results.push(...shortizle.value.items.map(item => ({
        id: `shortizle:${item.id}`, name: item.name, poster: item.posterUrl || '', source: item.url, category: 'Series', originalIndex: -1
      })));
      return results;
    } catch (error) {
      console.error('Search content error:', error);
      this.notificationService.showError('İçerik aranırken bir hata oluştu: ' + error);
      return [];
    }
  }

  async getShortizleCollections(): Promise<ShortizleCatalog> {
    return firstValueFrom(this.http.get<ShortizleCatalog>(`${TvChannelsService.baseUrl}/Streaming/Shortizle/collections`));
  }

  async searchShortizle(query: ShortizleSearchQuery): Promise<ShortizleSearchResult> {
    let params = new HttpParams().set('q', query.q).set('platform', query.platform).set('kind', query.kind)
      .set('sort', query.sort).set('view', query.view).set('page', query.page);
    for (const genre of query.genres) params = params.append('genres[]', genre);
    return firstValueFrom(this.http.get<ShortizleSearchResult>(`${TvChannelsService.baseUrl}/Streaming/Shortizle/search`, { params }));
  }

  async getSeriesDetails(seriesId: string): Promise<DizipalSeriesDetail | null> {
    if (!seriesId) return null;

    try {
      let detailUrl = `${TvChannelsService.baseUrl}/Streaming/GetSeriesDetail?seriesId=${encodeURIComponent(seriesId)}`;
      try {
        const parsed = new URL(seriesId);
        const match = parsed.pathname.match(/^\/icerik\/([a-zA-Z0-9_-]+)\/?$/);
        if (parsed.protocol === 'https:' && parsed.hostname === 'shortizle.com' && match) {
          detailUrl = `${TvChannelsService.baseUrl}/Streaming/Shortizle/series/${encodeURIComponent(match[1])}`;
        }
      } catch { /* Existing providers also use non-URL series IDs. */ }
      const result = await firstValueFrom(this.http.get<DizipalSeriesDetail>(detailUrl));
      
      if (result && result.image) {
        result.image = result.image.replace('f/f', '1920/1080');
      }

      const seasons = Array.isArray(result.containsSeason) ? result.containsSeason : result.containsSeason ? [result.containsSeason] : [];
      seasons.forEach((season: DizipalSeason) => {
        const episodes = Array.isArray(season.episode) ? season.episode : season.episode ? [season.episode] : [];
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
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      throw new Error(problem?.detail || 'Video kaynağı alınamadı.');
    }
    return response.text();
  }

}
