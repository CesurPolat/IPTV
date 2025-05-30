import { Component, OnInit, HostListener, ViewChild, ElementRef } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';


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
  
  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadChannels();
    this.initializePlayer();

    Updater.echo({ value: 'Capacitor Web Updater is ready!' });

    var version = "0.1.4"; // Uygulamanızın mevcut sürümünü buraya girin

    Updater.isLatestVersion({value: version}).then((result) => {
      if (!result.value) {
        console.log('Yeni bir güncelleme mevcut:', result.value);
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
    this.http.get<Channel[]>('https://advanced-storage.online/iptv/GetAll')
      .subscribe({
        next: (data) => {
          this.channels = data;
          if (this.channels.length > 0) {
            this.initializePlayer();
          }
        },
        error: (error) => {
          console.error('Kanal listesi yüklenirken hata oluştu:', error);
        }
      });
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

    this.player.on('play', () => {
      this.showPlayIcon = false;
    });

    this.player.on('pause', () => {
      this.showPlayIcon = true;
    });

    // Bit hızlarını logla ve kalite seçeneklerini güncelle
    this.player.on('loadedmetadata', () => {
      const tech = this.player.tech({ IWillNotUseThisInPlugins: true });
      if (tech && tech.vhs) {
        const representations = tech.vhs.representations();
        console.log('Mevcut Bit Hızları:');
        
        // Kalite seçeneklerini güncelle
        this.availableQualities = [
          { id: 'auto', label: 'Otomatik' },
          ...representations.map((rep: any) => {
            if (rep.bandwidth) {
              const bitrate = rep.bandwidth / 1000;
              const resolution = rep.width ? `${rep.width}x${rep.height}` : 'Bilinmiyor';
              console.log(`Kalite: ${resolution} - ${bitrate.toFixed(2)} kbps`);
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

    this.selectedIndex = 0;
    this.player.play().catch(() => {
      this.showPlayIcon = true;
    });

    // Capacitor back button listener'ı ekle
    CapacitorApp.addListener('backButton', () => {
      // Backspace tuşuna basılmış gibi davran
      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      this.onBackspacePress(event);
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

  scrollToSelected() {
    if (this.menuContent) {
      const selectedElement = this.menuContent.nativeElement.querySelector(`li:nth-child(${this.selectedIndex + 1})`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  @HostListener('document:keydown.enter', ['$event'])
  onEnterPress(event: KeyboardEvent) {
    if (this.isMenuOpen && this.selectedIndex >= 0) {
      this.changeChannel(this.selectedIndex);
      this.isMenuOpen = false;
      this.selectedIndex = -1;
    } else if (this.player) {
      if (this.player.paused()) {
        this.player.play();
      } else {
        this.player.pause();
      }
    }
  }

  @HostListener('document:keydown.backspace', ['$event'])
  onBackspacePress(event: KeyboardEvent) {
    event.preventDefault();
    this.isMenuOpen = !this.isMenuOpen;
    this.isQualitySelectorActive = false;
    if (this.isMenuOpen) {
      const currentUrl = this.player.currentSrc();
      const currentChannelIndex = this.channels.findIndex(channel => channel.source === currentUrl);
      this.selectedIndex = currentChannelIndex >= 0 ? currentChannelIndex : 0;
      setTimeout(() => this.scrollToSelected(), 100);
    } else {
      this.selectedIndex = -1;
    }
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (this.isMenuOpen) {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.isQualitySelectorActive = true;
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.isQualitySelectorActive = false;
      } else if (this.isQualitySelectorActive) {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (this.selectedQualityIndex > 0) {
            this.selectedQualityIndex--;
            this.changeQualityById(this.availableQualities[this.selectedQualityIndex].id);
          }
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (this.selectedQualityIndex < this.availableQualities.length - 1) {
            this.selectedQualityIndex++;
            this.changeQualityById(this.availableQualities[this.selectedQualityIndex].id);
          }
        }
      } else {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (this.selectedIndex > 0) {
            this.selectedIndex--;
            this.scrollToSelected();
          }
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (this.selectedIndex < this.channels.length - 1) {
            this.selectedIndex++;
            this.scrollToSelected();
          }
        }
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
