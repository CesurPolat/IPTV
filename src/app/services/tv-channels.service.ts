import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap, map, switchMap } from 'rxjs';

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

}
