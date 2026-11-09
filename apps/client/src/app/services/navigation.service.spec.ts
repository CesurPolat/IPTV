import { ChangeDetectorRef, Component, ElementRef, NgZone } from '@angular/core';
import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { filter, firstValueFrom, take } from 'rxjs';
import { NavigationService } from './navigation.service';
import { PlayerComponent } from '../pages/player/player.component';
import { TvChannelsService } from './tv-channels.service';
import { SeriesProgressService } from './series-progress.service';

@Component({ standalone: true, template: '' })
class EmptyPage {}
@Component({ standalone: true, imports: [RouterOutlet], template: '<router-outlet />' })
class TestHost {}

describe('App back navigation', () => {
  let router: Router;
  let navigation: NavigationService;
  let zone: NgZone;
  let location: Location;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TestHost, RouterTestingModule.withRoutes([
      { path: 'home', component: EmptyPage }, { path: 'series', component: EmptyPage }, { path: 'player', component: EmptyPage }
    ])] });
    router = TestBed.inject(Router);
    navigation = TestBed.inject(NavigationService);
    location = TestBed.inject(Location);
    zone = TestBed.inject(NgZone);
    TestBed.createComponent(TestHost).detectChanges();
    router.setUpLocationChangeListener();
  });
  const done = (router: Router) => firstValueFrom(router.events.pipe(filter(e => e instanceof NavigationEnd), take(1)));
  const visit = (zone: NgZone, router: Router, url: string) => zone.run(() => router.navigateByUrl(url));
  async function back(fallback = '/home') {
    const finished = done(router);
    zone.run(() => navigation.back(fallback));
    await finished;
  }

  it('returns from player to episodes and then the previous filtered results page', async () => {
    await visit(zone, router, '/home');
    await visit(zone, router, '/series');
    const results = '/series?archive=1&q=selam&kind=dublaj&page=3';
    await visit(zone, router, results);
    const episodes = '/series?url=https%3A%2F%2Fshortizle.com%2Ficerik%2Fexample';
    await visit(zone, router, episodes);
    await visit(zone, router, '/player?url=https%3A%2F%2Fexample.com%2Fmaster.m3u8');
    await zone.run(() => router.navigateByUrl('/player?url=next-episode.m3u8', { replaceUrl: true }));
    await back('/series'); expect(router.parseUrl(router.url).queryParams['url']).toBe('https://shortizle.com/icerik/example');
    await back('/series'); expect(router.url).toBe(results);
    await back(); expect(router.url).toBe('/series');
    await back(); expect(router.url).toBe('/home');
  });

  it('uses an internal fallback for a directly opened detail URL', async () => {
    spyOn(location, 'back').and.callThrough();
    await visit(zone, router, '/series?url=direct-link');
    await back('/series');
    expect(router.url).toBe('/series');
    expect(location.back).not.toHaveBeenCalled();
    await back('/home');
    expect(router.url).toBe('/home');
    expect(location.back).not.toHaveBeenCalled();
  });

  it('handles player back before media is initialized without reloading the app', () => {
    spyOn(navigation, 'back');
    const player = new PlayerComponent({} as ChangeDetectorRef, {} as ActivatedRoute, navigation, {} as TvChannelsService, router, TestBed.inject(SeriesProgressService), new ElementRef(document.createElement('div')));
    const event = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    player.handleKeyboardEvent(event);
    expect(event.defaultPrevented).toBeTrue();
    expect(navigation.back).toHaveBeenCalledWith('/series');
  });

  it('keeps the correct previous page after forward navigation', async () => {
    await visit(zone, router, '/home');
    await visit(zone, router, '/series');
    await visit(zone, router, '/series?archive=1&q=selam');
    await back(); expect(router.url).toBe('/series');
    const finished = done(router); zone.run(() => location.forward()); await finished;
    expect(router.url).toBe('/series?archive=1&q=selam');
    await back(); expect(router.url).toBe('/series');
  });
});
