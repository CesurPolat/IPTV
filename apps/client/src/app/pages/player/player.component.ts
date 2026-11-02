import { Component, HostListener, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import videojs from 'video.js';
import { NavigationService } from '../../services/navigation.service';
import { TvChannelsService } from '../../services/tv-channels.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './player.component.html',
  styleUrl: './player.component.scss'
})
export class PlayerComponent implements AfterViewInit, OnDestroy {

  player: any;
  isPlaying = false;
  currentTime = 0;
  duration = 0;
  showControls = true;
  nextEpisodeLoading = false;
  nextEpisodeError = '';
  private seriesUrl = '';
  private seasonNumber = 0;
  private episodeNumber = 0;
  private routeSubscription?: Subscription;
  private generation = 0;
  private destroyed = false;
  private currentUrl = '';
  private controlsTimeout?: any;

  constructor(
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute,
    private navService: NavigationService,
    private tvChannelsService: TvChannelsService,
    private router: Router
  ) {}

  ngAfterViewInit() {
    this.routeSubscription = this.route.queryParams.subscribe(params => {
      this.generation++;
      this.nextEpisodeLoading = false;
      this.nextEpisodeError = '';
      this.seriesUrl = params['series'] || '';
      this.seasonNumber = Number(params['season']) || 0;
      this.episodeNumber = Number(params['episode']) || 0;
      const url = params['url'];
      if (url) {
        this.initializePlayer(url);
      } else {
        // Parametre yoksa varsayılan video veya hata yönetimi
        this.initializePlayer("https://www.w3schools.com/html/mov_bbb.mp4");
      }
    });
    this.resetControlsTimer();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.generation++;
    this.routeSubscription?.unsubscribe();
    this.savePosition();
    if (this.player) {
      this.player.dispose();
    }
    if (this.controlsTimeout) {
      clearTimeout(this.controlsTimeout);
    }
  }

  async playNextEpisode() {
    if (this.destroyed || this.nextEpisodeLoading || !this.seriesUrl || !this.seasonNumber || !this.episodeNumber) return;
    const generation = this.generation;
    this.nextEpisodeLoading = true;
    this.nextEpisodeError = '';
    this.cdr.detectChanges();
    try {
      const detail = await this.tvChannelsService.getSeriesDetails(this.seriesUrl);
      if (this.destroyed || generation !== this.generation) return;
      if (!detail) throw new Error('Sonraki bölümün bilgileri alınamadı.');
      const seasons = Array.isArray(detail.containsSeason) ? detail.containsSeason : detail.containsSeason ? [detail.containsSeason] : [];
      const episodes = [...seasons].sort((a, b) => a.seasonNumber - b.seasonNumber).flatMap(season => {
        const items = Array.isArray(season.episode) ? season.episode : season.episode ? [season.episode] : [];
        return [...items].sort((a, b) => a.episodeNumber - b.episodeNumber)
          .map(episode => ({ ...episode, season: season.seasonNumber }));
      });
      const current = episodes.findIndex(e => e.season === this.seasonNumber && e.episodeNumber === this.episodeNumber);
      if (current < 0) throw new Error('Geçerli bölüm dizi listesinde bulunamadı.');
      const next = episodes[current + 1];
      if (!next) return;
      const url = await this.tvChannelsService.getVideoUrl(next.url);
      if (this.destroyed || generation !== this.generation) return;
      const navigated = await this.router.navigate(['/player'], { queryParams: {
        url, series: this.seriesUrl, season: next.season, episode: next.episodeNumber
      }, replaceUrl: true });
      if (!navigated && generation === this.generation) throw new Error('Sonraki bölüme geçilemedi.');
    } catch (error) {
      if (!this.destroyed && generation === this.generation) {
        this.nextEpisodeError = error instanceof Error ? error.message : 'Sonraki bölüm açılamadı.';
      }
    } finally {
      if (!this.destroyed && generation === this.generation) {
        this.nextEpisodeLoading = false;
        this.cdr.detectChanges();
      }
    }
  }

  @HostListener('window:beforeunload')
  savePosition() {
    if (this.player && this.currentUrl) {
      const currentTime = this.player.currentTime();
      if (typeof currentTime !== 'number' || !Number.isFinite(currentTime)) return;
      // Eğer videonun sonuna çok yakınsa (son 10 saniye), kaldığı yeri temizle ki baştan başlasın
      if (this.duration > 0 && this.duration - currentTime < 10) {
        localStorage.removeItem(`playback_pos_${this.currentUrl}`);
      } else {
        localStorage.setItem(`playback_pos_${this.currentUrl}`, currentTime.toString());
      }
    }
  }

  @HostListener('window:mousemove')
  @HostListener('window:touchstart')
  @HostListener('window:keydown')
  resetControlsTimer() {
    this.showControls = true;
    if (this.controlsTimeout) {
      clearTimeout(this.controlsTimeout);
    }
    this.controlsTimeout = setTimeout(() => {
      if (this.isPlaying) {
        this.showControls = false;
        this.cdr.detectChanges();
      }
    }, 3000); // 3 saniye sonra gizle
    this.cdr.detectChanges();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (event.key === 'Backspace' || event.key === 'Escape') {
      event.preventDefault();
      this.navService.back('/series');
      return;
    }
    if (!this.player) return;

    if ((event.target as HTMLElement | null)?.closest?.('button, input')) return;

    this.resetControlsTimer();

    /* if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace'].includes(event.key)) {
      event.preventDefault();
    } */

    switch (event.key) {
      case 'Enter':
        this.togglePlay();
        break;
      case 'ArrowRight':
        this.player.currentTime(this.player.currentTime() + 10);
        break;
      case 'ArrowLeft':
        this.player.currentTime(Math.max(0, this.player.currentTime() - 10));
        break;
    }
  }

  togglePlay() {
    if (!this.player) return;
    this.resetControlsTimer();
    if (this.player.paused()) {
      this.player.play();
    } else {
      this.player.pause();
    }
  }

  onSeek(event: any) {
    if (!this.player) return;
    this.resetControlsTimer();
    const value = event.target.value;
    this.player.currentTime(value);
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  private getVideoType(url: string): string {
    const extension = url.split('.').pop()?.split(/[?#]/)[0].toLowerCase();
    switch (extension) {
      case 'm3u8':
        return 'application/x-mpegURL';
      case 'mpd':
        return 'application/dash+xml';
      case 'mp4':
        return 'video/mp4';
      case 'webm':
        return 'video/webm';
      case 'ogg':
        return 'video/ogg';
      default:
        return 'video/mp4';
    }
  }

  initializePlayer(url: string) {
    if (this.player) {
      this.savePosition();
    }

    this.currentUrl = url;
    this.currentTime = 0;
    this.duration = 0;
    this.isPlaying = false;
    const type = this.getVideoType(url);

    if (this.player) {
      // Reuse the video element: dispose() removes it from the DOM.
      this.player.autoplay(true);
      this.player.src({ src: url, type });
      return;
    }

    this.player = videojs('my-video', {
      controls: false,
      fluid: false,
      fill: true,
      autoplay: true,
      responsive: true,
      sources: [{
        src: url,
        type: type
      }]
    });

    this.player.on('play', () => {
      this.isPlaying = true;
      this.cdr.detectChanges();
    });
    this.player.on('ended', () => {
      this.isPlaying = false;
      this.savePosition();
      void this.playNextEpisode();
    });
    this.player.on('pause', () => {
      this.isPlaying = false;
      this.cdr.detectChanges();
    });
    this.player.on('timeupdate', () => {
      this.currentTime = this.player.currentTime();
      this.cdr.detectChanges();
    });
    this.player.on('loadedmetadata', () => {
      this.duration = this.player.duration();
      const savedPos = localStorage.getItem(`playback_pos_${this.currentUrl}`);
      if (savedPos) {
        this.player.currentTime(parseFloat(savedPos));
      }
      this.cdr.detectChanges();
    });
  }
}
