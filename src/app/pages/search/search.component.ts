import { Component, OnInit, OnDestroy, HostListener, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { TvChannelsService, Channel } from '../../services/tv-channels.service';
import { NavigationService } from '../../services/navigation.service';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
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
    const isInputFocused = document.activeElement?.tagName === 'INPUT';
    
    if (isInputFocused && event.key !== 'Escape' && event.key !== 'Enter' && event.key !== 'ArrowDown') {
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
    }

    if (event.key === 'Escape') {
      (document.activeElement as HTMLElement)?.blur();
      this.activeSection = 'results';
      this.navService.setSearchSelected(false);
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
        if (isInputFocused || this.activeSection === 'search_bar') {
          if (this.results.length > 0) {
            this.activeSection = 'results';
            this.navService.setSearchSelected(false);
            this.activeIndex = 0;
          }
        } else if (this.activeSection === 'results' && this.activeIndex + this.columns < this.results.length) {
          this.activeIndex += this.columns;
        }
        break;
      case 'Enter':
        if (this.activeSection === 'results' && this.results.length > 0) {
          const item = this.results[this.activeIndex];
          this.router.navigate([item.category === 'Series' ? '/series' : '/player'], { 
            queryParams: { url: item.source.split('/')[1] } 
          });
        }
        break;
      case 'Backspace':
        this.router.navigate(['/home']);
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
    
    if (this.navService.getSearchSelected()) {
      this.activeSection = 'search_bar';
    } else {
      this.activeSection = 'results';
    }

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
