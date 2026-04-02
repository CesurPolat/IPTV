import { Component, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationComponent } from './components/notification/notification.component';
import { App as CapacitorApp } from '@capacitor/app';
import { Router } from '@angular/router';
import { AppUpdateService } from './services/app-update.service';
import { NotificationService } from './services/notification.service';
import { NodeJS } from 'capacitor-nodejs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NotificationComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'IPTV';
  private backButtonListener?: Promise<{ remove: () => Promise<void> | void }>;


  constructor(
    private router: Router,
    private appUpdateService: AppUpdateService,
    private notificationService: NotificationService
  ) {

    this.setupBackButtonListener();
    this.checkForUpdateNotice();

    console.log('Node.js ortamı hazırlanıyor...');
    NodeJS.whenReady().then(() => {
      console.log('Node.js ortamı hazır!');
      // Node.js ile ilgili işlemler burada yapılabilir
    }).catch((error) => {
      console.error('Node.js ortamı hazırlanırken hata oluştu:', error);
    });

  }

  private async checkForUpdateNotice(): Promise<void> {
    const state = await this.appUpdateService.checkForUpdates();
    if (!state.updateAvailable || !this.appUpdateService.shouldNotifyForCurrentVersion()) {
      return;
    }

    this.notificationService.showInfo('Yeni surum mevcut. Ayarlar > Update ile guncelleyebilirsiniz.');
    this.appUpdateService.markCurrentVersionAsNotified();
  }

  private setupBackButtonListener() {
    this.backButtonListener = CapacitorApp.addListener('backButton', () => {
      const previousUrl = this.router.url;

      // Route-level keyboard handlers can still own the behavior.
      const backspaceEvent = new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true
      });

      document.dispatchEvent(backspaceEvent);

      // If a page handled Backspace and changed the route, skip fallback.
      if (this.router.url !== previousUrl || backspaceEvent.defaultPrevented) {
        return;
      }

      if (this.router.url !== '/home') {
        //this.router.navigate(['/home']);
        window.location.href = 'index.html';
      } else {
        CapacitorApp.exitApp();
      }
    });
  }

  ngOnDestroy() {
    this.backButtonListener?.then((listener) => listener.remove());
  }

}
