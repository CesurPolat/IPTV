import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignalrService } from '../../services/signalr.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-archillect-tv',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './archillect-tv.component.html',
  styleUrl: './archillect-tv.component.scss'
})
export class ArchillectTvComponent implements OnInit, OnDestroy {
  @Input() height: string = '100%';
  @Input() width: string = '100%';

  currentImage: string | null = null;
  currentIndex: number | null = null;

  scTitle: string = '';
  scPermalink: string = '#';
  scPlaying: boolean = false;
  private scWidget: any;
  private scriptStart = new Date().getTime();
  //private stamp = 0; // Fallback or server sync
  private stamp = Math.floor(Math.random() * 360000000000);

  constructor(private signalrService: SignalrService) { }

  ngOnInit() {
    this.signalrService.startConnection(environment.baseUrl + '/archillectTVHub');
    this.initSignalR();
    this.loadSoundCloudScript().then(() => {
      this.initSoundCloud();
    }).catch(err => {
      console.error('SoundCloud script load failed:', err);
    });
  }

  private loadSoundCloudScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).SC) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://w.soundcloud.com/player/api.js';
      script.type = 'text/javascript';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
  }

  private initSignalR() {
    this.signalrService.addListener('ReceiveArchillectUpdate', (dataStr: string) => {
      try {
        const parsedData = JSON.parse(dataStr);
        if (Array.isArray(parsedData) && parsedData.length > 1) {
          const updateInfo = parsedData[1];
          this.currentImage = updateInfo.url;
          this.currentIndex = updateInfo.index;
        }
      } catch (error) {
        console.error('Error parsing Archillect update data:', error);
      }
    });
  }

  private initSoundCloud() {
    const scurl = "https://soundcloud.com/archillect/sets/wave";
    const iframe = document.createElement("iframe");
    iframe.id = "scwidget";
    iframe.setAttribute("allow", "autoplay");
    iframe.style.display = "none";
    iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(scurl)}`;

    const container = document.getElementById('sc-container');
    if (container) {
      container.appendChild(iframe);
    }

    const SC = (window as any).SC;
    if (!SC) return;

    this.scWidget = SC.Widget(iframe);

    this.scWidget.bind(SC.Widget.Events.READY, () => {
      this.scWidget.setVolume(50);
      this.tryGetSounds();
    });

    this.scWidget.bind(SC.Widget.Events.PLAY, () => {
      this.scPlaying = true;
      this.scWidget.getCurrentSound((s: any) => {
        this.scTitle = s.title;
        this.scPermalink = s.permalink_url;
      });
    });

    this.scWidget.bind(SC.Widget.Events.PAUSE, () => {
      this.scPlaying = false;
    });

    this.scWidget.bind(SC.Widget.Events.FINISH, () => {
      this.playSynced();
    });
  }

  private tryGetSounds() {
    this.scWidget.getSounds((p: any[]) => {
      let incomplete = false;
      for (let i = 0; i < p.length; i++) {
        p[i].index = i;
        if (!p[i].full_duration) {
          incomplete = true;
          break;
        }
      }

      if (incomplete) {
        setTimeout(() => this.tryGetSounds(), 20);
      } else {
        const playlist = this.shuffle(p, 1337);
        this.playSynced(playlist);
      }
    });
  }

  private playSynced(playlist?: any[]) {
    if (!playlist) {
      this.scWidget.getSounds((p: any[]) => this.playSynced(this.shuffle(p, 1337)));
      return;
    }

    const ptotal = playlist.reduce((a, b) => a + b.full_duration, 0);
    const elapsed = new Date().getTime() - this.scriptStart;
    let loopstamp = (this.stamp + elapsed) % ptotal;

    let current = 0;
    let seek = 0;

    for (let i = 0; i < playlist.length; i++) {
      const duration = playlist[i].full_duration;
      if (duration < loopstamp) {
        loopstamp -= duration;
      } else {
        current = playlist[i].index;
        seek = loopstamp;
        break;
      }
    }
    this.scWidget.skip(current);
    this.scWidget.seekTo(seek);
    this.scWidget.play();
  }

  private shuffle(arr: any[], seed: number) {
    let currIndex = arr.length, tempVal, randIndex;
    seed = seed || 1;
    const r = () => {
      var x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };
    while (0 !== currIndex) {
      randIndex = Math.floor(r() * currIndex);
      currIndex -= 1;
      tempVal = arr[currIndex];
      arr[currIndex] = arr[randIndex];
      arr[randIndex] = tempVal;
    }
    return arr;
  }

  ngOnDestroy() {
    this.signalrService.removeListener('ReceiveArchillectUpdate');
    this.signalrService.stopConnection();
    if (this.scWidget) {
      try {
        this.scWidget.unbind((window as any).SC.Widget.Events.READY);
        this.scWidget.unbind((window as any).SC.Widget.Events.PLAY);
        this.scWidget.unbind((window as any).SC.Widget.Events.PAUSE);
        this.scWidget.unbind((window as any).SC.Widget.Events.FINISH);
      } catch (error) {
        console.error('Error unbinding SoundCloud widget events:', error);
      }
    }
  }
}
