import { Component, OnInit, HostListener, ViewChild, ElementRef } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

interface Channel {
  name: string;
  logo: string;
  url: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
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
  channels: Channel[] = [
    { name: 'TRT 1', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/TRT_1_logo_%282012-2021%29.png/960px-TRT_1_logo_%282012-2021%29.png', url: 'https://trt.daioncdn.net/trt-1/master_1080p.m3u8?&sid=79cyp2uy32t3&app=ed3904e8-737b-4a5e-856a-1b0d7a0a94e2&ce=2' },
    { name: 'ATV', logo: 'https://upload.wikimedia.org/wikipedia/commons/7/78/Atv_logosu.png', url: 'https://trkvz.daioncdn.net/atv/atv.m3u8?ce=3&app=d1ce2d40-5256-4550-b02e-e73c185a314e' },
    { name: 'Kanal D', logo: 'https://upload.wikimedia.org/wikipedia/tr/a/a4/Kanal_D_logo.png?20240410160225', url: 'https://demiroren.daioncdn.net/kanald/kanald.m3u8?app=kanald_web&ce=3&ppid=90c3164ba032ec3d41ffbcd67477566c' },
    { name: 'Star TV', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/StarTV.svg/512px-StarTV.svg.png', url: 'https://dogus.daioncdn.net/startv/startv.m3u8?ce=3&app=a20ac41e-bdc3-4aa1-934d-26b484480ac9' },
    { name: 'NOW TV', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/NOW_TV_%28Turkey%29_wordmark-red.svg/512px-NOW_TV_%28Turkey%29_wordmark-red.svg.png', url: 'https://nowtv-live-ad.ercdn.net/nowtv/playlist.m3u8?st=lYaZ2cR1YSGPD86f3FyT1Q&e=1742609470' },
    { name: 'TV360', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/360_tv.png/120px-360_tv.png', url: 'https://turkmedya-live.ercdn.net/tv360/tv360.m3u8' },
    { name: 'Kanal 7', logo: 'https://cdn.kanal7.com/kanal7/wp-content/themes/kanal7/v2/images/kanal7-logo-30yil.svg', url: 'https://kanal7.daioncdn.net/kanal7/kanal7.m3u8?app=f99587ad-1637-494d-8255-da35b09d17a1&ce=3' },
    { name: 'Show TV', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Show_TV_logo.svg/1024px-Show_TV_logo.svg.png', url: 'https://ciner.daioncdn.net/showtv/showtv.m3u8?ce=3&app=4bc856ef-4c68-4a94-bc87-37dfaaa66558' },
    { name: 'A2 TV', logo: 'https://iatv.tmgrup.com.tr/site/v2/a2tv/i/a2tv-logo.png', url: 'https://trkvz.daioncdn.net/a2tv/a2tv.m3u8?ce=3&app=59363a60-be96-4f73-9eff-355d0ff2c758' },
    { name: 'TV8', logo: 'https://upload.wikimedia.org/wikipedia/tr/6/68/Tv8_Yeni_Logo.png', url: 'https://tv8.daioncdn.net/tv8/tv8.m3u8?app=7ddc255a-ef47-4e81-ab14-c0e5f2949788&ce=3' },
    { name: 'TV2', logo: 'https://upload.wikimedia.org/wikipedia/tr/c/ca/Teve2_logo.png', url: 'https://demiroren.daioncdn.net/teve2/teve2.m3u8?ce=3&app=6aab838a-437e-4a1b-bbd0-e30f79cdbbbd' },
    { name: 'Habertürk', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Habert%C3%BCrk_TV_logo.svg/1920px-Habert%C3%BCrk_TV_logo.svg.png', url: 'https://ciner.daioncdn.net/haberturktv/haberturktv.m3u8?app=c98ab0b0-50cc-495b-bb37-778e91f5ff5b&ce=3' },
    { name: 'TLC', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/TLC_logo_%282023%29.svg/1920px-TLC_logo_%282023%29.svg.png', url: 'https://dogus.daioncdn.net/tlc/tlc.m3u8?ce=3&app=1aca0aa1-06e3-41ff-a8e5-38d7df475469' },
    { name: 'DMAX', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/DMAX_BLACK.svg/1920px-DMAX_BLACK.svg.png', url: 'https://dogus.daioncdn.net/dmax/dmax.m3u8?ce=3&app=5a02c599-d17e-4982-9b04-090934d51af7' }
  ];

  ngOnInit() {
    this.player = videojs('my-video', {
      controls: false,
      fluid: true,
      sources: [{
        src: this.channels[0].url,
        type: 'application/x-mpegURL'
      }]
    });

    this.player.on('play', () => {
      this.showPlayIcon = false;
    });

    this.player.on('pause', () => {
      this.showPlayIcon = true;
    });

    this.selectedIndex = 0;
    this.player.play().catch(() => {
      this.showPlayIcon = true;
    });
  }

  changeChannel(index: number) {
    if (this.player && this.channels[index]) {
      const currentUrl = this.player.currentSrc();
      const newUrl = this.channels[index].url;
      
      // Eğer seçilen kanal zaten oynatılıyorsa, source'u güncelleme
      if (currentUrl === newUrl) {
        return;
      }

      this.player.src({
        src: newUrl,
        type: 'application/x-mpegURL'
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
    if (this.isMenuOpen) {
      const currentUrl = this.player.currentSrc();
      const currentChannelIndex = this.channels.findIndex(channel => channel.url === currentUrl);
      this.selectedIndex = currentChannelIndex >= 0 ? currentChannelIndex : 0;
      setTimeout(() => this.scrollToSelected(), 100);
    } else {
      this.selectedIndex = -1;
    }
  }

  @HostListener('document:keydown.arrowdown', ['$event'])
  onArrowDown(event: KeyboardEvent) {
    if (this.isMenuOpen) {
      event.preventDefault();
      if (this.selectedIndex < this.channels.length - 1) {
        this.selectedIndex++;
        this.scrollToSelected();
      }
    }
  }

  @HostListener('document:keydown.arrowup', ['$event'])
  onArrowUp(event: KeyboardEvent) {
    if (this.isMenuOpen) {
      event.preventDefault();
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.scrollToSelected();
      }
    }
  }

  playVideo() {
    if (this.player) {
      this.player.play();
    }
  }

  ngOnDestroy() {
    if (this.player) {
      this.player.dispose();
    }
  }
}
