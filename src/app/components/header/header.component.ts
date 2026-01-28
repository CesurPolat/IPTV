import { Component, Input, Output, EventEmitter, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AppComponent } from '../../app.component';
import { NavigationService } from '../../services/navigation.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <header class="header">
      <h1 routerLink="/home" style="cursor: pointer;">IPTV</h1>
      <div class="search-container" [class.active]="isSearchActive">
        <input type="text" #searchInput [(ngModel)]="searchQuery" (ngModelChange)="onSearch()" 
               (focus)="onInputFocus()"
               placeholder="Kanal veya dizi ara..." class="search-input">
        <button (click)="onSearch()" class="search-button">
          <span class="search-icon">🔍</span>
        </button>
      </div>
      <!-- <div class="nav-links">
        <a routerLink="/home" routerLinkActive="active">Ana Sayfa</a>
        <a routerLink="/search" routerLinkActive="active">Arama</a>
      </div> -->
      <div class="version-display">
        v{{ app.appVersion }}
      </div>
    </header>
  `,
  styles: [`
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 2rem;
      background: #141414;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      position: sticky;
      top: 0;
      z-index: 1000;

      h1 {
        font-size: 1.8rem;
        font-weight: 700;
        margin: 0;
        background: linear-gradient(45deg, #ff6b6b, #feca57);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }
    }

    .search-container {
      display: flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.1);
      padding: 5px 15px;
      border-radius: 25px;
      border: 2px solid transparent;
      width: 300px;
      transition: all 0.3s ease;

      &.active {
        border-color: #e50914;
        background: rgba(255, 255, 255, 0.2);
        box-shadow: 0 0 10px rgba(229, 9, 20, 0.5);
      }
    }

    .search-input {
      background: transparent;
      border: none;
      color: white;
      padding: 8px;
      width: 100%;
      outline: none;
      font-size: 0.9rem;
    }

    .search-button {
      background: transparent;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 1.1rem;
    }

    .nav-links {
      display: flex;
      gap: 20px;
      
      a {
        color: #ddd;
        text-decoration: none;
        font-weight: 500;
        transition: color 0.3s;
        
        &.active {
          color: #ff6b6b;
          border-bottom: 2px solid #ff6b6b;
        }

        &:hover {
          color: white;
        }
      }
    }

    .version-display {
      font-size: 0.8rem;
      color: rgba(255, 255, 255, 0.5);
    }
  `]
})
export class HeaderComponent {
  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
  searchQuery: string = '';
  isSearchActive: boolean = false;
  private searchTimeout: any;

  constructor(
    private router: Router, 
    public app: AppComponent,
    private navService: NavigationService
  ) {
    this.navService.isSearchSelected$.subscribe(active => {
      this.isSearchActive = active;
      if (active) {
        setTimeout(() => {
          this.searchInput?.nativeElement.focus();
        }, 100);
      } else {
        this.searchInput?.nativeElement.blur();
      }
    });

    // Listen for global keydown to handle Enter when active
    window.addEventListener('keydown', (e) => {
      if (this.isSearchActive && e.key === 'Enter' && document.activeElement?.tagName !== 'INPUT') {
        this.searchInput?.nativeElement.focus();
      }
      if (e.key === 'Escape' && document.activeElement?.tagName === 'INPUT') {
        this.searchInput?.nativeElement.blur();
      }
    });
  }

  onInputFocus() {
    if (!this.router.url.includes('/search')) {
      this.router.navigate(['/search'], { queryParams: { q: this.searchQuery } });
    }
  }

  onSearch() {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    this.searchTimeout = setTimeout(() => {
      const query = this.searchQuery.trim();
      if (query.length >= 2) {
        this.router.navigate(['/search'], { queryParams: { q: query } });
      } else if (query.length === 0 && this.router.url.includes('/search')) {
        this.router.navigate(['/home']);
      }
    }, 400);
  }
}
