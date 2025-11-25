import { Component, OnInit, HostListener, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Channel, TvChannelsService } from '../../services/tv-channels.service';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './home.component.html',
    styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit, OnDestroy {


    constructor(private tvChannelsService: TvChannelsService) { }

    channels: Channel[] = [];
    isLoading = true;

    ngOnInit() {
        this.tvChannelsService.loadChannels().subscribe((channels: Channel[]) => {
            this.channels = channels;
            this.isLoading = false;
        });
    }

    ngOnDestroy() {

    }

}
