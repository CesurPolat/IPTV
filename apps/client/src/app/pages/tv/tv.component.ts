import { Component, OnInit, HostListener, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { TvChannelsService, Channel } from '../../services/tv-channels.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ArchillectTvComponent } from '../../components/archillect-tv/archillect-tv.component';
import { environment } from '../../../environments/environment';

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
  private readonly seekStepSeconds = 10;
  private readonly seekHoldResetThresholdMs = 250;
  private readonly seekBaseRatePerSecond = 12;
  private readonly seekLinearRateFactor = 18;
  private readonly seekQuadraticRateFactor = 9;
  private readonly seekMaxRatePerSecond = 5400;
  private readonly seekCommitDelayMs = 350;
  private readonly liveEdgeThresholdSeconds = 3;
  private readonly onlyLiveStorageKey = 'onlyLiveEnabled';

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
  isOnlyLiveEnabled: boolean = true;
  showChannelInfo: boolean = false;
  showPlayerControls: boolean = true;
  isQualityPanelActive: boolean = false;
  playbackProgressPercent: number = 0;
  pendingSeekProgressPercent: number | null = null;
  pendingSeekDirection: 'backward' | 'forward' | null = null;
  pendingSeekDeltaSeconds: number = 0;
  isProgressSeekable: boolean = false;
  isLivePlayback: boolean = true;
  playbackStatusLabel: string = 'Canlı';
  private segmentClockLabel: string | null = null;
  private lastSegmentHour: number | null = null;
  private lastSegmentMinute: number | null = null;
  private lastSegmentDay: string | null = null;
  private includeAllSegmentsMode: boolean = false;
  private isSwitchingPlaylistMode: boolean = false;
  private pendingSeekTime: number | null = null;
  private seekCommitTimeout: any;
  private seekHoldDirection: 'backward' | 'forward' | null = null;
  private seekHoldStartedAt: number = 0;
  private lastSeekInputAt: number = 0;
  private controlsHideTimeout: any;
  private infoTimeout: any;

  constructor(
    private tvChannelsService: TvChannelsService,
    private activatedRoute: ActivatedRoute,
    private router: Router
  ) { }

  ngOnInit() {
    this.isOnlyLiveEnabled = this.readOnlyLiveSetting();
    this.isArchillectTvEnabled = this.readArchillectSetting();
    this.isChannelAutoSwitchEnabled = this.readChannelAutoSwitchSetting();

    this.fetchChannels();

  }

  private readOnlyLiveSetting(): boolean {
    try {
      const stored = localStorage.getItem(this.onlyLiveStorageKey);
      if (stored === null) {
        return true;
      }
      return stored === 'true';
    } catch {
      return true;
    }
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
        this.channels = data
          .filter(item => item.category == 'TVChannel')
          .map((item, index) => ({ ...item, originalIndex: index }));
        console.log('[TV] Kanal listesi yüklendi:', this.channels.length, 'kanal bulundu.');
        if (this.channels.length > 0 && !this.player) {
          this.activatedRoute.params.subscribe(params => {
            const id: number = parseInt(params['id']);
            const safeIndex = Number.isFinite(id) ? Math.max(0, Math.min(id, this.channels.length - 1)) : 0;
            this.currentChannelIndex = safeIndex;
            this.selectedIndex = safeIndex;
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
        src: this.resolveChannelPlaybackUrl(this.channels[this.currentChannelIndex], this.includeAllSegmentsMode),
        type: 'application/x-mpegURL'
      }]
    });

    this.scrollToSelected(this.currentChannelIndex);

    this.player.on('play', () => {
      this.showPlayIcon = false;
      this.showControlsTemporarily();
      this.updatePlaybackProgress();
    });

    // Oynatılan segment (TS) dosyalarını kontrol et
    this.player.on('timeupdate', () => {
      this.updatePlaybackProgress();

      const vhs = (this.player as any).tech(true).vhs;
      const media = vhs?.playlists?.media();

      if (media && media.segments) {
        const currentTime = this.player.currentTime();

        const currentSegment = media.segments.find((seg: { start: number; duration: any; }) =>
          currentTime >= seg.start && currentTime < (seg.start + seg.duration)
        );

        if (currentSegment && currentSegment.resolvedUri) {
          const uri = currentSegment.resolvedUri;
          this.updateSegmentClockLabelFromUri(uri);
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

            const shouldUseArchillect = this.isOnlyLiveEnabled && this.isArchillectTvEnabled && isAd;

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
      this.updatePlaybackProgress();
      this.showPlayIcon = true;
      this.showPlayerControls = true;
      this.clearControlsHideTimeout();
    });

    this.player.on('seeking', () => {
      this.updatePlaybackProgress();
    });

    this.player.on('durationchange', () => {
      this.updatePlaybackProgress();
    });

    this.player.on('loadeddata', () => {
      this.updatePlaybackProgress();
    });

    this.player.on('ended', () => {
      this.handlePlaybackEnded();
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
      this.clearPendingSeekCommit();
      this.pendingSeekTime = null;
      this.resetPendingSeekFeedback();

      const currentUrl = this.player.currentSrc();
      const newUrl = this.resolveChannelPlaybackUrl(this.channels[index], false);

      // Eğer seçilen kanal zaten oynatılıyorsa, source'u güncelleme
      if (currentUrl === newUrl) {
        return;
      }

      this.currentChannelIndex = index;
      this.isLivePlayback = true;
      this.includeAllSegmentsMode = false;

      this.player.src({
        src: this.resolveChannelPlaybackUrl(this.channels[index], this.includeAllSegmentsMode),
        type: 'application/x-mpegURL'
      });
      this.segmentClockLabel = null;
      this.playbackStatusLabel = 'Canlı';

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

      if (event.key === '+' || event.key === '=') {
        this.cycleQuality(1);
        return;
      }

      if (event.key === '-' || event.key === '_') {
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
        if (this.isQualityPanelActive) {
          this.cycleQuality(event.key === 'ArrowRight' ? 1 : -1);
          return;
        }

        const direction = event.key === 'ArrowLeft' ? 'backward' : 'forward';
        const seekStep = this.getSeekStepForHold(direction, event.repeat);
        const seekDelta = direction === 'backward' ? -seekStep : seekStep;
        this.seekPlayback(seekDelta);
        return;
      }

    }

  }

  @HostListener('document:keyup', ['$event'])
  handleKeyboardUpEvent(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      this.resetSeekHoldState();
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

  onProgressBarClick(event: MouseEvent) {
    if (!this.player || this.isAdPlaying || !this.isProgressSeekable) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return;
    }

    const rect = target.getBoundingClientRect();
    if (!rect.width) {
      return;
    }

    const clickOffset = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const clickRatio = clickOffset / rect.width;

    const bounds = this.getSeekBounds();
    const targetTime = bounds.min + (bounds.max - bounds.min) * clickRatio;
    this.clearPendingSeekCommit();
    this.pendingSeekTime = null;
    this.resetPendingSeekFeedback();
    this.player.currentTime(targetTime);
    this.updatePlaybackProgress();
    this.showControlsTemporarily();
  }

  private seekPlayback(deltaSeconds: number) {
    if (!this.player || this.isAdPlaying) {
      return;
    }

    const currentTime = this.player.currentTime();
    const baseTime = this.pendingSeekTime ?? currentTime;
    if (!Number.isFinite(baseTime)) {
      return;
    }

    const bounds = this.getSeekBounds();

    const targetTime = Math.max(bounds.min, Math.min(baseTime + deltaSeconds, bounds.max));
    if (Math.abs(targetTime - baseTime) < 0.1) {
      return;
    }

    this.pendingSeekTime = targetTime;
    this.updatePendingSeekFeedback(targetTime, currentTime, bounds);
    this.scheduleSeekCommit();
    this.showControlsTemporarily();
  }

  private getSeekStepForHold(direction: 'backward' | 'forward', isRepeat: boolean): number {
    const now = Date.now();
    const shouldResetHold =
      !isRepeat ||
      this.seekHoldDirection !== direction ||
      this.lastSeekInputAt === 0 ||
      (now - this.lastSeekInputAt) > this.seekHoldResetThresholdMs;

    if (shouldResetHold) {
      this.seekHoldDirection = direction;
      this.seekHoldStartedAt = now;
      this.lastSeekInputAt = now;
      return this.seekStepSeconds;
    }

    const holdDurationMs = now - this.seekHoldStartedAt;
    const elapsedSinceLastInputMs = Math.max(16, now - this.lastSeekInputAt);
    this.lastSeekInputAt = now;

    // Use a continuous hold-time formula so long holds can jump back/forward by hours.
    const seekRatePerSecond = this.getSeekRatePerSecond(holdDurationMs);
    const acceleratedStep = Math.round((seekRatePerSecond * elapsedSinceLastInputMs) / 1000);
    return Math.max(1, acceleratedStep);
  }

  private getSeekRatePerSecond(holdDurationMs: number): number {
    const holdSeconds = holdDurationMs / 1000;
    const rate = this.seekBaseRatePerSecond
      + (this.seekLinearRateFactor * holdSeconds)
      + (this.seekQuadraticRateFactor * holdSeconds * holdSeconds);

    return Math.max(this.seekBaseRatePerSecond, Math.min(this.seekMaxRatePerSecond, rate));
  }

  private resetSeekHoldState(): void {
    this.seekHoldDirection = null;
    this.seekHoldStartedAt = 0;
    this.lastSeekInputAt = 0;
  }

  private scheduleSeekCommit(): void {
    this.clearPendingSeekCommit();
    this.seekCommitTimeout = setTimeout(() => {
      this.commitPendingSeek();
    }, this.seekCommitDelayMs);
  }

  private commitPendingSeek(): void {
    if (!this.player || this.pendingSeekTime === null) {
      return;
    }

    const targetTime = this.pendingSeekTime;
    this.pendingSeekTime = null;
    this.seekCommitTimeout = null;
    this.player.currentTime(targetTime);
    this.updatePlaybackProgress();
    this.resetPendingSeekFeedback();
  }

  private clearPendingSeekCommit(): void {
    if (this.seekCommitTimeout) {
      clearTimeout(this.seekCommitTimeout);
      this.seekCommitTimeout = null;
    }
  }

  private updatePendingSeekFeedback(targetTime: number, currentTime: number, bounds: { min: number; max: number }): void {
    const duration = bounds.max - bounds.min;
    if (duration > 0.1) {
      this.pendingSeekProgressPercent = ((targetTime - bounds.min) / duration) * 100;
    } else {
      this.pendingSeekProgressPercent = this.playbackProgressPercent;
    }

    this.pendingSeekDirection = targetTime < currentTime ? 'backward' : 'forward';
    this.pendingSeekDeltaSeconds = Math.max(0, Math.round(Math.abs(targetTime - currentTime)));
  }

  private resetPendingSeekFeedback(): void {
    this.pendingSeekProgressPercent = null;
    this.pendingSeekDirection = null;
    this.pendingSeekDeltaSeconds = 0;
  }

  private formatSeekDelta(seconds: number): string {
    if (seconds < 60) {
      return `${seconds} sn`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    if (remainder === 0) {
      return `${minutes} dk`;
    }

    return `${minutes} dk ${remainder} sn`;
  }

  get isSeekPending(): boolean {
    return this.pendingSeekTime !== null && this.pendingSeekProgressPercent !== null;
  }

  get displayedPlaybackProgressPercent(): number {
    return this.pendingSeekProgressPercent ?? this.playbackProgressPercent;
  }

  get displayedPlaybackStatusLabel(): string {
    if (!this.isSeekPending) {
      return this.playbackStatusLabel;
    }

    const delta = this.formatSeekDelta(this.pendingSeekDeltaSeconds);
    return this.pendingSeekDirection === 'backward'
      ? `Geri sariliyor (${delta})`
      : `Ileri sariliyor (${delta})`;
  }

  private getSeekBounds(): { min: number; max: number } {
    if (!this.player) {
      return { min: 0, max: 0 };
    }

    let minSeekTime = 0;
    let maxSeekTime = Number.isFinite(this.player.duration()) ? this.player.duration() : 0;

    const seekable = this.player.seekable?.();
    if (seekable && seekable.length > 0) {
      minSeekTime = seekable.start(0);
      maxSeekTime = seekable.end(seekable.length - 1);
    }

    if (!Number.isFinite(minSeekTime)) {
      minSeekTime = 0;
    }

    if (!Number.isFinite(maxSeekTime)) {
      maxSeekTime = minSeekTime;
    }

    if (maxSeekTime < minSeekTime) {
      maxSeekTime = minSeekTime;
    }

    return { min: minSeekTime, max: maxSeekTime };
  }

  private updatePlaybackProgress() {
    if (!this.player) {
      this.playbackProgressPercent = 0;
      this.isProgressSeekable = false;
      this.isLivePlayback = false;
      this.playbackStatusLabel = 'Canlı';
      return;
    }

    const currentTime = this.player.currentTime();
    if (!Number.isFinite(currentTime)) {
      this.playbackProgressPercent = 0;
      this.isProgressSeekable = false;
      this.isLivePlayback = false;
      this.playbackStatusLabel = 'Canlı';
      return;
    }

    const bounds = this.getSeekBounds();
    const duration = bounds.max - bounds.min;

    if (duration <= 0.1) {
      this.playbackProgressPercent = 0;
      this.isProgressSeekable = false;
      this.isLivePlayback = false;
      this.playbackStatusLabel = 'Canlı';
      return;
    }

    const clampedCurrentTime = Math.max(bounds.min, Math.min(currentTime, bounds.max));
    this.playbackProgressPercent = ((clampedCurrentTime - bounds.min) / duration) * 100;
    this.isProgressSeekable = true;
    const previousLivePlayback = this.isLivePlayback;
    this.isLivePlayback = this.isAtLiveEdge(clampedCurrentTime, bounds.max);
    this.playbackStatusLabel = this.isLivePlayback
      ? 'Canlı'
      : (this.segmentClockLabel ?? 'Canlı');

    if (previousLivePlayback !== this.isLivePlayback) {
      const rewindOffsetFromLive = Math.max(0, bounds.max - clampedCurrentTime);
      this.syncPlaylistModeWithPlayback(rewindOffsetFromLive);
    }
  }

  private syncPlaylistModeWithPlayback(rewindOffsetFromLive: number): void {
    if (!this.player || this.currentChannelIndex < 0 || this.isSwitchingPlaylistMode || this.isOnlyLiveEnabled) {
      return;
    }

    this.clearPendingSeekCommit();
    this.pendingSeekTime = null;
    this.resetPendingSeekFeedback();

    const targetIncludeAllSegments = !this.isLivePlayback;
    if (targetIncludeAllSegments === this.includeAllSegmentsMode) {
      return;
    }

    const channel = this.channels[this.currentChannelIndex];
    if (!channel) {
      return;
    }

    this.isSwitchingPlaylistMode = true;
    this.includeAllSegmentsMode = targetIncludeAllSegments;
    const wasPaused = this.player.paused();

    this.player.src({
      src: this.resolveChannelPlaybackUrl(channel, this.includeAllSegmentsMode),
      type: 'application/x-mpegURL'
    });



    this.player.one('loadedmetadata', () => {
      if (targetIncludeAllSegments && Number.isFinite(rewindOffsetFromLive)) {
        const bounds = this.getSeekBounds();
        const seekTime = Math.max(bounds.min, Math.min(bounds.max - rewindOffsetFromLive, bounds.max));
        this.player.currentTime(seekTime);
      }

      setTimeout(() => {
        this.player.play();
      }, 500);
      if (!wasPaused) {
        this.player.play().catch(() => {
          // no-op: autoplay can fail depending on platform policies
        });
      }

      this.isSwitchingPlaylistMode = false;
      this.updatePlaybackProgress();
    });

    this.player.play();

  }

  private handlePlaybackEnded(): void {
    if (!this.player || this.currentChannelIndex < 0 || this.isSwitchingPlaylistMode) {
      return;
    }

    const channel = this.channels[this.currentChannelIndex];
    if (!channel) {
      return;
    }

    this.isSwitchingPlaylistMode = true;

    const hasClockInfo = this.lastSegmentHour !== null && this.lastSegmentMinute !== null;

    const resumeUrl = this.resolveChannelPlaybackUrl(
      channel,
      this.includeAllSegmentsMode,
      hasClockInfo ? this.lastSegmentHour! : undefined,
      hasClockInfo ? this.lastSegmentMinute! : undefined,
      hasClockInfo ? this.lastSegmentDay : undefined
    );

    this.player.src({
      src: resumeUrl,
      type: 'application/x-mpegURL'
    });

    this.player.one('error', () => {
      this.isSwitchingPlaylistMode = false;
    });

    this.player.one('loadedmetadata', () => {
      this.player.play().catch(() => {
        // no-op: autoplay can fail depending on platform policies
      });
      this.isSwitchingPlaylistMode = false;
      this.showControlsTemporarily();
      this.updatePlaybackProgress();
    });
  }

  private resolveChannelPlaybackUrl(
    channel: Channel,
    includeAllSegments: boolean,
    hour?: number,
    minute?: number,
    day?: string | null
  ): string {
    if (this.isOnlyLiveEnabled && channel.source) {
      return channel.source;
    }

    const channelName = channel.name;
    let url = `${environment.baseUrl}/HlsRecorder/GetLivePlaylist/${channelName}/index.m3u8?includeAllSegments=${includeAllSegments}`;

    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      url += `&hour=${hour}&minute=${minute}`;
    }

    if (day && /^\d{8}$/.test(day)) {
      url += `&day=${day}`;
    }

    return url;
  }

  private updateSegmentClockLabelFromUri(uri: string): void {
    const fileName = uri.split('/').pop() || '';
    const decodedFileName = this.safeDecodeURIComponent(fileName);
    const datedTimeMatch = decodedFileName.match(/_(\d{8})_(\d{2})-(\d{2})-(\d{2})(?:_\d{5})?(?:\.ts)?(?:\?|$)/i);

    if (datedTimeMatch) {
      const [, day, hour, minute] = datedTimeMatch;
      this.segmentClockLabel = `${hour}:${minute}`;

      const parsedHour = Number.parseInt(hour, 10);
      const parsedMinute = Number.parseInt(minute, 10);
      if (Number.isFinite(parsedHour) && Number.isFinite(parsedMinute)) {
        this.lastSegmentHour = parsedHour;
        this.lastSegmentMinute = parsedMinute;
        this.lastSegmentDay = day;
      }
      return;
    }

    const timeMatch = decodedFileName.match(/_(\d{2})-(\d{2})-(\d{2})(?:_\d{5})?(?:\.ts)?(?:\?|$)/i);

    if (!timeMatch) {
      return;
    }

    const [, hour, minute] = timeMatch;
    this.segmentClockLabel = `${hour}:${minute}`;

    const parsedHour = Number.parseInt(hour, 10);
    const parsedMinute = Number.parseInt(minute, 10);
    if (Number.isFinite(parsedHour) && Number.isFinite(parsedMinute)) {
      this.lastSegmentHour = parsedHour;
      this.lastSegmentMinute = parsedMinute;
      this.lastSegmentDay = this.extractDayFromUri(uri) ?? this.estimateDayForHour(parsedHour);
    }
  }

  private extractDayFromUri(uri: string): string | null {
    const decodedUri = this.safeDecodeURIComponent(uri);

    const dayQueryMatch = decodedUri.match(/[?&]day=(\d{8})(?:&|$)/i);
    if (dayQueryMatch) {
      return dayQueryMatch[1];
    }

    const pathDayMatch = decodedUri.match(/(?:^|[\/_-])(20\d{6})(?:[\/_-]|$)/);
    if (pathDayMatch) {
      return pathDayMatch[1];
    }

    return null;
  }

  private estimateDayForHour(segmentHour: number): string {
    const now = new Date();
    const segmentDate = new Date(now);

    // If local time just passed midnight and segment hour is late-night, prefer previous day.
    if (now.getHours() <= 3 && segmentHour >= 21) {
      segmentDate.setDate(segmentDate.getDate() - 1);
    }

    return this.formatDateAsYyyyMmDd(segmentDate);
  }

  private formatDateAsYyyyMmDd(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private safeDecodeURIComponent(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  private isAtLiveEdge(currentTime: number, maxSeekTime: number): boolean {
    return (maxSeekTime - currentTime) <= this.liveEdgeThresholdSeconds;
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
    this.clearPendingSeekCommit();
    this.pendingSeekTime = null;
    this.resetSeekHoldState();
    this.resetPendingSeekFeedback();
    if (this.player) {
      this.player.dispose();
    }
    this.clearControlsHideTimeout();
  }
}
