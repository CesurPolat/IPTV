import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TvChannelsService, Channel } from '../../services/tv-channels.service';

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
          <div class="result-card" *ngFor="let item of results" [routerLink]="['/player']" [queryParams]="{ url: item.source }">
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
      transition: transform 0.3s;

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
      h3 { margin: 0; font-size: 1rem; color: white; }
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
export class SearchComponent implements OnInit {
  query: string = '';
  results: Channel[] = [];
  isLoading: boolean = false;

  constructor(
    private route: ActivatedRoute,
    private tvChannelsService: TvChannelsService
  ) {}

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      this.query = params['q'] || '';
      if (this.query) {
        this.performSearch();
      }
    });
  }

  async performSearch() {
    this.isLoading = true;
    try {
      this.results = await this.tvChannelsService.searchContent(this.query);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      this.isLoading = false;
    }
  }
}
