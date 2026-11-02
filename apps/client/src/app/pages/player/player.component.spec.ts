import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { PlayerComponent } from './player.component';
import { NavigationService } from '../../services/navigation.service';
import { DizipalSeriesDetail, TvChannelsService } from '../../services/tv-channels.service';

describe('Automatic next episode', () => {
  let fixture: ComponentFixture<PlayerComponent>;
  let component: PlayerComponent;
  let params: BehaviorSubject<Record<string, string>>;
  let service: jasmine.SpyObj<TvChannelsService>;
  let router: jasmine.SpyObj<Router>;
  const series = 'https://shortizle.com/icerik/example';
  const detail: DizipalSeriesDetail = { name: 'Example', image: '', description: '', url: series, containsSeason: [
    { seasonNumber: 3, numberOfEpisodes: 1, episode: [{ name: 'Season 3', episodeNumber: 1, url: '/resolve/3/1' }] },
    { seasonNumber: 1, numberOfEpisodes: 2, episode: [
      { name: 'Third available episode', episodeNumber: 3, url: '/resolve/1/3' },
      { name: 'First', episodeNumber: 1, url: '/resolve/1/1' }
    ] }
  ] };
  beforeEach(async () => {
    params = new BehaviorSubject<Record<string, string>>({ url: 'https://api.example/current.m3u8', series, season: '1', episode: '1' });
    service = jasmine.createSpyObj('TvChannelsService', ['getSeriesDetails', 'getVideoUrl']);
    service.getSeriesDetails.and.resolveTo(detail);
    service.getVideoUrl.and.resolveTo('https://api.example/next.m3u8');
    router = jasmine.createSpyObj('Router', ['navigate']); router.navigate.and.resolveTo(true);
    await TestBed.configureTestingModule({ imports: [PlayerComponent], providers: [
      { provide: ActivatedRoute, useValue: { queryParams: params } },
      { provide: TvChannelsService, useValue: service }, { provide: Router, useValue: router },
      { provide: NavigationService, useValue: { back: jasmine.createSpy() } }
    ] }).compileComponents();
    fixture = TestBed.createComponent(PlayerComponent); component = fixture.componentInstance;
    spyOn(component, 'initializePlayer'); // Avoid real media/network; exercise next-episode selection and routing.
    fixture.detectChanges();
  });

  it('uses the next published episode in order, resolves it and replaces the player URL', async () => {
    await component.playNextEpisode();
    expect(service.getVideoUrl).toHaveBeenCalledWith('/resolve/1/3');
    expect(router.navigate).toHaveBeenCalledWith(['/player'], { queryParams: {
      url: 'https://api.example/next.m3u8', series, season: 1, episode: 3
    }, replaceUrl: true });
  });

  it('advances into the next available season', async () => {
    params.next({ url: 'current', series, season: '1', episode: '3' });
    await component.playNextEpisode();
    expect(service.getVideoUrl).toHaveBeenCalledWith('/resolve/3/1');
  });

  it('stops at the end of the series', async () => {
    params.next({ url: 'current', series, season: '3', episode: '1' });
    await component.playNextEpisode();
    expect(service.getVideoUrl).not.toHaveBeenCalled(); expect(router.navigate).not.toHaveBeenCalled();
    expect(component.nextEpisodeLoading).toBeFalse(); expect(component.nextEpisodeError).toBe('');
  });

  it('leaves standalone videos without series context alone', async () => {
    params.next({ url: 'https://example.com/movie.mp4' });
    await component.playNextEpisode();
    expect(service.getSeriesDetails).not.toHaveBeenCalled(); expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows resolver errors and retries the same next episode', async () => {
    service.getVideoUrl.and.rejectWith(new Error('Erişim reddedildi.'));
    await component.playNextEpisode(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Erişim reddedildi.');
    expect(router.navigate).not.toHaveBeenCalled();
    service.getVideoUrl.and.resolveTo('https://api.example/retry.m3u8');
    await component.playNextEpisode();
    expect(service.getVideoUrl.calls.allArgs()).toEqual([['/resolve/1/3'], ['/resolve/1/3']]);
    expect(component.nextEpisodeError).toBe('');
  });

  it('does not resolve twice when ended fires again during a transition', async () => {
    let resolve!: (value: DizipalSeriesDetail) => void;
    service.getSeriesDetails.and.returnValue(new Promise(r => resolve = r));
    const first = component.playNextEpisode();
    await component.playNextEpisode();
    expect(service.getSeriesDetails).toHaveBeenCalledTimes(1);
    resolve(detail); await first;
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });

  it('does not navigate when the user leaves while the resolver is pending', async () => {
    let resolve!: (value: string) => void;
    service.getVideoUrl.and.returnValue(new Promise(r => resolve = r));
    const next = component.playNextEpisode();
    await Promise.resolve();
    component.ngOnDestroy(); resolve('https://api.example/late.m3u8'); await next;
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('reuses the existing Video.js player when its route source changes', () => {
    (component.initializePlayer as jasmine.Spy).and.callThrough();
    const player = jasmine.createSpyObj('VideoJsPlayer', ['src', 'autoplay', 'dispose', 'currentTime']);
    player.currentTime.and.returnValue(0);
    component.player = player;
    component.initializePlayer('https://api.example/new.m3u8');
    expect(player.src).toHaveBeenCalledWith({ src: 'https://api.example/new.m3u8', type: 'application/x-mpegURL' });
    expect(player.autoplay).toHaveBeenCalledWith(true); expect(player.dispose).not.toHaveBeenCalled();
  });
});
