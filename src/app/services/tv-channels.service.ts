import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap, map, switchMap } from 'rxjs';
import { CapacitorHttp } from '@capacitor/core';

export interface Channel {
  id: string;
  name: string;
  poster: string;
  source: string;
  category: string;
  
  channelId?: string;
  currentShow?: string;
  originalIndex?: number;
}

export interface BroadcastSchedule {
  channelId: string;
  showTitle: string;
  showTime: string;
  date: string;
}

@Injectable({
  providedIn: 'root'
})
export class TvChannelsService {

  private static baseUrl = 'https://advanced-streaming.online';

  private channels: Channel[] = [];

  constructor(private http: HttpClient) { }

  loadChannels(): Observable<Channel[]> {
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
      const response = await CapacitorHttp.post({
        url: (await this.resolveRedirect())+'bg/searchcontent',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        data: `searchterm=${encodeURIComponent(searchTerm)}`
      });

      // User'ın paylaştığı yapıya göre: response.data.data.result
      const results = response.data?.data?.result || [];
      
      return results.map((item: any) => ({
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
      return [];
    }
  }

    async resolveRedirect(url: string = 'https://dizipal1535.com/'): Promise<string> {
    try {
      // redirectdetective.com servisini kullanarak yönlendirmeyi dış servis üzerinden buluyoruz
      const response = await CapacitorHttp.post({
        url: 'https://redirectdetective.com/ld.px',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'referer': 'https://redirectdetective.com/',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        data: `w=${encodeURIComponent(url)}&f=true`
      });

      const html = response.data;
      if (!html) return url;

      // Dönen HTML içerisindeki tüm href linklerini ayıklıyoruz
      const regex = /href="(https?:\/\/[^"]+)"/g;
      let matches;
      let urls: string[] = [];
      
      while ((matches = regex.exec(html)) !== null) {
        let foundUrl = matches[1].trim();
        // Orijinal URL'den farklı olan yeni bir URL bulursak listeye ekliyoruz
        if (foundUrl !== url && !urls.includes(foundUrl)) {
          urls.push(foundUrl);
        }
      }

      // Eğer yönlendirme zinciri bulunduysa, listedeki en son (güncel) URL'i dönüyoruz
      if (urls.length > 0) {
        const finalUrl = urls[urls.length - 1];
        console.log('[Redirect] Redirect detected via external service:', url, '->', finalUrl);
        return finalUrl;
      }

      return url;
    } catch (error) {
      console.error('Redirect resolve error:', error);
      return url;
    }
  }
}
