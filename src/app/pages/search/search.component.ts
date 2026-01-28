import { Component, OnInit, OnDestroy, HostListener, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { TvChannelsService, Channel } from '../../services/tv-channels.service';
import { NavigationService } from '../../services/navigation.service';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="search-page">
      <div class="container">
        <h2 class="search-title" *ngIf="query">"{{query}}" için arama sonuçları</h2>
        
        <div *ngIf="isLoading" class="loading">Aranıyor...</div>

        <div *ngIf="!isLoading && results.length === 0" class="no-results">
          Sonuç bulunamadı.
        </div>

        <div class="results-grid" *ngIf="results.length > 0">
          <div class="result-card" *ngFor="let item of results; let i = index" 
               #resultCard
               [class.active]="activeSection === 'results' && i === activeIndex"
               [routerLink]="['/player']" [queryParams]="{ url: item.source }">
            <div class="image-wrapper">
              <img [src]="item.poster" [alt]="item.name" onerror="this.src='assets/placeholder.jpg'">
              <div class="overlay">
                <span class="play-btn">▶</span>
              </div>
            </div>
            <div class="card-info">
              <h3>{{item.name}}</h3>
              <p>{{item.category}}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .search-page {
      padding: 2rem;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    .search-title {
      margin-bottom: 2rem;
      font-size: 1.5rem;
      color: #eee;
    }
    .results-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 20px;
    }
    .result-card {
      background: #1a1a1a;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.5, 0, 0.1, 1);
      border: 3px solid transparent;

      &.active {
        transform: scale(1.08);
        border-color: #e50914;
        z-index: 10;
        box-shadow: 0 10px 20px rgba(0,0,0,0.5);
        .overlay { opacity: 1; }
      }

      &:hover {
        transform: scale(1.05);
        .overlay { opacity: 1; }
      }
    }
    .image-wrapper {
      position: relative;
      aspect-ratio: 2/3;
      img { width: 100%; height: 100%; object-fit: cover; }
    }
    .overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      opacity: 0;
      transition: opacity 0.3s;
    }
    .play-btn { font-size: 3rem; color: white; }
    .card-info {
      padding: 10px;
      h3 { margin: 0; font-size: 1rem; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      p { margin: 5px 0 0; font-size: 0.8rem; color: #888; }
    }
    .loading, .no-results {
      text-align: center;
      padding: 3rem;
      font-size: 1.2rem;
      color: #888;
    }
  `]
})
export class SearchComponent implements OnInit, OnDestroy {
  @ViewChildren('resultCard') resultCards!: QueryList<ElementRef>;
  query: string = '';
  results: Channel[] = [];
  isLoading: boolean = false;
  activeIndex: number = 0;
  activeSection: 'search_bar' | 'results' = 'results';
  columns: number = 0;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private tvChannelsService: TvChannelsService,
    private navService: NavigationService
  ) {
    if (this.navService.getSearchSelected()) {
      this.activeSection = 'search_bar';
    }
  }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      this.query = params['q'] || '';
      if (this.query) {
        this.performSearch();
      }
    });
  }

  ngOnDestroy() {
    this.navService.setSearchSelected(false);
  }

  calculateColumns() {
    if (this.resultCards && this.resultCards.length > 0) {
      const first = this.resultCards.get(0)?.nativeElement.getBoundingClientRect();
      const container = document.querySelector('.results-grid')?.getBoundingClientRect();
      if (!first || !container) return;

      let colCount = 1;
      for (let i = 1; i < this.resultCards.length; i++) {
        const current = this.resultCards.get(i)?.nativeElement.getBoundingClientRect();
        if (current.top > first.top + 10) break;
        colCount++;
      }
      this.columns = colCount;
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (document.activeElement?.tagName === 'INPUT' && event.key !== 'Escape' && event.key !== 'Enter') {
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
    }

    if (event.key === 'Escape') {
      (document.activeElement as HTMLElement)?.blur();
      return;
    }

    this.calculateColumns();

    switch (event.key) {
      case 'ArrowRight':
        if (this.activeSection === 'results' && this.activeIndex < this.results.length - 1) {
          this.activeIndex++;
        }
        break;
      case 'ArrowLeft':
        if (this.activeSection === 'results' && this.activeIndex > 0) {
          this.activeIndex--;
        }
        break;
      case 'ArrowUp':
        if (this.activeSection === 'results') {
          if (this.activeIndex - this.columns >= 0) {
            this.activeIndex -= this.columns;
          } else {
            this.activeSection = 'search_bar';
            this.navService.setSearchSelected(true);
          }
        }
        break;
      case 'ArrowDown':
        if (this.activeSection === 'search_bar') {
          this.activeSection = 'results';
          this.navService.setSearchSelected(false);
          this.activeIndex = 0;
        } else if (this.activeSection === 'results' && this.activeIndex + this.columns < this.results.length) {
          this.activeIndex += this.columns;
        }
        break;
      case 'Enter':
        if (this.activeSection === 'results') {
          const item = this.results[this.activeIndex];
          this.router.navigate(['/player'], { queryParams: { url: item.source } });
        }
        break;
    }
    this.scrollToActive();
  }

  scrollToActive() {
    setTimeout(() => {
      const targetCard = this.resultCards.toArray()[this.activeIndex];
      if (targetCard && this.activeSection === 'results') {
        targetCard.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  async performSearch() {
    this.isLoading = true;
    this.activeIndex = 0;
    this.activeSection = 'results';
    try {
      this.results = await this.tvChannelsService.searchContent(this.query);
      setTimeout(() => this.calculateColumns(), 100);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      this.isLoading = false;
    }
  }
}
