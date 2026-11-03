import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject } from 'rxjs';
import { SeriesComponent } from './series.component';
import { TvChannelsService } from '../../services/tv-channels.service';
import { NavigationService } from '../../services/navigation.service';

describe('Shortizle collection screen', () => {
  let fixture: ComponentFixture<SeriesComponent>;
  let params: BehaviorSubject<Record<string, string>>;
  let service: jasmine.SpyObj<TvChannelsService>;
  let intersect: IntersectionObserverCallback;
  let observer: jasmine.SpyObj<IntersectionObserver>;
  beforeEach(async () => {
    observer = jasmine.createSpyObj('IntersectionObserver', ['observe', 'unobserve', 'disconnect']);
    spyOn(window, 'IntersectionObserver').and.callFake(function(callback: IntersectionObserverCallback) {
      intersect = callback; return observer;
    });
    params = new BehaviorSubject<Record<string, string>>({ collections: '1' });
    service = jasmine.createSpyObj('TvChannelsService', ['getShortizleCollections', 'getSeriesDetails', 'getVideoUrl', 'searchShortizle']);
    service.searchShortizle.and.resolveTo({ items: [], page: 1, lastPage: 1, perPage: 30, total: 0, options: { genres: [], platforms: [] } });
    service.getShortizleCollections.and.resolveTo({ heading: 'Koleksiyonlar', collections: [{ key: 'popular', title: 'Popüler', items: [{
      id: '1', slug: 'example', name: 'Example', url: 'https://shortizle.com/icerik/example', posterUrl: null,
      description: null, episodeCount: 2, hasDublaj: true, hasAltyazi: true, isAdult: false
    }] }] });
    await TestBed.configureTestingModule({ imports: [SeriesComponent, RouterTestingModule], providers: [
      { provide: TvChannelsService, useValue: service }, { provide: ActivatedRoute, useValue: { queryParams: params } }
    ] }).compileComponents();
    fixture = TestBed.createComponent(SeriesComponent);
  });

  it('shows grouped titles on the explicit collections route', async () => {
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Popüler');
    expect(fixture.nativeElement.textContent).toContain('Example');
    const card = fixture.nativeElement.querySelector('.catalog-card');
    expect(card.getAttribute('href')).toContain('shortizle.com');
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture.componentInstance.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(router.navigate).toHaveBeenCalledWith(['/series'], { queryParams: { url: 'https://shortizle.com/icerik/example' } });
  });

  it('lists dubbed series by default while preserving an explicit All selection', async () => {
    params.next({});
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(service.searchShortizle.calls.mostRecent().args[0].kind).toBe('dublaj');
    expect(fixture.componentInstance.archiveMode).toBeTrue();
    params.next({ archive: '1', kind: '' });
    await fixture.whenStable(); fixture.detectChanges();
    expect(service.searchShortizle.calls.mostRecent().args[0].kind).toBe('');
  });

  it('moves from filters to results and back using only arrows', async () => {
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[name="q"]'); input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement!.closest('app-series-filter')).not.toBeNull();
    const reset = fixture.nativeElement.querySelector('.reset-filters'); reset.focus();
    reset.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    const card = fixture.nativeElement.querySelector('.catalog-card'); expect(document.activeElement).toBe(card);
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(reset);
  });

  it('closes an open filter on Android Back without leaving Movies', async () => {
    const navigation = TestBed.inject(NavigationService); spyOn(navigation, 'back');
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    fixture.nativeElement.querySelector('app-series-filter button').click(); fixture.detectChanges();
    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    document.dispatchEvent(event); fixture.detectChanges();
    expect(event.defaultPrevented).toBeTrue(); expect(navigation.back).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });

  it('handles the Android back event even while loading or showing an error', () => {
    const navigation = TestBed.inject(NavigationService);
    spyOn(navigation, 'back');
    fixture.componentInstance.archiveMode = true;
    fixture.componentInstance.isLoading = true;
    fixture.componentInstance.error = 'Unavailable';
    const event = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    fixture.componentInstance.handleKeyboardEvent(event);
    expect(event.defaultPrevented).toBeTrue();
    expect(navigation.back).toHaveBeenCalledWith('/series');
  });

  it('keeps Backspace available for editing the search input', async () => {
    const navigation = TestBed.inject(NavigationService); spyOn(navigation, 'back');
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[name="q"]');
    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBeFalse();
    expect(navigation.back).not.toHaveBeenCalled();
  });

  it('shows a retry action when collection loading fails', async () => {
    service.getShortizleCollections.and.rejectWith(new Error('unavailable'));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Koleksiyonlar yüklenemedi');
    fixture.nativeElement.querySelector('[role="alert"] button').click();
    expect(service.getShortizleCollections).toHaveBeenCalledTimes(2);
  });

  it('restores URL filters and displays empty results without pagination buttons', async () => {
    params.next({ archive: '1', q: 'selam', genres: 'aksiyon', platform: 'reelshort', kind: 'dublaj', sort: 'popular', view: 'list' });
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(service.searchShortizle).toHaveBeenCalledWith({ q: 'selam', genres: ['aksiyon'], platform: 'reelshort', kind: 'dublaj', sort: 'popular', view: 'list', page: 1 });
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('dizi bulunamadı');
    expect(fixture.nativeElement.querySelector('.archive-pagination')).toBeNull();
    expect(fixture.componentInstance.hasMoreArchive).toBeFalse();
  });

  const title = (id: string) => ({ id, slug: id, name: id, url: 'https://shortizle.com/icerik/' + id,
    posterUrl: null, description: null, episodeCount: 1, hasDublaj: true, hasAltyazi: false, isAdult: false });
  const page = (number: number, ids: string[], lastPage = 3) => ({ items: ids.map(title), page: number, lastPage,
    perPage: 2, total: 6, options: { genres: [], platforms: [] } });

  it('appends pages on scroll, deduplicates titles and prevents overlapping requests', async () => {
    params.next({ q: 'submitted' });
    service.searchShortizle.and.resolveTo(page(1, ['one', 'two']));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    let resolve!: (result: ReturnType<typeof page>) => void;
    service.searchShortizle.and.returnValue(new Promise(done => resolve = done));
    fixture.componentInstance.archiveQuery.q = 'unsubmitted edit';
    intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], observer);
    intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], observer);
    expect(service.searchShortizle).toHaveBeenCalledTimes(2);
    expect(service.searchShortizle.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ page: 2, q: 'submitted', kind: 'dublaj' }));
    expect(fixture.componentInstance.isLoading).toBeFalse();
    resolve(page(2, ['two', 'three'])); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.archiveResult!.items.map(item => item.id)).toEqual(['one', 'two', 'three']);
    service.searchShortizle.and.resolveTo(page(3, ['four']));
    intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], observer);
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.hasMoreArchive).toBeFalse();
    await fixture.componentInstance.loadNextArchivePage();
    expect(service.searchShortizle).toHaveBeenCalledTimes(3);
    expect(fixture.nativeElement.textContent).toContain('Tüm sonuçlar gösteriliyor');
  });

  it('keeps existing results on a next-page failure and retries the same page', async () => {
    params.next({}); service.searchShortizle.and.resolveTo(page(1, ['one']));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    service.searchShortizle.and.rejectWith(new Error('offline'));
    await fixture.componentInstance.loadNextArchivePage(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.catalog-card').textContent).toContain('one');
    expect(fixture.componentInstance.archiveResult!.page).toBe(1);
    expect(fixture.componentInstance.loadMoreError).toBeTruthy();
    service.searchShortizle.and.resolveTo(page(2, ['two']));
    fixture.nativeElement.querySelector('.archive-load-status button').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(service.searchShortizle.calls.mostRecent().args[0].page).toBe(2);
    expect(fixture.componentInstance.archiveResult!.items.length).toBe(2);
    expect(fixture.componentInstance.loadMoreError).toBe('');
  });

  it('discards a pending older page after filters change and disconnects on exit', async () => {
    params.next({ q: 'old' }); service.searchShortizle.and.resolveTo(page(1, ['old']));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    let resolve!: (result: ReturnType<typeof page>) => void;
    service.searchShortizle.and.returnValue(new Promise(done => resolve = done));
    const pending = fixture.componentInstance.loadNextArchivePage();
    service.searchShortizle.and.resolveTo(page(1, ['new']));
    params.next({ q: 'new' });
    resolve(page(2, ['stale'])); await pending; await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.archiveResult!.items.map(item => item.id)).toEqual(['new']);
    expect(fixture.componentInstance.loadingMore).toBeFalse();
    fixture.destroy(); expect(observer.disconnect).toHaveBeenCalled();
  });

  it('resets paging when submitting edited filters and preserves filters for the next page', async () => {
    const router = TestBed.inject(Router); spyOn(router, 'navigate').and.resolveTo(true);
    const component = fixture.componentInstance;
    component.archiveQuery = { q: 'selam', genres: ['aksiyon'], platform: 'reelshort', kind: 'dublaj', sort: 'popular', view: 'grid', page: 5 };
    component.searchArchive();
    expect(router.navigate).toHaveBeenCalledWith(['/series'], { queryParams: { archive: '1', ...component.archiveQuery, page: 1 } });
    component.searchArchive(2);
    expect(router.navigate).toHaveBeenCalledWith(['/series'], { queryParams: { archive: '1', ...component.archiveQuery, page: 2 } });
  });

  it('shows episodes and sends the resolved HLS URL to the player', async () => {
    params.next({ url: 'https://shortizle.com/icerik/example' });
    service.getSeriesDetails.and.resolveTo({ name: 'Example', description: '', image: '', url: '', containsSeason: [{
      seasonNumber: 1, numberOfEpisodes: 1, episode: [{ name: 'Bölüm 1', episodeNumber: 1, url: '/resolver' }]
    }] });
    service.getVideoUrl.and.resolveTo('https://api.example/master.m3u8');
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Bölüm 1');
    await fixture.componentInstance.playEpisode(fixture.componentInstance.seasons[0].episodes[0], 0);
    expect(router.navigate).toHaveBeenCalledWith(['/player'], { queryParams: {
      url: 'https://api.example/master.m3u8', series: 'https://shortizle.com/icerik/example', season: '1', episode: '1'
    } });
  });
});
