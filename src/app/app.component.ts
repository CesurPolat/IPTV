import { Component, OnInit, HostListener, ViewChild, ElementRef } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { App as CapacitorApp } from '@capacitor/app';

import { Updater } from 'capacitor-web-updater';

interface Channel {
  id: string;
  name: string;
  poster: string;
  source: string;
  category: string;
}

interface Quality {
  id: string;
  label: string;
  width?: number;
  height?: number;
  bandwidth?: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, HttpClientModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  @ViewChild('menuContent') menuContent!: ElementRef;

  title = 'IPTV';
  player: any;
  isMenuOpen = false;
  selectedIndex = -1;
  showPlayIcon = false;
  channels: Channel[] = [];
  availableQualities: Quality[] = [];
  currentQuality: string = 'auto';
  selectedQualityIndex: number = 0;
  isQualitySelectorActive: boolean = false;
  appVersion: string = "0.1.2"; // Uygulamanızın mevcut sürümünü buraya taşıyın
  currentChannelName: string = '';

  constructor(private http: HttpClient) { }

  ngOnInit() {
    this.loadChannels();
    this.initializePlayer();

    // Capacitor back button listener'ı ekle
    CapacitorApp.addListener('backButton', () => {
      // Backspace tuşuna basılmış gibi davran
      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      this.handleKeyboardEvent(event);
    });

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

  loadChannels() {

    if (!(this.channels.length > 0 && parseInt(localStorage.getItem('channelsLoadTime') || '0', 10) > Date.now())) {

      console.log('Kanal listesi yükleniyor...');

      this.http.get<Channel[]>('https://advanced-streaming.online/iptv/GetAll')
        .subscribe({
          next: (data) => {
            this.channels = data;
            const loadTime = new Date();
            loadTime.setHours(loadTime.getHours() + 3);
            localStorage.setItem('channelsLoadTime', loadTime.getTime().toString());

            if (this.channels.length > 0 && !this.player) {
              this.initializePlayer();
            }
          },
          error: (error) => {
            console.error('Kanal listesi yüklenirken hata oluştu:', error.toString());
          }
        });
    }

  }

  initializePlayer() {
    if (this.channels.length === 0) return;

    this.player = videojs('my-video', {
      controls: false,
      fluid: true,
      sources: [{
        src: this.channels[0].source,
        type: 'application/x-mpegURL'
      }]
    });

    this.selectedIndex = 0;

    //TODO: selectChannel fonksiyonunu kullanarak kanalları seçme işlemini yapabilirsiniz.
    //this.currentChannelName = this.channels[0].name;

    this.player.on('play', () => {
      this.showPlayIcon = false;
    });

    this.player.on('pause', () => {
      this.showPlayIcon = true;
    });

    this.player.play().catch(() => {
      this.showPlayIcon = true;
    });

    // Bit hızlarını logla ve kalite seçeneklerini güncelle
    this.player.on('loadedmetadata', () => {

      const tech = this.player.tech({ IWillNotUseThisInPlugins: true });
      if (tech && tech.vhs) {

        const representations = tech.vhs.representations();
        //console.log('Mevcut Bit Hızları:');

        // Kalite seçeneklerini güncelle
        this.availableQualities = [
          { id: 'auto', label: 'Otomatik' },
          ...representations.map((rep: any) => {
            console.log(rep.playlist.id);

            if (rep.bandwidth) {
              const bitrate = rep.bandwidth / 1000;
              const resolution = rep.width ? `${rep.width}x${rep.height}` : 'Bilinmiyor';
              //console.log(`Kalite: ${resolution} - ${bitrate.toFixed(2)} kbps`);
              return {
                id: rep.id,
                label: `${resolution} (${bitrate.toFixed(0)} kbps)`,
                width: rep.width,
                height: rep.height,
                bandwidth: rep.bandwidth
              };
            }
            return null;
          }).filter((q: Quality | null) => q !== null)
        ];
      }
    });

    // Mevcut bit hızını logla
    this.player.on('ratechange', () => {
      const tech = this.player.tech({ IWillNotUseThisInPlugins: true });
      if (tech && tech.vhs) {
        const currentRep = tech.vhs.representations().find((rep: any) => rep.enabled);
        if (currentRep && currentRep.bandwidth) {
          const currentBitrate = currentRep.bandwidth / 1000;
          const resolution = currentRep.width ? `${currentRep.width}x${currentRep.height}` : 'Bilinmiyor';
          console.log(`Şu anki kalite: ${resolution} - ${currentBitrate.toFixed(2)} kbps`);
        }
      }
    });

  }

  changeChannel(index: number) {
    if (this.player && this.channels[index]) {
      const currentUrl = this.player.currentSrc();
      const newUrl = this.channels[index].source;

      // Eğer seçilen kanal zaten oynatılıyorsa, source'u güncelleme
      if (currentUrl === newUrl) {
        return;
      }

      this.player.src({
        src: newUrl,
        type: 'application/x-mpegURL'
      });

      //this.currentChannelName = this.channels[index].name;

      // Yeni medya yüklendiğinde bit hızını yazdır
      this.player.one('loadedmetadata', () => {
        const tech = this.player.tech({ IWillNotUseThisInPlugins: true });
        if (tech && tech.vhs) {
          const currentRep = tech.vhs.representations().find((rep: any) => rep.enabled);
          if (currentRep && currentRep.bandwidth) {
            const currentBitrate = currentRep.bandwidth / 1000;
            const resolution = currentRep.width ? `${currentRep.width}x${currentRep.height}` : 'Bilinmiyor';
            console.log(`Yeni kanal kalitesi: ${resolution} - ${currentBitrate.toFixed(2)} kbps`);
          }
        }
      });

      this.player.play();
    }
  }

  scrollToSelected(index: number) {
    if (this.menuContent) {
      const selectedElement = this.menuContent.nativeElement.querySelector(`li:nth-child(${index + 1})`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {

    event.preventDefault();

    if (event.key == "Enter") {
      if (this.isMenuOpen && this.selectedIndex != -1) {
        this.changeChannel(this.selectedIndex);
        this.isMenuOpen = false;
      } else if (this.player) {
        if (this.player.paused()) {
          this.player.play();
        } else {
          this.player.pause();
        }
      }
    }

    if (event.key == "Backspace") {
      this.isMenuOpen = !this.isMenuOpen;
      this.isQualitySelectorActive = false;
      if (this.isMenuOpen) {
        this.loadChannels();
        setTimeout(() => this.scrollToSelected(this.selectedIndex), 100);
      }
    }

    if (this.isMenuOpen) {

      switch (event.key) {
        case 'ArrowRight':
          this.isQualitySelectorActive = true;
          break;
        case 'ArrowLeft':
          this.isQualitySelectorActive = false;
          break;
      }


      if (this.isQualitySelectorActive) {

        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          this.selectedQualityIndex += event.key === 'ArrowUp' ? -1 : 1;
          this.selectedQualityIndex = Math.max(0, Math.min(this.selectedQualityIndex, this.availableQualities.length - 1));
          this.changeQualityById(this.availableQualities[this.selectedQualityIndex].id);
        }

      } else {

        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          this.selectedIndex += event.key === 'ArrowUp' ? -1 : 1;
          this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.channels.length - 1));
          this.scrollToSelected(this.selectedIndex);
        }

      }

    } else {

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        this.selectedIndex += event.key === 'ArrowUp' ? -1 : 1;
        this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.channels.length - 1));
        this.changeChannel(this.selectedIndex);
      }

    }

  }

  playVideo() {
    if (this.player) {
      this.player.play();
    }
  }

  changeQuality(event: Event) {
    const select = event.target as HTMLSelectElement;
    const qualityId = select.value;
    this.changeQualityById(qualityId);
  }

  changeQualityById(qualityId: string) {
    this.currentQuality = qualityId;
    this.selectedQualityIndex = this.availableQualities.findIndex(q => q.id === qualityId);

    const tech = this.player.tech({ IWillNotUseThisInPlugins: true });
    if (tech && tech.vhs) {
      if (qualityId === 'auto') {
        tech.vhs.representations().forEach((rep: any) => {
          rep.enabled(true);
        });
      } else {
        tech.vhs.representations().forEach((rep: any) => {
          rep.enabled(rep.id === qualityId);
        });
      }
    }
  }

  ngOnDestroy() {
    if (this.player) {
      this.player.dispose();
    }
  }
}
