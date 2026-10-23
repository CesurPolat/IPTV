import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Updater } from 'capacitor-web-updater';
import { environment } from '../../environments/environment';

export interface AppUpdateState {
  hasChecked: boolean;
  isChecking: boolean;
  updateAvailable: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AppUpdateService {
  private readonly notifiedVersionStorageKey = 'updateNoticeShownForVersion';
  private latestVersionUrl: string | null = null;
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
    this.stateSubject.next({
      ...this.state,
      isChecking: true
    });

    try {
      const latestVersionUrl = await this.getLatestVersionUrl();
      console.log('Son surum URL:', latestVersionUrl);

      if (!latestVersionUrl || this.isCurrentVersion(latestVersionUrl)) {
        this.latestVersionUrl = null;
        const nextState: AppUpdateState = {
          hasChecked: true,
          isChecking: false,
          updateAvailable: false
        };
        this.stateSubject.next(nextState);
        return nextState;
      }

      this.latestVersionUrl = latestVersionUrl;
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
    if (!this.state.updateAvailable && !this.latestVersionUrl) {
      return false;
    }

    try {
      const latestVersionUrl = this.latestVersionUrl ?? await this.getLatestVersionUrl();
      if (!latestVersionUrl) {
        return false;
      }

      await Updater.getVersion({ value: latestVersionUrl });
      document.location.href = 'index.html';
      return true;
    } catch (error) {
      console.error('Guncelleme uygulanirken hata olustu:', error);
      return false;
    }
  }

  private async getLatestVersionUrl(): Promise<string | null> {
    const versions = await Updater.listVersions();
    const allVersionUrls = versions.value ?? [];
    console.log('Mevcut versiyonlar:', allVersionUrls);

    if (allVersionUrls.length === 0) {
      return null;
    }

    const sorted = [...allVersionUrls].sort((a, b) =>
      this.compareVersions(this.extractVersionToken(a), this.extractVersionToken(b))
    );

    return sorted[sorted.length - 1] ?? null;
  }

  private isCurrentVersion(versionUrl: string): boolean {
    const current = this.extractVersionToken(environment.version);
    const latest = this.extractVersionToken(versionUrl);

    if (current && latest) {
      return current === latest;
    }

    return versionUrl.includes(environment.version);
  }

  private extractVersionToken(value: string): string {
    const decoded = decodeURIComponent(value);
    const match = decoded.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
    return match?.[0] ?? decoded;
  }

  private compareVersions(a: string, b: string): number {
    const aParts = this.toNumericVersionParts(a);
    const bParts = this.toNumericVersionParts(b);

    const maxLength = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < maxLength; i++) {
      const aValue = aParts[i] ?? 0;
      const bValue = bParts[i] ?? 0;
      if (aValue !== bValue) {
        return aValue - bValue;
      }
    }

    return a.localeCompare(b);
  }

  private toNumericVersionParts(version: string): number[] {
    const numbers = version.match(/\d+/g);
    if (!numbers) {
      return [];
    }

    return numbers.map((value) => Number.parseInt(value, 10));
  }
}