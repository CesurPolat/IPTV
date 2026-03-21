import { Component, OnInit, HostListener, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { TvChannelsService, Channel } from '../../services/tv-channels.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ArchillectTvComponent } from '../../components/archillect-tv/archillect-tv.component';



interface Quality {
  id: string;
  label: string;
  width?: number;
  height?: number;
  bandwidth?: number;
}

@Component({
  selector: 'app-tv',
  standalone: true,
  imports: [CommonModule, ArchillectTvComponent],
  templateUrl: './tv.component.html',
  styleUrl: './tv.component.scss'
})
export class TvComponent implements OnInit, OnDestroy {
  @ViewChild('menuContent') menuContent!: ElementRef;

  title = 'IPTV';
  player: any;
  isMenuOpen = false;
  currentChannelIndex: number = -1;
  selectedIndex: number = -1;
  showPlayIcon = false;
  channels: Channel[] = [];
  availableQualities: Quality[] = [];
  currentQuality: string = 'auto';
  selectedQualityIndex: number = 0;
  isAdPlaying: boolean = false;
  isArchillectTvEnabled: boolean = true;
  isChannelAutoSwitchEnabled: boolean = false;
  showChannelInfo: boolean = false;
  showPlayerControls: boolean = true;
  isQualityPanelActive: boolean = false;
  private controlsHideTimeout: any;
  private infoTimeout: any;

  constructor(
    private tvChannelsService: TvChannelsService,
    private activatedRoute: ActivatedRoute,
    private router: Router
  ) { }

  ngOnInit() {
    this.isArchillectTvEnabled = this.readArchillectSetting();
    this.isChannelAutoSwitchEnabled = this.readChannelAutoSwitchSetting();
    this.fetchChannels();

  }

  private readArchillectSetting(): boolean {
    try {
      const stored = localStorage.getItem('archillectTvEnabled');
      if (stored === null) {
        return true;
      }
      return stored === 'true';
    } catch {
      return true;
    }
  }

  private readChannelAutoSwitchSetting(): boolean {
    try {
      const stored = localStorage.getItem('channelAutoSwitchEnabled');
      if (stored === null) {
        return false;
      }
      return stored === 'true';
    } catch {
      return false;
    }
  }

  fetchChannels() {

    console.log('[TV] Kanal listesi yükleniyor...');
    this.tvChannelsService.loadChannels().subscribe({
      next: (data) => {
        this.channels = data.filter(item => item.category == 'TVChannel');
        console.log('[TV] Kanal listesi yüklendi:', this.channels.length, 'kanal bulundu.');
        if (this.channels.length > 0 && !this.player) {
          this.activatedRoute.params.subscribe(params => {
            const id: number = parseInt(params['id']);
            this.currentChannelIndex = id;
            this.selectedIndex = id;
            this.initializePlayer();
          });

        }
      },
      error: (error) => {
        console.error('Kanal listesi yüklenirken hata oluştu:', error.toString());
      }
    });
  }

  initializePlayer() {
    if (this.channels.length === 0) return;

    this.player = videojs('my-video', {
      controls: false,
      fluid: true,
      sources: [{
        src: this.channels[this.currentChannelIndex].source,
        type: 'application/x-mpegURL'
      }]
    });

    this.scrollToSelected(this.currentChannelIndex);

    this.player.on('play', () => {
      this.showPlayIcon = false;
      this.showControlsTemporarily();
    });

    // Oynatılan segment (TS) dosyalarını kontrol et
    this.player.on('timeupdate', () => {
      const vhs = (this.player as any).tech(true).vhs;
      const media = vhs?.playlists?.media();

      if (media && media.segments) {
        const currentTime = this.player.currentTime();

        const currentSegment = media.segments.find((seg: { start: number; duration: any; }) =>
          currentTime >= seg.start && currentTime < (seg.start + seg.duration)
        );

        if (currentSegment && currentSegment.resolvedUri) {
          const uri = currentSegment.resolvedUri;
          const currentChannel = this.channels[this.currentChannelIndex];

          if (currentChannel?.adsRegex) {
            const regex = new RegExp(currentChannel.adsRegex);
            const isAd = regex.test(uri);

            // --- ATALAMA MANTIĞI BURADA BAŞLIYOR ---
            if (isAd) {
              // Playlist içinde reklam OLMAYAN bir sonraki segmenti ara
              const nextCleanSegment = media.segments.find((seg: any) =>
                seg.start > currentTime && !regex.test(seg.resolvedUri)
              );

              if (nextCleanSegment) {
                console.log('Reklam tespit edildi, temiz segmente atlanıyor:', nextCleanSegment.start);
                this.player.currentTime(nextCleanSegment.start);
                return; // Atladığımız için bu cycle'ı burada bitiriyoruz
              }
            }
            // --- ATALAMA MANTIĞI BURADA BİTİYOR ---

            const shouldUseArchillect = this.isArchillectTvEnabled && isAd;

            if (this.isAdPlaying !== shouldUseArchillect) {
              this.isAdPlaying = shouldUseArchillect;
              this.player.muted(shouldUseArchillect);
              console.log(shouldUseArchillect ? 'ARCHILLECT TV AKTIF' : 'ARCHILLECT TV PASIF');
            }

            console.log('Oynatılan Segment URI:', uri, ' - Reklam mı?:', isAd, ' - Archillect aktif mi?:', shouldUseArchillect);
          }
        }
      }
    });

    this.player.on('pause', () => {
      this.showPlayIcon = true;
      this.showPlayerControls = true;
      this.clearControlsHideTimeout();
    });

    this.player.play().catch(() => {
      this.showPlayIcon = true;
    });

    this.triggerChannelInfo();

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
            //console.log(rep.playlist.id);

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

      this.currentChannelIndex = index;

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
      this.showControlsTemporarily();
      this.triggerChannelInfo();
    }
  }

  private clearControlsHideTimeout() {
    if (this.controlsHideTimeout) {
      clearTimeout(this.controlsHideTimeout);
      this.controlsHideTimeout = null;
    }
  }

  private scheduleControlsAutoHide() {
    this.clearControlsHideTimeout();

    if (this.isAdPlaying || this.isMenuOpen || this.isQualityPanelActive || !this.player || this.player.paused()) {
      this.showPlayerControls = true;
      return;
    }

    this.controlsHideTimeout = setTimeout(() => {
      this.showPlayerControls = false;
    }, 3000);
  }

  showControlsTemporarily() {
    this.showPlayerControls = true;
    this.scheduleControlsAutoHide();
  }

  triggerChannelInfo() {
    this.showChannelInfo = true;
    if (this.infoTimeout) {
      clearTimeout(this.infoTimeout);
    }
    this.infoTimeout = setTimeout(() => {
      this.showChannelInfo = false;
    }, 5000); // 5 saniye sonra gizle
  }

  scrollToSelected(index: number) {
    if (this.menuContent) {
      const selectedElement = this.menuContent.nativeElement.querySelector(`li:nth-child(${index + 1})`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {

    event.preventDefault();
    this.showControlsTemporarily();

    if (event.key == "Enter") {
      if (this.isMenuOpen && this.selectedIndex != -1) {
        this.changeChannel(this.selectedIndex);
        this.isMenuOpen = false;
        this.showControlsTemporarily();
      } else if (this.player && !this.isAdPlaying) {
        if (this.player.paused()) {
          this.player.play();
        } else {
          this.player.pause();
        }
      }
    }

    if (event.key == "Backspace") {
      this.router.navigate(['/home']);
      return;
    }

    if (this.isMenuOpen) {

      if (event.key === 'ArrowUp') {
        this.isMenuOpen = false;
        this.isQualityPanelActive = false;
        this.scheduleControlsAutoHide();
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const previousIndex = this.selectedIndex;
        this.selectedIndex += event.key === 'ArrowLeft' ? -1 : 1;
        this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.channels.length - 1));
        this.scrollToSelected(this.selectedIndex);

        if (this.isChannelAutoSwitchEnabled && this.selectedIndex !== previousIndex) {
          this.changeChannel(this.selectedIndex);
        }
        return;
      }

      if (event.key === 'ArrowDown') {
        return;
      }

    } else {

      if (event.key === 'ArrowUp') {
        this.isQualityPanelActive = !this.isQualityPanelActive;
        if (this.isQualityPanelActive) {
          this.showPlayerControls = true;
          this.clearControlsHideTimeout();
        } else {
          this.scheduleControlsAutoHide();
        }
        return;
      }

      if ((event.key === '+' || event.key === '=') || (this.isQualityPanelActive && event.key === 'ArrowRight')) {
        this.cycleQuality(1);
        return;
      }

      if ((event.key === '-' || event.key === '_') || (this.isQualityPanelActive && event.key === 'ArrowLeft')) {
        this.cycleQuality(-1);
        return;
      }

      if (event.key === 'ArrowDown') {
        this.isMenuOpen = true;
        this.isQualityPanelActive = false;
        this.fetchChannels();
        this.selectedIndex = this.currentChannelIndex;
        setTimeout(() => this.scrollToSelected(this.currentChannelIndex), 100);
        this.showPlayerControls = true;
        this.clearControlsHideTimeout();
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        return;
      }

    }

  }

  playVideo() {
    if (this.player) {
      this.player.play();
      this.showControlsTemporarily();
    }
  }

  togglePlayPause() {
    if (!this.player || this.isAdPlaying) {
      return;
    }

    if (this.player.paused()) {
      this.player.play();
      this.showControlsTemporarily();
      return;
    }

    this.player.pause();
    this.showPlayerControls = true;
    this.clearControlsHideTimeout();
  }

  cycleQuality(step: number) {
    if (!this.availableQualities.length) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(this.selectedQualityIndex + step, this.availableQualities.length - 1));
    if (nextIndex === this.selectedQualityIndex) {
      return;
    }

    this.changeQualityById(this.availableQualities[nextIndex].id);
    this.showControlsTemporarily();
  }

  get isPlayerPaused(): boolean {
    return !this.player || this.player.paused();
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
    this.clearControlsHideTimeout();
  }
}
