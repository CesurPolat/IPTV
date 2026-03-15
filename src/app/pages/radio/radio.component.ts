import { Component, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA, HostListener, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { matPlayArrow, matPause, matSkipNext, matSkipPrevious } from '@ng-icons/material-icons/baseline';
import { TvChannelsService, Channel } from '../../services/tv-channels.service';
import { Subscription } from 'rxjs';
import videojs from 'video.js';
import Player from 'video.js/dist/types/player';

@Component({
  selector: 'app-radio',
  standalone: true,
  imports: [CommonModule, NgIconComponent],
  providers: [provideIcons({ matPlayArrow, matPause, matSkipNext, matSkipPrevious })],
  templateUrl: './radio.component.html',
  styleUrl: './radio.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class RadioComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('channelList') channelList!: ElementRef;
  @ViewChild('audioPlayer', { static: false }) audioPlayerRef!: ElementRef;
  
  player: Player | null = null;
  channels: Channel[] = [
    {
      id: 'r1',
      name: 'Power Türk FM',
      source: 'https://live.powerapp.com.tr/powerturk/abr/playlist.m3u8',
      poster: 'https://www.canliradyodinle.fm/wp-content/uploads/power-turk-dinle.png',
      category: 'Radio'
    },
    {
      id: 'r2',
      name: 'Süper FM',
      source: 'https://28553.live.streamtheworld.com/SUPER_FM128AAC.aac?ttag=G:f,m,AG:2,3,SES:1,2,OC:1,2,3,4,6,INT:1,3,7,CH:3?/;stream.mp3',
      poster: 'https://www.canliradyodinle.fm/wp-content/uploads/super-fm-dinle.jpg',
      category: 'Radio'
    },
    {
      id: 'r3',
      name: 'Joy Türk',
      source: 'https://25633.live.streamtheworld.com/JOY_TURK128AAC.aac?ttag=G:f,m,AG:1,2,SES:1,2,OC:1,3,6,7,INT:2,5,6,CH:3?/;stream.mp3',
      poster: 'https://www.canliradyodinle.fm/wp-content/uploads/joy-turk-dinle.jpg',
      category: 'Radio'
    },
    {
      id: 'r4',
      name: 'Slow Türk',
      source: 'https://radyo.duhnet.tv/slowturk?/;stream.mp3',
      poster: 'https://www.canliradyodinle.fm/wp-content/uploads/slow-turk-dinle.jpg',
      category: 'Radio'
    },
    {
      id: 'r5',
      name: 'Virgin Radio Türkiye',
      source: 'https://25653.live.streamtheworld.com/VIRGIN_RADIO128AAC.aac?/;stream.mp3',
      poster: 'https://www.canliradyodinle.fm/wp-content/uploads/virgin-radio.jpg',
      category: 'Radio'
    },
    {
      id: 'r6',
      name: 'Radyo Fenomen',
      source: 'https://live.radyofenomen.com/fenomen/abr/playlist.m3u8',
      poster: 'https://www.canliradyodinle.fm/wp-content/uploads/radyo-fenomen.jpg',
      category: 'Radio'
    },
    {
      id: 'r7',
      name: 'Kral Pop Radyo',
      source: 'https://dygedge.radyotvonline.net/kralpop/playlist.m3u8',
      poster: 'https://www.canliradyodinle.fm/wp-content/uploads/kral-pop.jpg',
      category: 'Radio'
    },
    {
      id: 'r8',
      name: ' Alem FM',
      source: 'https://alemfm.radyotvonline.net/alemfmaac?/;stream.mp3',
      poster: 'https://www.canliradyodinle.fm/wp-content/uploads/alem-fm.jpg',
      category: 'Radio'
    },
    {
      id: 'r9',
      name: 'Radyo 7',
      source: 'https://moondigitaledge.radyotvonline.net/radyo7/playlist.m3u8',
      poster: 'https://www.canliradyodinle.fm/wp-content/uploads/radyo-7.jpg',
      category: 'Radio'
    }
  ];
  
  currentChannelIndex: number = 0;
  isPlaying: boolean = false;
  isChanging: boolean = false;
  private subscription: Subscription = new Subscription();

  constructor(
    private tvChannelsService: TvChannelsService,
    private router: Router
  ) {}

  ngAfterViewInit() {
    this.initPlayer();
    this.startFromBeginning();
  }

  private initPlayer() {
    if (this.audioPlayerRef) {
      this.player = videojs(this.audioPlayerRef.nativeElement, {
        autoplay: false,
        controls: false,
        preload: 'auto',
        techOrder: ['html5']
      });

      this.player.on('play', () => {
        this.isPlaying = true;
      });

      this.player.on('pause', () => {
        this.isPlaying = false;
      });

      this.player.on('error', () => {
        const error = this.player?.error();
        console.error("Video.js error", error);
        this.isPlaying = false;
      });
    }
  }

  private startFromBeginning() {
    if (!this.player || !this.currentChannel) return;

    this.player.src({
      src: this.currentChannel.source,
      type: this.currentChannel.source.includes('.m3u8') ? 'application/x-mpegURL' : 'audio/mpeg'
    });

    this.player.currentTime(0);

    const playPromise = this.player.play();
    if (playPromise !== undefined) {
      playPromise.catch((error) => {
        console.warn('Autoplay blocked or failed:', error);
        this.isPlaying = false;
      });
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        this.nextChannel();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        this.previousChannel();
        break;
      case ' ':
      case 'Enter':
        event.preventDefault(); // Sayfa kaymasını engelle
        this.togglePlay();
        break;
      case 'Backspace':
        event.preventDefault();
        this.router.navigate(['/home']);
        break;
    }
  }

  ngOnInit() {
    if (this.channels.length > 0) {
      this.currentChannelIndex = 0;
    }
  }

  get currentChannel(): Channel | null {
    return this.channels.length > 0 ? this.channels[this.currentChannelIndex] : null;
  }

  togglePlay() {
    if (!this.currentChannel || !this.player) return;

    if (this.isPlaying) {
      this.player.pause();
    } else {
      this.player.src({
        src: this.currentChannel.source,
        type: this.currentChannel.source.includes('.m3u8') ? 'application/x-mpegURL' : 'audio/mpeg'
      });
      this.player.play();
    }
  }

  nextChannel() {
    this.selectChannel((this.currentChannelIndex + 1) % this.channels.length);
  }

  previousChannel() {
    this.selectChannel((this.currentChannelIndex - 1 + this.channels.length) % this.channels.length);
  }

  selectChannel(index: number) {
    if (this.currentChannelIndex === index) return;
    this.isChanging = true;
    setTimeout(() => {
      this.currentChannelIndex = index;
      this.updateSourceAndPlay();
      this.scrollToActiveChannel();
      setTimeout(() => {
        this.isChanging = false;
      }, 500);
    }, 500);
  }

  private scrollToActiveChannel() {
    setTimeout(() => {
      const container = this.channelList?.nativeElement;
      const activeElement = document.getElementById('channel-' + this.currentChannelIndex);
      
      if (container && activeElement) {
        const containerHeight = container.offsetHeight;
        const elementTop = (activeElement as HTMLElement).offsetTop;
        const elementHeight = activeElement.offsetHeight;
        
        // Elemanı konteynırın tam ortasına getirecek scroll pozisyonunu hesapla
        const scrollTo = elementTop - (containerHeight / 2) + (elementHeight / 2);
        
        container.scrollTo({
          top: scrollTo,
          behavior: 'smooth'
        });
      }
    }, 100);
  }

  private updateSourceAndPlay() {
    if (this.player && this.currentChannel) {
      const wasPlaying = this.isPlaying;
      this.player.src({
        src: this.currentChannel.source,
        type: this.currentChannel.source.includes('.m3u8') ? 'application/x-mpegURL' : 'audio/mpeg'
      });
      if (wasPlaying) {
        this.player.play();
      }
    }
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    if (this.player) {
      this.player.dispose();
      this.player = null;
    }
  }

  private bindAudioEvents() {
    // legacy method no longer used
  }
}
