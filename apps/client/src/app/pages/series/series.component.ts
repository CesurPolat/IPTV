import { Component, OnInit, OnDestroy, HostListener, ViewChild, ViewChildren, QueryList, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TvChannelsService, DizipalSeriesDetail, DizipalSeason, DizipalEpisode, ShortizleCatalog, ShortizleSearchQuery, ShortizleSearchResult, ShortizleSearchOptions } from '../../services/tv-channels.service';
import { NavigationService } from '../../services/navigation.service';
import { Subscription } from 'rxjs';
import { SeriesProgress, SeriesProgressService } from '../../services/series-progress.service';
import { SeriesFilterComponent } from './series-filter.component';

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
  imports: [CommonModule, RouterLink, FormsModule, SeriesFilterComponent],
  templateUrl: './series.component.html',
  styleUrl: './series.component.scss'
})
export class SeriesComponent implements OnInit, OnDestroy {
  @ViewChild('filterToggle') filterToggle?: ElementRef<HTMLButtonElement>;
  filtersExpanded = false;
  private closingFilters = false;
  @ViewChildren('continueCard') continueCards!: QueryList<ElementRef<HTMLButtonElement>>;
  continueWatching: SeriesProgress[] = [];
  continueError = '';
  continueLoading = false;
  @ViewChildren('episodeCard') episodeCards!: QueryList<ElementRef>;
  @ViewChildren('seasonTab') seasonTabs!: QueryList<ElementRef>;
  @ViewChildren('catalogCard') catalogCards!: QueryList<ElementRef>;
  @ViewChildren('filterControl', { read: ElementRef }) filterControls!: QueryList<ElementRef<HTMLElement>>;
  @ViewChildren(SeriesFilterComponent) filterMenus!: QueryList<SeriesFilterComponent>;
  @ViewChildren('resultsAction') resultsActions!: QueryList<ElementRef<HTMLButtonElement>>;
  private lastFilterIndex = 0;
  catalog: ShortizleCatalog | null = null;
  archiveMode = false;
  archiveResult: ShortizleSearchResult | null = null;
  archiveQuery: ShortizleSearchQuery = { q: '', genres: [], platform: '', kind: 'dublaj', sort: 'popular', view: 'grid', page: 1 };
  filterOptions: ShortizleSearchOptions = { genres: [], platforms: [] };
  error = '';
  playbackError = '';
  activeCollectionIndex = 0;
  activeTitleIndex = 0;
  private routeSubscription?: Subscription;
  private loadVersion = 0;
  loadingMore = false;
  loadMoreError = '';
  private archiveEnded = false;
  private loadedArchiveQuery?: ShortizleSearchQuery;
  private archiveObserver?: IntersectionObserver;
  private archiveSentinel?: HTMLElement;
  private observeFrame?: number;
  private destroyed = false;

  @ViewChild('archiveSentinel') set sentinel(ref: ElementRef<HTMLElement> | undefined) {
    this.archiveObserver?.disconnect();
    this.archiveSentinel = ref?.nativeElement;
    if (!this.archiveSentinel || typeof IntersectionObserver === 'undefined') return;
    this.archiveObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !this.loadMoreError)
        this.zone.run(() => { void this.loadNextArchivePage(); });
    }, { rootMargin: '600px 0px' });
    this.archiveObserver.observe(this.archiveSentinel);
  }

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
    private navService: NavigationService,
    private zone: NgZone,
    private progress: SeriesProgressService
  ) {}

  ngOnInit() {
    this.routeSubscription = this.route.queryParams.subscribe(params => {
      this.archiveObserver?.disconnect();
      if (this.observeFrame !== undefined) cancelAnimationFrame(this.observeFrame);
      this.loadingMore = false;
      this.loadMoreError = '';
      this.seriesUrl = params['url'] || '';
      this.continueWatching = this.progress.list();
      this.continueError = '';
      this.archiveMode = params['collections'] !== '1';
      this.seriesData = null;
      this.playbackError = '';
      this.seasons = [];
      this.selectedSeason = null;
      this.filterMenus?.forEach(menu => { menu.isOpen = false; });
      if (this.seriesUrl) {
        this.fetchSeriesDetails();
      } else if (this.archiveMode) {
        this.archiveQuery = { q: params['q'] || '', genres: params['genres'] ? [params['genres']].flat() : [],
          platform: params['platform'] || '', kind: params['kind'] ?? 'dublaj', sort: params['sort'] || 'popular',
          view: params['view'] || 'grid', page: Number(params['page']) || 1 };
        this.fetchArchive();
      } else {
        this.archiveQuery = { q: '', genres: [], platform: '', kind: 'dublaj', sort: 'popular', view: 'grid', page: 1 };
        this.fetchCatalog();
      }
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.routeSubscription?.unsubscribe(); this.loadVersion++;
    this.archiveObserver?.disconnect();
    if (this.observeFrame !== undefined) cancelAnimationFrame(this.observeFrame);
  }

  goBack() {
    this.navService.back(this.seriesUrl || this.archiveMode ? '/series' : '/home');
  }

  async fetchCatalog() {
    const version = ++this.loadVersion;
    this.isLoading = true;
    this.error = '';
    try {
      const catalog = await this.tvChannelsService.getShortizleCollections();
      if (version !== this.loadVersion) return;
      this.catalog = catalog;
      this.filterOptions = catalog.options || this.filterOptions;
      this.activeCollectionIndex = 0;
      this.activeTitleIndex = 0;
    } catch {
      if (version === this.loadVersion) this.error = 'Koleksiyonlar yüklenemedi. Lütfen tekrar deneyin.';
    } finally {
      if (version === this.loadVersion) this.isLoading = false;
    }
  }

  retry() { this.seriesUrl ? this.fetchSeriesDetails() : this.archiveMode ? this.fetchArchive() : this.fetchCatalog(); }

  searchArchive(page = 1) {
    this.router.navigate(['/series'], { queryParams: { archive: '1', ...this.archiveQuery, page } });
  }

  resetArchive() { this.router.navigate(['/series'], { queryParams: { collections: '1' } }); }

  async fetchArchive() {
    const version = ++this.loadVersion;
    this.isLoading = true;
    this.error = '';
    this.archiveResult = null;
    this.loadingMore = false;
    this.loadMoreError = '';
    this.archiveEnded = false;
    this.loadedArchiveQuery = { ...this.archiveQuery, genres: [...(this.archiveQuery.genres || [])] };
    try {
      const result = await this.tvChannelsService.searchShortizle(this.loadedArchiveQuery);
      if (version !== this.loadVersion) return;
      this.archiveResult = result;
      this.archiveEnded = result.items.length === 0;
      this.filterOptions = result.options;
      this.activeTitleIndex = this.activeCollectionIndex = 0;
    } catch {
      if (version === this.loadVersion) this.error = 'Dizi araması yapılamadı. Lütfen tekrar deneyin.';
    } finally { if (version === this.loadVersion) this.isLoading = false; }
  }

  get hasMoreArchive(): boolean {
    return !!this.archiveResult && !this.archiveEnded && this.archiveResult.page < this.archiveResult.lastPage;
  }

  async loadNextArchivePage() {
    if (this.destroyed || this.seriesUrl || !this.archiveMode || this.isLoading || this.loadingMore || !this.hasMoreArchive || !this.loadedArchiveQuery) return;
    const version = this.loadVersion;
    const current = this.archiveResult!;
    const page = current.page + 1;
    this.loadingMore = true;
    this.loadMoreError = '';
    try {
      // Use submitted filters, not edits that have not been applied yet.
      const result = await this.tvChannelsService.searchShortizle({ ...this.loadedArchiveQuery, page });
      if (version !== this.loadVersion) return;
      if (result.page !== page) throw new Error('Unexpected archive page');
      const seen = new Set(current.items.map(item => item.url));
      const additions = result.items.filter(item => {
        if (seen.has(item.url)) return false;
        seen.add(item.url); return true;
      });
      this.archiveResult = { ...result, items: [...current.items, ...additions] };
      this.archiveEnded = result.items.length === 0;
      // Recheck after rendering: short pages may leave the sentinel visible.
      this.observeFrame = requestAnimationFrame(() => {
        if (version !== this.loadVersion || !this.archiveSentinel || !this.hasMoreArchive) return;
        this.archiveObserver?.unobserve(this.archiveSentinel);
        this.archiveObserver?.observe(this.archiveSentinel);
      });
    } catch {
      if (version === this.loadVersion) this.loadMoreError = 'Diğer diziler yüklenemedi. Tekrar deneyin.';
    } finally {
      if (version === this.loadVersion) this.loadingMore = false;
    }
  }

  async fetchSeriesDetails() {
    const version = ++this.loadVersion;
    this.isLoading = true;
    this.error = '';
    try {
      const result = await this.tvChannelsService.getSeriesDetails(this.seriesUrl);
      if (version !== this.loadVersion) return;
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
      } else this.error = 'Dizi detayları yüklenemedi. Lütfen tekrar deneyin.';
      this.isLoading = false;
    } catch (error) {
      if (version !== this.loadVersion) return;
      console.error('Error fetching series details:', error);
      this.error = 'Dizi detayları yüklenemedi. Lütfen tekrar deneyin.';
      this.isLoading = false;
    }
  }

  selectSeason(index: number) {
    this.activeSeasonIndex = index;
    this.selectedSeason = this.seasons[index];
    this.activeEpisodeIndex = 0;
  }

  async playEpisode(episode: Episode, index: number) {
    this.playbackError = '';
    this.activeEpisodeIndex = index;
    this.activeSection = 'episodes';
    
    try {
      this.isLoading = true;
      const mediaUrl = await this.tvChannelsService.getVideoUrl(episode.source);
      this.router.navigate(['/player'], { queryParams: {
        url: mediaUrl, series: this.seriesUrl, season: this.selectedSeason?.id, episode: episode.id,
        seriesName: this.seriesData?.name || '', seriesImage: this.seriesData?.image || ''
      } });
    } catch (error) {
      console.error('Error playing episode:', error);
      this.playbackError = error instanceof Error ? error.message : 'Bölüm oynatılamadı. Lütfen tekrar deneyin.';
    } finally {
      this.isLoading = false;
    }
  }

  async resumeSeries(item: SeriesProgress) {
    if (this.continueLoading) return;
    this.continueLoading = true;
    this.continueError = '';
    try {
      const detail = await this.tvChannelsService.getSeriesDetails(item.series);
      const seasons = detail ? (Array.isArray(detail.containsSeason) ? detail.containsSeason : detail.containsSeason ? [detail.containsSeason] : []) : [];
      const season = seasons.find(s => s.seasonNumber === item.season);
      const episodes = season ? (Array.isArray(season.episode) ? season.episode : season.episode ? [season.episode] : []) : [];
      const episode = episodes.find(e => e.episodeNumber === item.episode);
      if (!episode?.url) throw new Error('Kayıtlı bölüm bulunamadı. Dizi listesinden başka bir bölüm seçebilirsiniz.');
      let url = await this.tvChannelsService.getVideoUrl(episode.url);
      if (item.source && Number.isSafeInteger(item.source) && item.source > 0) url = await this.tvChannelsService.getAlternativeSource(url, item.source);
      if (this.destroyed) return;
      const navigated = await this.router.navigate(['/player'], { queryParams: {
        url, series: item.series, season: item.season, episode: item.episode,
        seriesName: detail?.name || item.name, seriesImage: detail?.image || item.image,
        ...(item.source ? { manualSource: '1', selectedSource: item.source } : {})
      } });
      if (!navigated) throw new Error('Bölüm açılamadı.');
    } catch (error) {
      if (!this.destroyed) this.continueError = error instanceof Error ? error.message : 'Bölüm açılamadı. Lütfen tekrar deneyin.';
    } finally { this.continueLoading = false; }
  }

  handleContinueKey(event: KeyboardEvent, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const next = Math.max(0, Math.min(this.continueWatching.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
      this.continueCards.toArray()[next]?.nativeElement.focus();
    } else if (event.key === 'ArrowUp') this.focusFilter(this.lastFilterIndex);
    else (this.catalogCards?.first?.nativeElement || this.resultsActions?.first?.nativeElement)?.focus();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    const openMenu = this.filterMenus?.find(menu => menu.isOpen);
    if (openMenu) { openMenu.handleKey(event); return; }
    if (event.defaultPrevented) return;
    if (event.key === 'Backspace' || event.key === 'Escape') {
      if (event.key === 'Backspace' && (event.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (!this.seriesUrl && this.filtersExpanded) {
        event.preventDefault();
        this.filtersExpanded = false;
        this.closingFilters = true;
        this.filterToggle?.nativeElement.focus();
        this.closingFilters = false;
        return;
      }
      event.preventDefault();
      this.goBack();
      return;
    }
    if ((event.target as HTMLElement | null)?.closest?.('form, input, select, textarea, button')) return;
    if (this.isLoading || this.error) return;
    if (!this.seriesUrl) { this.handleCatalogKey(event); return; }
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
    }
    this.scrollToActive();
  }

  private handleCatalogKey(event: KeyboardEvent) {
    const collections = this.archiveMode ? [{ items: this.archiveResult?.items || [] }] : this.catalog?.collections || [];
    if (!collections.length) return;
    if (!collections[this.activeCollectionIndex]?.items.length) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) event.preventDefault();
    switch (event.key) {
      case 'ArrowRight': this.activeTitleIndex = Math.min(this.activeTitleIndex + 1, collections[this.activeCollectionIndex].items.length - 1); break;
      case 'ArrowLeft': this.activeTitleIndex = Math.max(0, this.activeTitleIndex - 1); break;
      case 'ArrowDown':
        if (this.archiveMode) {
          if (this.loadMoreError && this.activeTitleIndex + this.archiveColumns() >= collections[0].items.length) {
            this.resultsActions?.first?.nativeElement.focus();
            return;
          }
          if (this.activeTitleIndex + this.archiveColumns() >= collections[0].items.length && !this.loadMoreError)
            void this.loadNextArchivePage();
          this.activeTitleIndex = Math.min(this.activeTitleIndex + this.archiveColumns(), collections[0].items.length - 1);
        }
        else this.activeCollectionIndex = Math.min(this.activeCollectionIndex + 1, collections.length - 1);
        break;
      case 'ArrowUp':
        if ((this.archiveMode && this.activeTitleIndex < this.archiveColumns()) || (!this.archiveMode && this.activeCollectionIndex === 0)) {
          if (this.continueCards?.first) this.continueCards.first.nativeElement.focus(); else this.focusFilter(this.lastFilterIndex); return;
        }
        if (this.archiveMode) this.activeTitleIndex = Math.max(0, this.activeTitleIndex - this.archiveColumns());
        else this.activeCollectionIndex = Math.max(0, this.activeCollectionIndex - 1);
        break;
      case 'Enter':
        this.router.navigate(['/series'], { queryParams: { url: collections[this.activeCollectionIndex].items[this.activeTitleIndex].url } });
        return;
      default: return;
    }
    this.activeTitleIndex = Math.min(this.activeTitleIndex, collections[this.activeCollectionIndex].items.length - 1);
    const offset = collections.slice(0, this.activeCollectionIndex).reduce((sum, row) => sum + row.items.length, 0);
    this.catalogCards.toArray()[offset + this.activeTitleIndex]?.nativeElement.focus({ preventScroll: true });
    this.catalogCards.toArray()[offset + this.activeTitleIndex]?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  private controls(): HTMLElement[] {
    return this.filterControls?.toArray().map(ref => ref.nativeElement.matches('input, button')
      ? ref.nativeElement : ref.nativeElement.querySelector<HTMLElement>('button')!)
      .filter(element => !!element && !(element as HTMLButtonElement).disabled) || [];
  }

  rememberFilterFocus() {
    const index = this.controls().findIndex(element => element === document.activeElement);
    if (index >= 0) this.lastFilterIndex = index;
  }

  private focusFilter(index: number) {
    if (!this.filtersExpanded) {
      this.filterToggle?.nativeElement.focus();
      this.filterToggle?.nativeElement.scrollIntoView({ block: 'nearest' });
      return;
    }
    const controls = this.controls();
    const target = controls[Math.min(index, controls.length - 1)];
    target?.focus(); target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  openFiltersOnFocus() {
    if (!this.closingFilters) this.filtersExpanded = true;
  }

  filterToggleDown(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (this.filtersExpanded) this.focusFilter(this.lastFilterIndex);
    else (this.continueCards?.first?.nativeElement || this.catalogCards?.first?.nativeElement || this.resultsActions?.first?.nativeElement)?.focus();
  }

  handleFilterKey(event: KeyboardEvent) {
    if (!event.key.startsWith('Arrow')) return;
    const controls = this.controls();
    const index = controls.findIndex(element => element === document.activeElement);
    if (index < 0) return;
    const current = controls[index];
    if (current.tagName === 'INPUT' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const rect = current.getBoundingClientRect();
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const candidates = controls.map((element, i) => {
      const next = element.getBoundingClientRect();
      const dx = (next.left + next.right - rect.left - rect.right) / 2;
      const dy = (next.top + next.bottom - rect.top - rect.bottom) / 2;
      const distance = (horizontal ? dx : dy) * sign;
      return { i, distance, score: distance + Math.abs(horizontal ? dy : dx) * 3 };
    }).filter(candidate => candidate.distance > 5).sort((a, b) => a.score - b.score);
    if (candidates.length) this.focusFilter(candidates[0].i);
    else if (event.key === 'ArrowDown') {
      const target = this.continueCards?.first?.nativeElement || this.catalogCards?.first?.nativeElement || this.resultsActions?.find(action => !action.nativeElement.disabled)?.nativeElement;
      target?.focus(); target?.scrollIntoView({ block: 'nearest' });
    }
  }

  private archiveColumns(): number {
    const cards = this.catalogCards.toArray();
    const top = cards[0]?.nativeElement.getBoundingClientRect().top;
    return Math.max(1, cards.filter(card => Math.abs(card.nativeElement.getBoundingClientRect().top - top) < 10).length);
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
