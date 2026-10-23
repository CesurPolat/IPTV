import { Component, OnInit, OnDestroy, HostListener, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TvChannelsService, DizipalSeriesDetail, DizipalSeason, DizipalEpisode } from '../../services/tv-channels.service';
import { NavigationService } from '../../services/navigation.service';

interface Episode {
  id: string;
  name: string;
  source: string;
  description?: string;
}

interface Season {
  id: string;
  name: string;
  episodes: Episode[];
}

@Component({
  selector: 'app-series',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './series.component.html',
  styleUrl: './series.component.scss'
})
export class SeriesComponent implements OnInit, OnDestroy {
  @ViewChildren('episodeCard') episodeCards!: QueryList<ElementRef>;
  @ViewChildren('seasonTab') seasonTabs!: QueryList<ElementRef>;

  seriesUrl: string = '';
  seriesData: DizipalSeriesDetail | null = null;
  seasons: Season[] = [];
  selectedSeason: Season | null = null;
  isLoading: boolean = true;

  activeSection: 'seasons' | 'episodes' = 'episodes';
  activeSeasonIndex: number = 0;
  activeEpisodeIndex: number = 0;
  columns: number = 4;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private tvChannelsService: TvChannelsService,
    private navService: NavigationService
  ) {}

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      this.seriesUrl = params['url'] || '';
      if (this.seriesUrl) {
        this.fetchSeriesDetails();
      }
    });
  }

  ngOnDestroy() {}

  async fetchSeriesDetails() {
    this.isLoading = true;
    try {
      const result = await this.tvChannelsService.getSeriesDetails(this.seriesUrl);
      if (result) {
        this.seriesData = result;
        
        // Handle single or array for seasons
        const apiSeasons = Array.isArray(result.containsSeason) 
          ? result.containsSeason 
          : result.containsSeason ? [result.containsSeason] : [];

        this.seasons = apiSeasons.map((s: DizipalSeason) => {
          // Handle single or array for episodes
          const apiEpisodes = Array.isArray(s.episode) 
            ? s.episode 
            : s.episode ? [s.episode] : [];

          return {
            id: s.seasonNumber.toString(),
            name: `${s.seasonNumber}. Sezon`,
            episodes: apiEpisodes.map((e: DizipalEpisode) => ({
              id: e.episodeNumber.toString(),
              name: e.name || `${e.episodeNumber}. Bölüm`,
              source: e.url,
              description: e.description
            }))
          };
        });

        if (this.seasons.length > 0) {
          this.selectedSeason = this.seasons[0];
          this.activeSection = 'seasons';
          this.activeSeasonIndex = 0;
        }
      }
      this.isLoading = false;
    } catch (error) {
      console.error('Error fetching series details:', error);
      this.isLoading = false;
    }
  }

  selectSeason(index: number) {
    this.activeSeasonIndex = index;
    this.selectedSeason = this.seasons[index];
    this.activeEpisodeIndex = 0;
  }

  async playEpisode(episode: Episode, index: number) {
    this.activeEpisodeIndex = index;
    this.activeSection = 'episodes';
    
    try {
      this.isLoading = true;
      const mediaUrl = await this.tvChannelsService.getVideoUrl(episode.source);
      this.router.navigate(['/player'], { queryParams: { url: mediaUrl } });
    } catch (error) {
      console.error('Error playing episode:', error);
      this.router.navigate(['/player'], { queryParams: { url: episode.source } });
    } finally {
      this.isLoading = false;
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
    }

    switch (event.key) {
      case 'ArrowRight':
        if (this.activeSection === 'seasons') {
          if (this.activeSeasonIndex < this.seasons.length - 1) {
            this.selectSeason(this.activeSeasonIndex + 1);
          }
        } else {
          if (this.activeEpisodeIndex < (this.selectedSeason?.episodes.length || 0) - 1) {
            this.activeEpisodeIndex++;
          }
        }
        break;
      case 'ArrowLeft':
        if (this.activeSection === 'seasons') {
          if (this.activeSeasonIndex > 0) {
            this.selectSeason(this.activeSeasonIndex - 1);
          }
        } else {
          if (this.activeEpisodeIndex > 0) {
            this.activeEpisodeIndex--;
          }
        }
        break;
      case 'ArrowUp':
        if (this.activeSection === 'episodes') {
          if (this.activeEpisodeIndex - this.columns >= 0) {
            this.activeEpisodeIndex -= this.columns;
          } else {
            this.activeSection = 'seasons';
          }
        }
        break;
      case 'ArrowDown':
        if (this.activeSection === 'seasons') {
          if (this.selectedSeason && this.selectedSeason.episodes.length > 0) {
            this.activeSection = 'episodes';
            this.activeEpisodeIndex = 0;
          }
        } else {
          if (this.activeEpisodeIndex + this.columns < (this.selectedSeason?.episodes.length || 0)) {
            this.activeEpisodeIndex += this.columns;
          }
        }
        break;
      case 'Enter':
        if (this.activeSection === 'episodes' && this.selectedSeason) {
          const episode = this.selectedSeason.episodes[this.activeEpisodeIndex];
          this.playEpisode(episode, this.activeEpisodeIndex);
        } else if (this.activeSection === 'seasons') {
          this.activeSection = 'episodes';
          this.activeEpisodeIndex = 0;
        }
        break;
      case 'Backspace':
      case 'Escape':
        this.router.navigate(['/search']);
        break;
    }
    this.scrollToActive();
  }

  scrollToActive() {
    setTimeout(() => {
      let target;
      if (this.activeSection === 'seasons') {
        target = this.seasonTabs.toArray()[this.activeSeasonIndex];
      } else {
        target = this.episodeCards.toArray()[this.activeEpisodeIndex];
      }
      
      if (target) {
        target.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
}
