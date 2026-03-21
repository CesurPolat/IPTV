import { Component, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationComponent } from './components/notification/notification.component';
import { Updater } from 'capacitor-web-updater';
import { environment } from '../environments/environment';
import { App as CapacitorApp } from '@capacitor/app';
import { Router } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NotificationComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'IPTV';
  appVersion: string = environment.version;
  private backButtonListener?: Promise<{ remove: () => Promise<void> | void }>;


  constructor(private router: Router) {

    this.setupBackButtonListener();

    Updater.echo({ value: 'Capacitor Web Updater is ready!' });
    Updater.isLatestVersion({ value: this.appVersion }).then((result) => {
      if (!result.value) {
        console.log('Yeni bir güncelleme mevcut');
        // Burada kullanıcıya güncelleme yapması için bir bildirim gösterebilirsiniz
        Updater.getLatestVersion().then((latestVersion) => {
          console.log('En son sürüm:', latestVersion.value);
          document.location.href = 'index.html';
        });

      } else {
        console.log('Uygulama en son sürümde.');
      }
    }).catch((error) => {
      console.error('Güncelleme kontrolü sırasında hata oluştu:', error);
    });

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
