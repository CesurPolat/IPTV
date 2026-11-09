import { Component, HostListener, AfterViewInit, OnDestroy, ChangeDetectorRef, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import videojs from 'video.js';
import Hls from 'hls.js';
import { NavigationService } from '../../services/navigation.service';
import { TvChannelsService } from '../../services/tv-channels.service';
import { Subscription } from 'rxjs';
import { SeriesProgressService } from '../../services/series-progress.service';

type HlsResponseHook = (request: { uri?: string; url?: string; status?: number; aborted?: boolean },
  error: unknown, response?: { statusCode?: number; status?: number }) => void;
type HlsXhr = { onResponse: (hook: HlsResponseHook) => void; offResponse: (hook: HlsResponseHook) => void };
type AudioTrack = { language?: string; label?: string; enabled: boolean };
type AudioTrackList = ArrayLike<AudioTrack> & {
  addEventListener(name: string, listener: () => void): void;
  removeEventListener(name: string, listener: () => void): void;
};

@Component({
  selector: 'app-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './player.component.html',
  styleUrl: './player.component.scss'
})
export class PlayerComponent implements AfterViewInit, OnDestroy {

  @ViewChild('sourceControl') private sourceControl?: ElementRef<HTMLElement>;

  player: any;
  isPlaying = false;
  currentTime = 0;
  duration = 0;
  showControls = true;
  nextEpisodeLoading = false;
  nextEpisodeError = '';
  sourceLoading = false;
  sourceError = '';
  audioGroups: string[] = [];
  selectedAudioGroup = '';
  audioTracks: { id: number; label: string }[] = [];
  selectedAudioTrack = -1;
  audioError = '';
  private manualAudioTrack = false;
  private audioTrackList?: AudioTrackList;
  private readonly audioTrackListener = () => this.refreshAudioTracks();
  private manualSource = false;
  private selectedSource?: number;
  private sourceAttempts = 0;
  private playbackProgress = 0;
  private hasPlayedVideo = false;
  private hls?: Hls;
  private resumeAfterSwitch?: number;
  private stallTimeout?: ReturnType<typeof setTimeout>;
  private playbackWanted = true;
  private playbackParams: Record<string, any> = {};
  private hlsXhr?: HlsXhr;
  private hlsResponseHook?: HlsResponseHook;
  seriesName = '';
  private seriesImage = '';
  private episodeCompleted = false;
  private lastProgressSave = 0;
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
    private router: Router,
    private progress: SeriesProgressService,
    private host: ElementRef<HTMLElement>
  ) {}

  ngAfterViewInit() {
    this.routeSubscription = this.route.queryParams.subscribe(params => {
      const oldEpisode = `${this.seriesUrl}:${this.seasonNumber}:${this.episodeNumber}`;
      const oldSession = this.currentUrl.match(/\/Shortizle\/([a-f0-9]{32})\//i)?.[1];
      const newSession = String(params['url'] || '').match(/\/Shortizle\/([a-f0-9]{32})\//i)?.[1];
      if (this.player && !this.episodeCompleted) this.savePosition();
      this.clearStallTimer();
      this.generation++;
      this.nextEpisodeLoading = false;
      this.nextEpisodeError = '';
      this.seriesUrl = params['series'] || '';
      this.seriesName = params['seriesName'] || '';
      this.seriesImage = params['seriesImage'] || '';
      this.episodeCompleted = false;
      this.lastProgressSave = 0;
      this.seasonNumber = Number(params['season']) || 0;
      this.episodeNumber = Number(params['episode']) || 0;
      this.playbackParams = params;
      this.sourceLoading = false;
      this.sourceError = '';
      if (oldEpisode !== `${this.seriesUrl}:${this.seasonNumber}:${this.episodeNumber}` || oldSession !== newSession) {
        this.manualSource = false;
        this.selectedSource = undefined;
        this.sourceAttempts = 0;
        this.resumeAfterSwitch = undefined;
      }
      const url = params['url'];
      if (params['manualSource'] === '1') {
        this.manualSource = true;
        const selected = Number(params['selectedSource']);
        if (Number.isSafeInteger(selected) && selected > 0) this.selectedSource = selected;
      }
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
    this.detachAudioTracks();
    this.hls?.destroy();
    this.hls = undefined;
    this.detachHlsResponseHook();
    this.clearStallTimer();
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
    if (this.destroyed || this.sourceLoading || this.nextEpisodeLoading || !this.seriesUrl || !this.seasonNumber || !this.episodeNumber) return;
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
      if (!next) { if (this.episodeCompleted) this.progress.remove(this.seriesUrl); return; }
      if (this.episodeCompleted && this.seriesName) this.progress.save({ series: this.seriesUrl, name: this.seriesName, image: this.seriesImage, season: next.season, episode: next.episodeNumber, position: 0, updatedAt: Date.now(), ...(this.manualSource && this.sourceNumber ? { source: this.sourceNumber } : {}) });
      let url = await this.tvChannelsService.getVideoUrl(next.url);
      if (this.destroyed || generation !== this.generation) return;
      if (this.manualSource && this.sourceNumber) url = await this.tvChannelsService.getAlternativeSource(url, this.sourceNumber);
      if (this.destroyed || generation !== this.generation) return;
      const navigated = await this.router.navigate(['/player'], { queryParams: {
        url, series: this.seriesUrl, season: next.season, episode: next.episodeNumber,
        ...(this.seriesName ? { seriesName: this.seriesName, seriesImage: this.seriesImage } : {}),
        ...(this.manualSource && this.sourceNumber ? { manualSource: '1', selectedSource: this.sourceNumber } : {})
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

  get seasonNumberLabel(): string { return `${this.seasonNumber}. Sezon ${this.episodeNumber}. Bölüm`; }

  get canPlayNextEpisode(): boolean { return !!(this.seriesUrl && this.seasonNumber && this.episodeNumber); }

  get isFiniteDuration(): boolean { return Number.isFinite(this.duration) && this.duration > 0; }

  get progressPercent(): number {
    return this.isFiniteDuration ? Math.min(100, Math.max(0, this.currentTime / this.duration * 100)) : 0;
  }

  get selectedAudioTrackLabel(): string {
    return this.audioTracks.find(track => track.id === this.selectedAudioTrack)?.label || 'Otomatik';
  }

  get selectorFocused(): boolean {
    return document.activeElement instanceof HTMLElement && !!document.activeElement.closest('.option-selector');
  }

  get controlFocused(): boolean {
    return document.activeElement instanceof HTMLElement && !!document.activeElement.closest('[data-player-control]');
  }

  goBack() { this.navService.back('/series'); }

  get sourceNumber(): number | null {
    if (!this.isShortizleSource()) return null;
    if (this.selectedSource) return this.selectedSource;
    const selected = Number(new URL(this.currentUrl, window.location.origin).searchParams.get('source'));
    if (Number.isSafeInteger(selected) && selected > 0) return selected;
    const revision = Number(new URL(this.currentUrl, window.location.origin).searchParams.get('revision') || 0);
    return Number.isSafeInteger(revision) && revision >= 0 && revision < Number.MAX_SAFE_INTEGER ? revision + 1 : 1;
  }

  private isShortizleSource() {
    try { return /\/Streaming\/Shortizle\/[a-f0-9]{32}\/(?:master\.m3u8|media\.mp4)$/i.test(new URL(this.currentUrl, window.location.origin).pathname); }
    catch { return false; }
  }

  private detachHlsResponseHook() {
    if (this.hlsXhr && this.hlsResponseHook) this.hlsXhr.offResponse(this.hlsResponseHook);
    this.hlsXhr = undefined;
    this.hlsResponseHook = undefined;
  }

  private attachHlsResponseHook() {
    if (!this.isShortizleSource() || this.getVideoType(this.currentUrl) !== 'application/x-mpegURL' || this.destroyed) return;
    const xhr = this.player?.tech?.(true)?.vhs?.xhr as HlsXhr | undefined;
    if (!xhr?.onResponse || xhr === this.hlsXhr) return;
    this.detachHlsResponseHook();
    const generation = this.generation;
    const master = new URL(this.currentUrl, window.location.origin);
    const basePath = master.pathname.slice(0, -'master.m3u8'.length);
    this.hlsXhr = xhr;
    this.hlsResponseHook = (request, error, response) => {
      if (this.destroyed || generation !== this.generation || request.aborted) return;
      const status = response?.statusCode ?? response?.status ?? request.status ?? 0;
      if (!error && status < 400) return;
      const uri = request.uri || request.url;
      if (!uri) return;
      try {
        const failed = new URL(uri, master);
        if (failed.origin !== master.origin ||
            !(failed.pathname === master.pathname || failed.pathname.startsWith(basePath + 'resource/'))) return;
      } catch { return; }
      // A failed subtitle, alternate rendition or retried segment need not stop playback.
      // Once video has started, allow VHS to recover and switch only if progress stops.
      if (this.hasPlayedVideo && !this.player?.error?.()) this.watchForStall();
      else void this.recoverSource();
    };
    xhr.onResponse(this.hlsResponseHook);
  }

  private clearStallTimer() {
    if (this.stallTimeout) clearTimeout(this.stallTimeout);
    this.stallTimeout = undefined;
  }

  private confirmPlayback() {
    if (this.player?.error?.()) return;
    if (this.isShortizleSource() && !this.hasVideoFrame()) {
      this.watchForStall();
      return;
    }
    this.playbackProgress++;
    this.hasPlayedVideo = true;
    this.sourceError = '';
    this.isPlaying = true;
    this.clearStallTimer();
  }

  private hasVideoFrame(): boolean {
    const video = this.player?.tech?.(true)?.el?.() as HTMLVideoElement | undefined;
    const width = this.player?.videoWidth?.() ?? video?.videoWidth ?? 0;
    const height = this.player?.videoHeight?.() ?? video?.videoHeight ?? 0;
    if (width <= 0 || height <= 0) return false;
    const frames = video?.getVideoPlaybackQuality?.().totalVideoFrames;
    if (typeof frames === 'number') return frames > 0;
    return true;
  }

  watchForStall() {
    if (this.stallTimeout || this.sourceLoading || this.sourceError || this.destroyed || !this.playbackWanted || !this.isShortizleSource()) return;
    this.stallTimeout = setTimeout(() => {
      this.stallTimeout = undefined;
      if (this.player?.paused?.() && (this.player?.readyState?.() ?? 0) >= 2) return;
      if (!document.hidden && this.playbackWanted && !this.player?.ended?.()) void this.recoverSource();
    }, 20000);
  }

  async changeSource(direction = 1) {
    if (this.sourceLoading || this.nextEpisodeLoading || !this.isShortizleSource()) return;
    const number = (this.sourceNumber || 1) + direction;
    if (number < 1) return;
    this.manualSource = true;
    this.selectedSource = number;
    this.player?.pause?.();
    this.resetControlsTimer();
    await this.recoverSource(true);
  }

  async recoverSource(manual = false) {
    if (this.destroyed || (!manual && (!this.playbackWanted || this.sourceError)) || this.sourceLoading || this.nextEpisodeLoading || !this.isShortizleSource()) return;
    if (!manual && this.manualSource) {
      this.clearStallTimer();
      this.sourceError = 'Seçilen kaynak oynatılamadı. Sol/sağ ok ile başka bir kaynak seçebilirsiniz.';
      this.cdr.detectChanges();
      return;
    }
    this.clearStallTimer();
    if (!manual && this.sourceAttempts >= 3) {
      this.sourceError = 'Kaynaklar kullanılamıyor. Bölüm listesinden tekrar açabilirsiniz.';
      this.cdr.detectChanges(); return;
    }
    const generation = this.generation;
    const progress = this.playbackProgress;
    const time = this.player?.currentTime?.();
    const position = Math.max(this.resumeAfterSwitch || 0, this.currentTime || 0, typeof time === 'number' && Number.isFinite(time) ? time : 0);
    if (manual) this.sourceAttempts = 0;
    else this.sourceAttempts++;
    this.sourceLoading = true;
    this.sourceError = '';
    this.cdr.detectChanges();
    try {
      const url = manual
        ? await this.tvChannelsService.getAlternativeSource(this.currentUrl, this.selectedSource)
        : await this.tvChannelsService.getAlternativeSource(this.currentUrl);
      if (this.destroyed || generation !== this.generation) return;
      if (!manual && progress !== this.playbackProgress) return;
      this.resumeAfterSwitch = position;
      const navigated = await this.router.navigate(['/player'], { queryParams: {
        ...this.playbackParams, url, ...(manual ? { manualSource: '1', selectedSource: this.selectedSource } : {})
      }, replaceUrl: true });
      if (!navigated) throw new Error('Alternatif kaynağa geçilemedi.');
    } catch (error) {
      if (!this.destroyed && generation === this.generation && (manual || progress === this.playbackProgress))
        this.sourceError = error instanceof Error ? error.message : 'Kaynak değiştirilemedi.';
    } finally {
      if (!this.destroyed && generation === this.generation) { this.sourceLoading = false; this.cdr.detectChanges(); }
    }
  }

  @HostListener('window:beforeunload')
  savePosition() {
    if (this.player && this.currentUrl) {
      const currentTime = this.player.currentTime();
      if (typeof currentTime !== 'number' || !Number.isFinite(currentTime)) return;
      if (!this.episodeCompleted && this.seriesUrl && this.seriesName && this.seasonNumber && this.episodeNumber) {
        const previous = this.progress.get(this.seriesUrl);
        const position = this.resumeAfterSwitch ?? (currentTime === 0 && !this.hasPlayedVideo && previous?.season === this.seasonNumber && previous.episode === this.episodeNumber ? previous.position : currentTime);
        this.progress.save({ series: this.seriesUrl, name: this.seriesName, image: this.seriesImage, season: this.seasonNumber, episode: this.episodeNumber, position, updatedAt: Date.now(), ...(this.manualSource && this.sourceNumber ? { source: this.sourceNumber } : {}) });
      }
      try {
      // Eğer videonun sonuna çok yakınsa (son 10 saniye), kaldığı yeri temizle ki baştan başlasın
      if (this.duration > 0 && this.duration - currentTime < 10) {
        localStorage.removeItem(`playback_pos_${this.currentUrl}`);
      } else {
        localStorage.setItem(`playback_pos_${this.currentUrl}`, currentTime.toString());
      }
      } catch { /* Storage is optional. */ }
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
      if (this.isPlaying && !this.selectorFocused && !this.sourceLoading && !this.nextEpisodeLoading) {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && this.host.nativeElement.contains(focused)) focused.blur();
        this.showControls = false;
        this.cdr.detectChanges();
      }
    }, 3000);
    this.cdr.detectChanges();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // Native selects own their arrow/Enter/Escape keys, including on TV remotes.
    if (event.target instanceof HTMLElement && event.target.closest('select')) return;
    if (event.key === 'Backspace' || event.key === 'Escape') {
      event.preventDefault();
      this.goBack();
      return;
    }
    if (!this.player) return;

    const target = event.target instanceof HTMLElement ? event.target : null;
    const selector = target?.closest<HTMLElement>('.option-selector');
    if (selector) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
        if (event.key === 'Enter' && target?.closest('button')) return;
        event.preventDefault();
        this.resetControlsTimer();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const controls = this.controlRowElements();
          const index = controls.indexOf(selector);
          const next = controls[index + (event.key === 'ArrowDown' ? 1 : -1)];
          if (event.key === 'ArrowUp' && !next?.matches('.option-selector')) this.focusControl('seek', 'play');
          else if (next) next.focus();
          else target?.blur();
        }
        else if (!event.repeat) {
          const direction = event.key === 'ArrowLeft' ? -1 : 1;
          switch (selector.dataset['playerControl']) {
            case 'source': void this.changeSource(direction); break;
            case 'audio-group': this.cycleAudioGroup(direction); break;
            case 'audio-track': this.cycleAudioTrack(direction); break;
          }
        }
      }
      return;
    }
    const control = target?.closest<HTMLElement>('[data-player-control]');
    if (control && event.key.startsWith('Arrow')) {
      const name = control.dataset['playerControl'];
      if (name === 'seek' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      this.resetControlsTimer();
      if (event.key === 'ArrowUp') this.focusControl(name === 'seek' ? 'back' : 'seek', 'back');
      else if (event.key === 'ArrowDown') {
        if (name === 'seek' || name === 'back') this.focusControl('play');
        else control.blur();
      } else {
        const controls = this.controlRowElements();
        const index = controls.indexOf(control);
        const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
        controls[Math.min(controls.length - 1, Math.max(0, next))]?.focus();
      }
      return;
    }
    const sourceControl = this.sourceControl?.nativeElement;
    if (event.key === 'ArrowUp' && sourceControl) {
      event.preventDefault();
      this.resetControlsTimer();
      sourceControl.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.focusControl('play');
      return;
    }

    if (target?.closest('button, input, select')) return;

    this.resetControlsTimer();

    if (['ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) {
      event.preventDefault();
    }

    switch (event.key) {
      case 'Enter':
        this.togglePlay();
        break;
      case 'ArrowRight':
        this.seekBy(10);
        break;
      case 'ArrowLeft':
        this.seekBy(-10);
        break;
    }
  }

  private focusControl(name: string, fallback?: string) {
    const target = this.host.nativeElement.querySelector<HTMLElement>(`[data-player-control="${name}"]:not(:disabled)`);
    if (target) target.focus();
    else if (fallback) this.focusControl(fallback);
  }

  private controlRowElements(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.control-row [data-player-control]'))
      .filter(element => !element.matches(':disabled'));
  }

  seekBy(seconds: number) {
    if (!this.player) return;
    this.resetControlsTimer();
    const playbackTime = Number(this.player.currentTime());
    const time = Number.isFinite(playbackTime) ? playbackTime : 0;
    this.currentTime = Math.min(this.isFiniteDuration ? this.duration : Infinity, Math.max(0, time + seconds));
    this.player.currentTime(this.currentTime);
  }

  togglePlay() {
    if (!this.player) return;
    this.resetControlsTimer();
    if (this.player.paused()) {
      this.playbackWanted = true;
      this.player.play();
    } else {
      this.playbackWanted = false;
      this.clearStallTimer();
      this.player.pause();
    }
  }

  onSeek(event: any) {
    if (!this.player) return;
    this.resetControlsTimer();
    const value = event.target.value;
    this.currentTime = Number(value);
    this.player.currentTime(value);
  }

  formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
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
    this.detachAudioTracks();
    this.audioGroups = [];
    this.selectedAudioGroup = '';
    this.audioTracks = [];
    this.selectedAudioTrack = -1;
    this.manualAudioTrack = false;
    this.audioError = '';
    this.hls?.destroy();
    this.hls = undefined;
    this.detachHlsResponseHook();
    this.currentUrl = url;
    if (this.isShortizleSource()) void this.loadAudioGroups(url);
    this.hasPlayedVideo = false;
    this.playbackWanted = true;
    this.currentTime = 0;
    this.duration = 0;
    this.isPlaying = false;
    const type = this.getVideoType(url);
    if (type === 'application/x-mpegURL') {
      console.info('[Player] Master m3u8:', url);
    }

    if (this.player) {
      // Reuse the video element: dispose() removes it from the DOM.
      this.player.autoplay(true);
      if (!this.startShortizleHls(url)) this.player.src({ src: url, type });
      this.bindAudioTracks();
      this.attachHlsResponseHook();
      this.watchForStall();
      return;
    }

    this.player = this.createPlayer();
    this.player.on('xhr-hooks-ready', () => this.attachHlsResponseHook());

    this.player.on('play', () => {
      this.playbackWanted = true;
      this.isPlaying = true;
      this.cdr.detectChanges();
    });
    this.player.on('ended', () => {
      this.clearStallTimer();
      if (this.player.error?.()) return;
      this.isPlaying = false;
      this.episodeCompleted = true;
      this.savePosition();
      void this.playNextEpisode();
    });
    this.player.on('pause', () => {
      this.isPlaying = false;
      this.cdr.detectChanges();
    });
    this.player.on('timeupdate', () => {
      const time = this.player.currentTime();
      if (time > this.currentTime && !this.player.paused() && !this.player.seeking?.() && !this.player.error?.()) this.confirmPlayback();
      this.currentTime = time;
      if (Date.now() - this.lastProgressSave >= 5000 && time > 0 && !this.player.seeking?.()) { this.savePosition(); this.lastProgressSave = Date.now(); }
      this.cdr.detectChanges();
    });
    this.player.on('loadedmetadata', () => {
      this.bindAudioTracks();
      this.duration = this.player.duration();
      const saved = this.progress.get(this.seriesUrl);
      let legacyPosition = 0;
      try { legacyPosition = Number(localStorage.getItem(`playback_pos_${this.currentUrl}`)); } catch { /* Storage is optional. */ }
      const savedPos = this.resumeAfterSwitch ?? (saved && saved.season === this.seasonNumber && saved.episode === this.episodeNumber ? saved.position : legacyPosition);
      this.resumeAfterSwitch = undefined;
      if (Number.isFinite(savedPos) && savedPos > 0) {
        this.player.currentTime(Number.isFinite(this.duration) ? Math.min(savedPos, Math.max(0, this.duration - 1)) : savedPos);
      }
      this.cdr.detectChanges();
    });
    this.player.on('waiting', () => this.watchForStall());
    this.player.on('stalled', () => this.watchForStall());
    this.player.on('playing', () => { this.confirmPlayback(); this.cdr.detectChanges(); });
    this.player.on('error', () => {
      const error = this.player.error?.();
      console.warn('[Player] Kaynak oynatılamıyor:', { code: error?.code, message: error?.message, master: this.currentUrl });
      // HLS.js handles its own retries and reports fatal errors separately.
      if (!this.hls) void this.recoverSource();
    });
    // Register the VHS request hook before the first master/child request starts.
    if (!this.startShortizleHls(url)) this.player.src({ src: url, type });
    this.bindAudioTracks();
    this.attachHlsResponseHook();
    this.watchForStall();
  }

  private createHls() {
    // Keep the full 1.6.16 build: Shortizle uses HEVC TS as well as AES-CBC
    // init ranges whose lengths include PKCS7 padding (different in 1.7).
    return new Hls({ enableWorker: true, maxBufferLength: 30 });
  }

  audioGroupLabel(group: string): string {
    return group === 'dublaj' ? 'Türkçe dublaj' : group === 'altyazi' ? 'Orijinal / altyazılı' : 'Orijinal';
  }

  cycleAudioGroup(direction: number) {
    if (!this.audioGroups.length) return;
    const index = this.audioGroups.indexOf(this.selectedAudioGroup);
    const next = index < 0 ? 0 : (index + direction + this.audioGroups.length) % this.audioGroups.length;
    void this.changeAudioGroup(this.audioGroups[next]);
  }

  cycleAudioTrack(direction: number) {
    if (!this.audioTracks.length) return;
    const index = this.audioTracks.findIndex(track => track.id === this.selectedAudioTrack);
    const next = index < 0 ? 0 : (index + direction + this.audioTracks.length) % this.audioTracks.length;
    this.changeAudioTrack(String(this.audioTracks[next].id));
  }

  private async loadAudioGroups(url: string) {
    const generation = this.generation;
    try {
      const options = await this.tvChannelsService.getAudioOptions(url);
      if (this.destroyed || generation !== this.generation || url !== this.currentUrl) return;
      this.audioGroups = options.groups;
      this.selectedAudioGroup = options.selected;
      this.cdr.detectChanges();
    } catch { /* Audio metadata must not interrupt playback. */ }
  }

  async changeAudioGroup(group: string) {
    if (!this.audioGroups.includes(group) || group === this.selectedAudioGroup || this.sourceLoading || this.nextEpisodeLoading) return;
    const generation = this.generation;
    const position = this.player?.currentTime?.() || this.currentTime;
    this.sourceLoading = true;
    this.audioError = '';
    this.resetControlsTimer();
    try {
      const url = await this.tvChannelsService.getAlternativeSource(this.currentUrl, 1, group);
      if (this.destroyed || generation !== this.generation) return;
      this.resumeAfterSwitch = position;
      const navigated = await this.router.navigate(['/player'], { queryParams: {
        ...this.playbackParams, url, manualSource: null, selectedSource: null
      }, replaceUrl: true });
      if (!navigated) throw new Error('Ses dili değiştirilemedi.');
      this.manualSource = false;
      this.selectedSource = undefined;
      this.sourceAttempts = 0;
    } catch (error) {
      if (!this.destroyed && generation === this.generation) this.audioError = error instanceof Error ? error.message : 'Ses dili değiştirilemedi.';
    } finally {
      if (!this.destroyed && generation === this.generation) {
        this.sourceLoading = false;
        this.cdr.detectChanges();
      }
    }
  }

  private detachAudioTracks() {
    for (const event of ['addtrack', 'removetrack', 'change']) this.audioTrackList?.removeEventListener(event, this.audioTrackListener);
    this.audioTrackList = undefined;
  }

  private bindAudioTracks() {
    if (this.hls) return;
    const list = this.player?.audioTracks?.() as AudioTrackList | undefined;
    if (list && list !== this.audioTrackList) {
      this.detachAudioTracks();
      this.audioTrackList = list;
      for (const event of ['addtrack', 'removetrack', 'change']) list.addEventListener(event, this.audioTrackListener);
    }
    this.refreshAudioTracks();
  }

  private isTurkish(language = '', label = ''): boolean {
    return /^(tr|tur)([-_]|$)/i.test(language) || /türk|turk|dublaj/i.test(label);
  }

  private refreshAudioTracks() {
    if (this.destroyed) return;
    const tracks = this.hls ? this.hls.audioTracks.map((track, id) => ({ id, language: track.lang, label: track.name }))
      : Array.from(this.audioTrackList || []).map((track, id) => ({ id, language: track.language, label: track.label }));
    this.audioTracks = tracks.map(track => ({ id: track.id,
      label: this.isTurkish(track.language, track.label) ? `Türkçe${track.label ? ' · ' + track.label : ''}` : track.label || track.language || `Ses ${track.id + 1}` }));
    const selected = this.hls ? this.hls.audioTrack : Array.from(this.audioTrackList || []).findIndex(track => track.enabled);
    const turkish = tracks.find(track => this.isTurkish(track.language, track.label));
    this.selectedAudioTrack = selected;
    if (!this.manualAudioTrack && turkish && selected !== turkish.id) this.setAudioTrack(turkish.id);
    this.cdr.detectChanges();
  }

  changeAudioTrack(value: string) {
    const id = Number(value);
    if (!this.audioTracks.some(track => track.id === id)) return;
    this.manualAudioTrack = true;
    this.setAudioTrack(id);
    this.resetControlsTimer();
  }

  private setAudioTrack(id: number) {
    this.selectedAudioTrack = id;
    if (this.hls) this.hls.audioTrack = id;
    else if (this.audioTrackList) {
      // Enable the requested track first so synchronous change events see it.
      this.audioTrackList[id].enabled = true;
      Array.from(this.audioTrackList).forEach((track, index) => { if (index !== id) track.enabled = false; });
    }
  }

  private startShortizleHls(url: string): boolean {
    if (!this.isShortizleSource() || this.getVideoType(url) !== 'application/x-mpegURL' || !Hls.isSupported()) return false;
    const media = this.player?.tech?.(true)?.el?.();
    if (!(media instanceof HTMLVideoElement)) return false;
    const generation = this.generation;
    this.player.error(null);
    const hls = this.createHls();
    this.hls = hls;
    for (const event of [Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED]) {
      hls.on(event, () => {
        if (this.hls === hls && generation === this.generation) this.refreshAudioTracks();
      });
    }
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (this.destroyed || generation !== this.generation || this.hls !== hls) return;
      console.warn('[Player] HLS:', { source: this.sourceNumber, details: data.details, fatal: data.fatal });
      if (data.fatal) void this.recoverSource();
      else this.watchForStall();
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (this.hls !== hls || generation !== this.generation) return;
      void media.play().catch(() => { /* Autoplay can require a user gesture. */ });
    });
    hls.loadSource(url);
    hls.attachMedia(media);
    return true;
  }

  private createPlayer() {
    return videojs('my-video', { controls: false, fluid: false, fill: true, autoplay: true,
      responsive: true });
  }
}
