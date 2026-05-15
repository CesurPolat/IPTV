import { Component, OnInit, HostListener, ViewChild, ElementRef, OnDestroy, AfterViewInit, ViewChildren, QueryList, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { matTv, matRadio, matMovie, matSettings } from '@ng-icons/material-icons/baseline';
import { environment } from '../../../environments/environment';
import { Channel, TvChannelsService } from '../../services/tv-channels.service';
import { NavigationService } from '../../services/navigation.service';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, RouterLink, FormsModule, NgIconComponent],
    providers: [provideIcons({ matTv, matRadio, matMovie, matSettings })],
    templateUrl: './home.component.html',
    styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit, OnDestroy, AfterViewInit {

    @ViewChildren('channelCard') channelCards!: QueryList<ElementRef>;

    allChannels: Channel[] = [];
    allSeries: Channel[] = [];
    channels: Channel[] = [];
    series: Channel[] = [];
    isLoading = true;
    activeIndex = 0;
    activeSection: 'main' = 'main';
    isTvMode = false;
    isCompactViewport = false;
    appVersion = environment.version;

    searchQuery = '';
    isListening = false;
    private searchTimeout?: any;

    constructor(
        private tvChannelsService: TvChannelsService,
        private router: Router,
        private ngZone: NgZone,
        private navService: NavigationService
    ) { }

    ngOnInit() {
        this.isTvMode = this.detectTvMode();
        this.isCompactViewport = this.detectCompactViewport();

        console.log('[Home] document location:', document.location.toString());

        console.log('[Home] Kanal listesi yükleniyor...');
        this.tvChannelsService.loadChannels().subscribe((data: Channel[]) => {
            const tvChannels = data
                .filter(item => item.category === 'TVChannel')
                .map((item, index) => ({ ...item, originalIndex: index }));
            this.allChannels = tvChannels;
            this.allSeries = data.filter(item => item.category === 'Series');
            this.channels = [...this.allChannels];
            this.series = [...this.allSeries];
            this.isLoading = false;

            console.log(`[Home] Veriler yüklendi: ${this.channels.length} kanal, ${this.series.length} dizi bulundu.`);

            // Wait for view to render
            setTimeout(() => {
                this.activeIndex = 0;
                this.scrollToActive();
            });
        });


    }

    ngAfterViewInit() {
    }

    @HostListener('window:resize')
    onResize() {
        this.isTvMode = this.detectTvMode();
        this.isCompactViewport = this.detectCompactViewport();
    }

    private detectTvMode(): boolean {
        const ua = navigator.userAgent.toLowerCase();
        const tvUserAgent = /(smart-tv|smarttv|hbbtv|appletv|googletv|android tv|aftb|aftm|afts|aftt|dtv|netcast|viera|tizen|web0s|webos|bravia)/.test(ua);
        const largestEdge = Math.max(window.innerWidth, window.innerHeight);
        const smallestEdge = Math.min(window.innerWidth, window.innerHeight);
        const isLargeLandscape = largestEdge >= 1280 && smallestEdge >= 720;
        const isAndroid = ua.includes('android');
        const hasTouch = (navigator.maxTouchPoints || 0) > 0;

        return tvUserAgent || (isAndroid && isLargeLandscape && !hasTouch);
    }

    private detectCompactViewport(): boolean {
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Keep desktop at normal zoom unchanged; compact only when effective viewport gets tight.
        return width <= 1280 || height <= 760;
    }

    @HostListener('window:keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) {
            event.preventDefault();
        }

        switch (event.key) {
            case 'ArrowRight':
                if (this.activeIndex === 0) {
                    this.activeIndex = 1;
                }
                break;
            case 'ArrowLeft':
                if (this.activeIndex >= 1 && this.activeIndex <= 3) {
                    this.activeIndex = 0;
                }
                break;
            case 'ArrowDown':
                if (this.activeIndex === 1) {
                    this.activeIndex = 2;
                } else if (this.activeIndex === 2) {
                    this.activeIndex = 3;
                }
                break;
            case 'ArrowUp':
                if (this.activeIndex === 2) {
                    this.activeIndex = 1;
                } else if (this.activeIndex === 3) {
                    this.activeIndex = 2;
                }
                break;
            case 'Enter':
                this.ngZone.run(() => {
                    if (this.activeIndex === 0) {
                        if (this.channels && this.channels.length > 0) {
                            this.router.navigate(['/tv', this.channels[0].originalIndex || 0]);
                        }
                    }
                    if (this.activeIndex === 1) this.router.navigate(['/radio']);
                    if (this.activeIndex === 2) this.router.navigate(['/series']);
                    if (this.activeIndex === 3) this.router.navigate(['/settings']);
                });
                break;
        }
    }

    scrollToActive() {
    }

    filterResults() {
        const query = this.searchQuery.toLowerCase().trim();
        
        // Yerel filtreleme (hızlı sonuç için)
        if (!query) {
            this.channels = [...this.allChannels];
            this.series = [...this.allSeries];
            this.activeIndex = 0;
            /* this.channelIndex = 0;
            this.seriesIndex = 0;
            this.activeSection = 'channels'; */
            this.scrollToActive();
            return;
        }

        this.channels = this.allChannels.filter(c =>
            c.name.toLowerCase().includes(query) ||
            (c.currentShow && c.currentShow.toLowerCase().includes(query))
        );
        this.series = this.allSeries.filter(s =>
            s.name.toLowerCase().includes(query)
        );

        // API araması (debounced)
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(async () => {
            if (query.length >= 2) {
                const apiResults = await this.tvChannelsService.searchContent(query);
                if (apiResults && apiResults.length > 0) {
                    this.ngZone.run(() => {
                        // API'den gelen sonuçları seriler listesine ekle (veya ayrı bir grupta göster)
                        // Mevcut sonuçlarla birleştiriyoruz, mükerrerleri engelliyoruz
                        apiResults.forEach(apiItem => {
                            if (!this.series.find(s => s.name === apiItem.name)) {
                                this.series.push(apiItem);
                            }
                        });
                        this.activeIndex = 0;
                        /* this.channelIndex = 0;
                        this.seriesIndex = 0;
                        this.activeSection = this.channels.length > 0 ? 'channels' : 'series'; */
                        this.scrollToActive();
                    });
                }
            }
        }, 500);

        this.activeIndex = 0;
        /* this.channelIndex = 0;
        this.seriesIndex = 0;
        this.activeSection = this.channels.length > 0 ? 'channels' : (this.series.length > 0 ? 'series' : 'channels'); */
        this.scrollToActive();
    }

    startSpeechRecognition() {
        if (!navigator.onLine) {
            alert('İnternet bağlantısı yok. Ses tanıma için internet gereklidir.');
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

        if (!SpeechRecognition) {
            alert('Tarayıcınız ses tanıma özelliğini desteklemiyor.');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'tr-TR';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            this.ngZone.run(() => {
                this.isListening = true;
            });
        };

        recognition.onresult = (event: any) => {
            this.ngZone.run(() => {
                const transcript = event.results[0][0].transcript;
                console.log('Ses tanıma sonucu:', transcript);
                this.searchQuery = transcript;
                this.filterResults();
            });
        };

        recognition.onerror = (event: any) => {
            this.ngZone.run(() => {
                console.error('Ses tanıma hatası:', event.error);
                this.isListening = false;

                if (event.error === 'network') {
                    alert('Ses tanıma hatası: İnternet bağlantısı kesildi veya konuşma servislerine ulaşılamıyor.');
                } else if (event.error === 'not-allowed') {
                    alert('Mikrofon izni reddedildi. Lütfen ayarlardan izin verin.');
                } else if (event.error === 'no-speech') {
                    // Sessiz kalındığında hata vermeye gerek yok, sadece dinlemeyi bitir
                } else {
                    alert('Ses tanıma sırasında bir hata oluştu: ' + event.error);
                }
            });
        };

        recognition.onend = () => {
            this.ngZone.run(() => {
                this.isListening = false;
            });
        };

        try {
            recognition.start();
        } catch (e) {
            console.error('Ses tanıma başlatılamadı:', e);
            this.isListening = false;
        }
    }

    ngOnDestroy() {
        this.navService.setSearchSelected(false);
    }

}
