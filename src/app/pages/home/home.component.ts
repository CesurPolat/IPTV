import { Component, OnInit, HostListener, ViewChild, ElementRef, OnDestroy, AfterViewInit, ViewChildren, QueryList } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { Channel, TvChannelsService } from '../../services/tv-channels.service';
import { Updater } from 'capacitor-web-updater';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './home.component.html',
    styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit, OnDestroy, AfterViewInit {

    @ViewChild('channelGrid') channelGrid!: ElementRef;
    @ViewChildren('channelCard') channelCards!: QueryList<ElementRef>;

    channels: Channel[] = [];
    isLoading = true;
    activeIndex = 0;
    columns = 1;

    appVersion: string = "0.2.4";

    constructor(private tvChannelsService: TvChannelsService, private router: Router) { }

    ngOnInit() {

        this.tvChannelsService.loadChannels().subscribe((channels: Channel[]) => {
            this.channels = channels;
            this.isLoading = false;
            // Wait for view to render
            setTimeout(() => {
                this.calculateColumns();

                this.activeIndex = 0;
                this.scrollToActive();
            });
        });

        Updater.echo({ value: 'Capacitor Web Updater is ready!' });

        Updater.isLatestVersion({ value: this.appVersion }).then((result) => {
            if (!result.value) {
                console.log('Yeni bir güncelleme mevcut');
                // Burada kullanıcıya güncelleme yapması için bir bildirim gösterebilirsiniz
                Updater.getLatestVersion().then((latestVersion) => {
                    console.log('En son sürüm:', latestVersion.value);
                    document.location.href = 'index.html';
                });

            } else {
                console.log('Uygulama en son sürümde.');
            }
        }).catch((error) => {
            console.error('Güncelleme kontrolü sırasında hata oluştu:', error);
        });
    }

    ngAfterViewInit() {
        this.channelCards.changes.subscribe(() => {
            this.calculateColumns();
        });
    }

    @HostListener('window:resize')
    onResize() {
        this.calculateColumns();
    }

    calculateColumns() {
        if (this.channelCards && this.channelCards.length > 0) {
            const first = this.channelCards.get(0)?.nativeElement.getBoundingClientRect();
            if (!first) return;

            let colCount = 1;
            for (let i = 1; i < this.channelCards.length; i++) {
                const current = this.channelCards.get(i)?.nativeElement.getBoundingClientRect();
                if (current.top > first.top + 10) { // +10 for some tolerance
                    break;
                }
                colCount++;
            }
            this.columns = colCount;
        }
    }

    @HostListener('window:keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent) {
        if (this.channels.length === 0) return;

        // Prevent default scrolling for arrow keys
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
        }

        switch (event.key) {
            case 'ArrowRight':
                this.activeIndex = (this.activeIndex + 1) % this.channels.length;
                this.scrollToActive();
                break;
            case 'ArrowLeft':
                this.activeIndex = (this.activeIndex - 1 + this.channels.length) % this.channels.length;
                this.scrollToActive();
                break;
            case 'ArrowUp':
                if (this.activeIndex - this.columns >= 0) {
                    this.activeIndex -= this.columns;
                    this.scrollToActive();
                }
                break;
            case 'ArrowDown':
                if (this.activeIndex + this.columns < this.channels.length) {
                    this.activeIndex += this.columns;
                    this.scrollToActive();
                }
                break;
            case 'Enter':
                this.router.navigate(['/tv', this.activeIndex]);
                break;
        }
    }

    scrollToActive() {
        const activeCard = this.channelCards.get(this.activeIndex);
        if (activeCard) {
            activeCard.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    ngOnDestroy() {

    }

}
