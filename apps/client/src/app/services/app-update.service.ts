import { Inject, Injectable, InjectionToken } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Updater, UpdaterPlugin } from 'capacitor-web-updater';
import { environment } from '../../environments/environment';

export interface AppUpdateState {
  hasChecked: boolean;
  isChecking: boolean;
  updateAvailable: boolean;
}

interface UpdateRelease {
  version: string;
  url: string;
}

export const APP_UPDATER = new InjectionToken<UpdaterPlugin>('APP_UPDATER', {
  providedIn: 'root', factory: () => Updater
});

@Injectable({
  providedIn: 'root'
})
export class AppUpdateService {
  constructor(@Inject(APP_UPDATER) private readonly updater: UpdaterPlugin) {}
  private readonly notifiedVersionStorageKey = 'updateNoticeShownForVersion';
  private latestVersionUrl: string | null = null;
  private applyingUpdate = false;
  private readonly stateSubject = new BehaviorSubject<AppUpdateState>({
    hasChecked: false,
    isChecking: false,
    updateAvailable: false
  });

  readonly state$ = this.stateSubject.asObservable();

  get state(): AppUpdateState {
    return this.stateSubject.value;
  }

  async checkForUpdates(): Promise<AppUpdateState> {
    this.latestVersionUrl = null;
    this.stateSubject.next({
      ...this.state,
      isChecking: true
    });

    try {
      const release = await this.getLatestRelease();
      console.log('Son surum URL:', release?.url ?? null);

      if (!release || this.compareVersions(release.version, environment.version) <= 0) {
        this.latestVersionUrl = null;
        const nextState: AppUpdateState = {
          hasChecked: true,
          isChecking: false,
          updateAvailable: false
        };
        this.stateSubject.next(nextState);
        return nextState;
      }

      this.latestVersionUrl = release.url;
      const nextState: AppUpdateState = {
        hasChecked: true,
        isChecking: false,
        updateAvailable: true
      };
      this.stateSubject.next(nextState);
      return nextState;
    } catch (error) {
      console.error('Guncelleme kontrolu sirasinda hata olustu:', error);
      const nextState: AppUpdateState = {
        ...this.state,
        hasChecked: true,
        isChecking: false,
        updateAvailable: false
      };
      this.stateSubject.next(nextState);
      return nextState;
    }
  }

  shouldNotifyForCurrentVersion(): boolean {
    try {
      return localStorage.getItem(this.notifiedVersionStorageKey) !== environment.version;
    } catch {
      return true;
    }
  }

  markCurrentVersionAsNotified(): void {
    try {
      localStorage.setItem(this.notifiedVersionStorageKey, environment.version);
    } catch {
      // Ignore storage write failures.
    }
  }

  async applyUpdate(): Promise<boolean> {
    if (this.applyingUpdate || this.state.isChecking || !this.state.updateAvailable || !this.latestVersionUrl) {
      return false;
    }

    this.applyingUpdate = true;
    try {
      const result = await this.updater.getVersion({ value: this.latestVersionUrl });
      if (result?.value !== true) {
        console.error('Guncelleme indirilemedi veya kurulamadı.');
        return false;
      }
      this.reloadApp();
      return true;
    } catch (error) {
      console.error('Guncelleme uygulanirken hata olustu:', error);
      return false;
    } finally {
      this.applyingUpdate = false;
    }
  }

  private reloadApp() {
    document.location.href = 'index.html';
  }

  private async getLatestRelease(): Promise<UpdateRelease | null> {
    const versions = await this.updater.listVersions();
    const payload: unknown = typeof versions.value === 'string' ? JSON.parse(versions.value) : versions.value;
    if (!Array.isArray(payload)) throw new Error('Guncelleme listesi gecersiz.');
    const releases: UpdateRelease[] = [];
    for (const entry of payload) {
      try {
        // Accept legacy URL arrays too, without treating JSON text as characters.
        const url = new URL(typeof entry === 'string' ? entry : entry?.url);
        if (url.protocol !== 'https:' || url.username || url.password || !url.pathname.toLowerCase().endsWith('.zip')) continue;
        const version = typeof entry === 'string'
          ? decodeURIComponent(url.pathname.split('/').pop()!).replace(/\.zip$/i, '').replace(/_/g, '.')
          : entry?.version;
        if (typeof version !== 'string' || !this.versionParts(version)) continue;
        releases.push({ version, url: url.href });
      } catch { /* Ignore malformed release entries. */ }
    }
    releases.sort((a, b) => this.compareVersions(a.version, b.version));
    return releases.at(-1) ?? null;
  }

  private compareVersions(a: string, b: string): number {
    const left = this.versionParts(a);
    const right = this.versionParts(b);
    if (!left || !right) throw new Error('Surum numarasi gecersiz.');
    for (let i = 1; i <= 3; i++) {
      const difference = Number(left[i]) - Number(right[i]);
      if (difference) return difference;
    }
    const aPre = left[4], bPre = right[4];
    if (!aPre || !bPre) return aPre ? -1 : bPre ? 1 : 0;
    const aIds = aPre.split('.'), bIds = bPre.split('.');
    for (let i = 0; i < Math.max(aIds.length, bIds.length); i++) {
      if (aIds[i] === undefined) return -1;
      if (bIds[i] === undefined) return 1;
      if (aIds[i] === bIds[i]) continue;
      const aNumeric = /^\d+$/.test(aIds[i]), bNumeric = /^\d+$/.test(bIds[i]);
      if (aNumeric && bNumeric) return Number(aIds[i]) - Number(bIds[i]);
      if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
      return aIds[i] < bIds[i] ? -1 : 1;
    }
    return 0;
  }

  private versionParts(version: string) {
    return version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  }
}
