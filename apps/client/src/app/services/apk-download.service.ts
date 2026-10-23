import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { environment } from '../../environments/environment';

interface ApkDownloadOptions {
  url: string;
  fileName?: string;
}

interface ApkDownloadResponse {
  downloadId: number;
  fileName: string;
  destination: string;
}

interface ApkDownloaderPlugin {
  download(options: ApkDownloadOptions): Promise<ApkDownloadResponse>;
}

export interface ApkDownloadResult {
  success: boolean;
  downloadId?: number;
  fileName?: string;
  errorMessage?: string;
}

const ApkDownloader = registerPlugin<ApkDownloaderPlugin>('ApkDownloader');

@Injectable({
  providedIn: 'root'
})
export class ApkDownloadService {
  isAndroidSupported(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  async downloadLatestApk(): Promise<ApkDownloadResult> {
    const apkUrl = environment.latestApkUrl?.trim();

    if (!apkUrl) {
      return {
        success: false,
        errorMessage: 'APK indirme baglantisi tanimli degil.'
      };
    }

    if (!this.isAndroidSupported()) {
      return {
        success: false,
        errorMessage: 'Latest APK indirme sadece Android cihazlarda desteklenir.'
      };
    }

    try {
      const response = await ApkDownloader.download({
        url: apkUrl,
        fileName: environment.apkFileName
      });

      return {
        success: true,
        downloadId: response.downloadId,
        fileName: response.fileName
      };
    } catch (error) {
      console.error('Latest APK indirme baslatilirken hata olustu:', error);
      return {
        success: false,
        errorMessage: 'Latest APK indirilemedi. Lutfen tekrar deneyin.'
      };
    }
  }
}