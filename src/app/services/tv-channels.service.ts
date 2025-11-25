import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap } from 'rxjs';

export interface Channel {
  id: string;
  name: string;
  poster: string;
  source: string;
  category: string;
}

@Injectable({
  providedIn: 'root'
})
export class TvChannelsService {
  private channels: Channel[] = [];

  constructor(private http: HttpClient) { }

  loadChannels(): Observable<Channel[]> {
    const hasChannels = this.channels.length > 0;
    const channelsLoadTime = parseInt(localStorage.getItem('channelsLoadTime') || '0');
    const isCacheValid = channelsLoadTime > Date.now();

    if (hasChannels && isCacheValid) {
      return of(this.channels);
    }

    return this.http.get<Channel[]>('https://advanced-streaming.online/iptv/GetAll').pipe(
      tap(data => {
        this.channels = data;
        const loadTime = new Date();
        loadTime.setHours(loadTime.getHours() + 3);
        localStorage.setItem('channelsLoadTime', loadTime.getTime().toString());
      })
    );
  }
}
