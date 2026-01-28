import { Component, HostListener, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { App as CapacitorApp } from '@capacitor/app';
import videojs from 'video.js';

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
  private controlsTimeout?: any;
  private backButtonListener: any;

  constructor(
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute
  ) {}

  ngAfterViewInit() {
    this.route.queryParams.subscribe(params => {
      const url = params['url'];
      if (url) {
        this.initializePlayer(url);
      } else {
        // Parametre yoksa varsayılan video veya hata yönetimi
        this.initializePlayer("https://www.w3schools.com/html/mov_bbb.mp4");
      }
    });
    this.resetControlsTimer();

    // Capacitor back button listener
    this.backButtonListener = CapacitorApp.addListener('backButton', () => {
      // Backspace tuşuna basılmış gibi davran
      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      this.handleKeyboardEvent(event);
    });
  }

  ngOnDestroy() {
    if (this.player) {
      this.player.dispose();
    }
    if (this.controlsTimeout) {
      clearTimeout(this.controlsTimeout);
    }
    if (this.backButtonListener) {
      this.backButtonListener.remove();
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
    if (!this.player) return;

    this.resetControlsTimer();

    /* if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace'].includes(event.key)) {
      event.preventDefault();
    } */

    switch (event.key) {
      case 'Backspace':
        window.location.href = 'index.html';
        break;
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
      this.player.dispose();
    }

    const type = this.getVideoType(url);

    this.player = videojs('my-video', {
      controls: false,
      fluid: true,
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
      this.cdr.detectChanges();
    });
  }
}
