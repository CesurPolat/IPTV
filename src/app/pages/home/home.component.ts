import { Component, OnInit, HostListener, ViewChild, ElementRef, OnDestroy, AfterViewInit, ViewChildren, QueryList, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Channel, TvChannelsService } from '../../services/tv-channels.service';
import { Updater } from 'capacitor-web-updater';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, RouterLink, FormsModule],
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
    activeSection: 'channels' | 'series' = 'channels';

    searchQuery = '';
    isListening = false;
    private searchTimeout?: any;

    constructor(
        private tvChannelsService: TvChannelsService,
        private router: Router,
        private ngZone: NgZone
    ) { }

    ngOnInit() {

        console.log('[Home] document location:', document.location.toString());

        console.log('[Home] Kanal listesi yükleniyor...');
        this.tvChannelsService.loadChannels().subscribe((data: Channel[]) => {
            const dataWithIndex = data.map((item, index) => ({ ...item, originalIndex: index }));
            this.allChannels = dataWithIndex.filter(item => item.category !== 'Series');
            this.allSeries = dataWithIndex.filter(item => item.category === 'Series');
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
    }

    @HostListener('window:keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent) {
        const currentData = this.activeSection === 'channels' ? this.channels : this.series;
        if (currentData.length === 0 && this.activeSection !== 'channels') return;

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
        }

        switch (event.key) {
            case 'ArrowRight':
                if (this.activeIndex < currentData.length - 1) {
                    this.activeIndex++;
                }
                break;
            case 'ArrowLeft':
                if (this.activeIndex > 0) {
                    this.activeIndex--;
                }
                break;
            case 'ArrowUp':
                if (this.activeSection === 'series') {
                    this.activeSection = 'channels';
                    this.activeIndex = Math.min(this.activeIndex, this.channels.length - 1);
                }
                break;
            case 'ArrowDown':
                if (this.activeSection === 'channels' && this.series.length > 0) {
                    this.activeSection = 'series';
                    this.activeIndex = Math.min(this.activeIndex, this.series.length - 1);
                }
                break;
            case 'Enter':
                if (this.activeSection === 'channels') {
                    const channel = this.channels[this.activeIndex];
                    this.router.navigate(['/tv', channel.originalIndex]);
                } else {
                    const seriesItem = this.series[this.activeIndex];
                    // Diziler için yeni hazırladığımız player'a yönlendiriyoruz
                    this.router.navigate(['/player'], { queryParams: { url: seriesItem.source } });
                }
                break;
        }
        this.scrollToActive();
    }

    scrollToActive() {
        setTimeout(() => {
            const cards = this.channelCards.toArray();
            const indexOffset = this.activeSection === 'series' ? this.channels.length : 0;
            const targetCard = cards[this.activeIndex + indexOffset];

            if (targetCard) {
                targetCard.nativeElement.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center',
                    inline: 'center'
                });
            }
        });
    }

    filterResults() {
        const query = this.searchQuery.toLowerCase().trim();
        
        // Yerel filtreleme (hızlı sonuç için)
        if (!query) {
            this.channels = [...this.allChannels];
            this.series = [...this.allSeries];
            this.activeIndex = 0;
            this.activeSection = 'channels';
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
                        this.activeSection = this.channels.length > 0 ? 'channels' : 'series';
                        this.scrollToActive();
                    });
                }
            }
        }, 500);

        this.activeIndex = 0;
        this.activeSection = this.channels.length > 0 ? 'channels' : (this.series.length > 0 ? 'series' : 'channels');
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

    }

}
