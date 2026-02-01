import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationComponent } from './components/notification/notification.component';
import { Updater } from 'capacitor-web-updater';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NotificationComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'IPTV';
  appVersion: string = "0.4.0";


  constructor() {

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

}
