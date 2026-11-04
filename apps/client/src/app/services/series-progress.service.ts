import { Injectable } from '@angular/core';

export interface SeriesProgress {
  series: string;
  name: string;
  image: string;
  season: number;
  episode: number;
  position: number;
  updatedAt: number;
  source?: number;
}

@Injectable({ providedIn: 'root' })
export class SeriesProgressService {
  private readonly key = 'series_progress_v1';

  list(): SeriesProgress[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(this.key) || '[]');
      if (!Array.isArray(value)) return [];
      return value.filter((item: any) => item && typeof item.series === 'string' && !!item.series &&
        typeof item.name === 'string' && !!item.name && typeof item.image === 'string' &&
        Number.isSafeInteger(item.season) && item.season > 0 && Number.isSafeInteger(item.episode) && item.episode > 0 &&
        Number.isFinite(item.position) && item.position >= 0 && Number.isFinite(item.updatedAt))
        .sort((a: SeriesProgress, b: SeriesProgress) => b.updatedAt - a.updatedAt);
    } catch { return []; }
  }

  get(series: string): SeriesProgress | undefined { return this.list().find(item => item.series === series); }

  save(progress: SeriesProgress): void {
    try { localStorage.setItem(this.key, JSON.stringify([progress, ...this.list().filter(item => item.series !== progress.series)])); }
    catch { /* Playback must still work if storage is unavailable or full. */ }
  }

  remove(series: string): void {
    try { localStorage.setItem(this.key, JSON.stringify(this.list().filter(item => item.series !== series))); }
    catch { /* Storage may be unavailable. */ }
  }
}
