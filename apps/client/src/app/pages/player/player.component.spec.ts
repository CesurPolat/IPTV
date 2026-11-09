import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { PlayerComponent } from './player.component';
import Hls from 'hls.js';
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
    service = jasmine.createSpyObj('TvChannelsService', ['getSeriesDetails', 'getVideoUrl', 'getAlternativeSource', 'getAudioOptions']);
    service.getAudioOptions.and.resolveTo({ selected: 'dublaj', groups: ['dublaj', 'altyazi'] });
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

  const sessionUrl = 'https://api.example/Streaming/Shortizle/' + 'a'.repeat(32) + '/master.m3u8';
  function sourcePlayer(failFirstChild = false) {
    localStorage.removeItem(`playback_pos_${sessionUrl}`);
    const events = new Map<string, () => void>();
    const responses = new Set<(request: any, error: any, response: any) => void>();
    const xhr = jasmine.createSpyObj('VhsXhr', ['onResponse', 'offResponse']);
    xhr.onResponse.and.callFake((hook: any) => responses.add(hook));
    xhr.offResponse.and.callFake((hook: any) => responses.delete(hook));
    let position = 0;
    const player = jasmine.createSpyObj('VideoJsPlayer', ['src', 'on', 'tech', 'videoWidth', 'videoHeight', 'autoplay', 'dispose', 'currentTime', 'duration', 'paused', 'pause', 'play', 'ended', 'readyState', 'error']);
    player.videoWidth.and.returnValue(640); player.videoHeight.and.returnValue(360);
    player.on.and.callFake((name: string, callback: () => void) => events.set(name, callback));
    player.tech.and.returnValue({ vhs: { xhr } });
    let firstSource = true;
    player.src.and.callFake(() => {
      position = 0;
      events.get('xhr-hooks-ready')?.();
      if (firstSource && failFirstChild) {
        firstSource = false;
        responses.forEach(hook => hook({ uri: sessionUrl.replace('master.m3u8', 'resource/first.m3u8') }, null, { statusCode: 502 }));
      }
      firstSource = false;
    });
    player.currentTime.and.callFake((value?: number) => { if (value !== undefined) position = value; return position; });
    player.duration.and.returnValue(120); player.paused.and.returnValue(false); player.ended.and.returnValue(false); player.readyState.and.returnValue(0);
    spyOn<any>(component, 'createPlayer').and.returnValue(player);
    (component.initializePlayer as jasmine.Spy).and.callThrough();
    let revision = 0;
    service.getAlternativeSource.and.callFake(async () => sessionUrl + '?revision=' + (++revision));
    router.navigate.and.callFake(async (_commands, extras) => {
      params.next(Object.fromEntries(Object.entries(extras!.queryParams!).map(([key, value]) => [key, String(value)])));
      return true;
    });
    params.next({ url: sessionUrl, series, season: '1', episode: '1' });
    return { player, xhr, responses, emit: (name: string) => events.get(name)?.() };
  }

  it('plays native Shortizle MP4 directly while retaining audio and source selection', async () => {
    const { player } = sourcePlayer();
    const native = sessionUrl.replace('master.m3u8', 'media.mp4');
    const createHls = spyOn<any>(component, 'createHls');
    params.next({ url: native, series, season: '1', episode: '1' });
    expect(player.src).toHaveBeenCalledWith({ src: native, type: 'video/mp4' });
    expect(createHls).not.toHaveBeenCalled();
    expect(component.sourceNumber).toBe(1);
    expect(service.getAudioOptions).toHaveBeenCalledWith(native);
    await component.changeSource();
    expect(service.getAlternativeSource).toHaveBeenCalledWith(native, 2);
  });

  it('focuses source controls with Up, switches using either horizontal arrow and returns with Down', fakeAsync(() => {
    const { player } = sourcePlayer();
    fixture.detectChanges();
    const control = fixture.nativeElement.querySelector('.source-number') as HTMLElement;
    const key = (target: HTMLElement, name: string, repeat = false) => {
      const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, repeat });
      target.dispatchEvent(event);
      return event;
    };
    player.currentTime(42);
    expect(key(document.body, 'ArrowUp').defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(control);
    expect(key(control, 'ArrowRight').defaultPrevented).toBeTrue();
    flushMicrotasks();
    expect(component.sourceNumber).toBe(2);
    expect(player.currentTime()).toBe(0); // New media has not emitted loadedmetadata yet.
    expect(key(control, 'ArrowLeft').defaultPrevented).toBeTrue();
    flushMicrotasks();
    expect(component.sourceNumber).toBe(1);
    expect(service.getAlternativeSource.calls.mostRecent().args[1]).toBe(1);
    key(control, 'ArrowRight', true);
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(2);
    expect(key(control, 'ArrowDown').defaultPrevented).toBeTrue();
    expect(document.activeElement).not.toBe(control);
    key(document.body, 'ArrowRight');
    expect(player.currentTime()).toBe(10);
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(2);
    fixture.destroy();
  }));

  it('navigates the TV controls and changes audio options using only arrows', fakeAsync(() => {
    sourcePlayer(); flushMicrotasks();
    component.duration = 120;
    fixture.detectChanges();
    const key = (target: HTMLElement, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    const play = fixture.nativeElement.querySelector('[data-player-control="play"]') as HTMLElement;
    key(document.body, 'ArrowDown');
    expect(document.activeElement).toBe(play);
    key(play, 'ArrowRight');
    expect(document.activeElement?.getAttribute('data-player-control')).toBe('rewind');
    key(document.activeElement as HTMLElement, 'ArrowRight');
    key(document.activeElement as HTMLElement, 'ArrowRight');
    expect(document.activeElement?.getAttribute('data-player-control')).toBe('source');
    key(document.activeElement as HTMLElement, 'ArrowDown');
    expect(document.activeElement?.getAttribute('data-player-control')).toBe('audio-group');
    const change = spyOn(component, 'changeAudioGroup');
    key(document.activeElement as HTMLElement, 'ArrowRight');
    expect(change).toHaveBeenCalledWith('altyazi');
    key(document.activeElement as HTMLElement, 'ArrowUp');
    expect(document.activeElement?.getAttribute('data-player-control')).toBe('source');
    key(document.activeElement as HTMLElement, 'ArrowUp');
    expect(document.activeElement?.getAttribute('data-player-control')).toBe('seek');
    key(document.activeElement as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(play);
    fixture.destroy();
  }));

  it('keeps selectors visible during remote interaction and clamps seeking to the video length', fakeAsync(() => {
    const { player } = sourcePlayer(); flushMicrotasks();
    component.duration = 120; component.isPlaying = true;
    fixture.detectChanges();
    const source = fixture.nativeElement.querySelector('[data-player-control="source"]') as HTMLElement;
    source.focus(); component.resetControlsTimer(); tick(3001);
    expect(component.showControls).toBeTrue();
    source.blur();
    component.resetControlsTimer(); tick(3001);
    expect(component.showControls).toBeFalse();
    player.currentTime(118); component.seekBy(10);
    expect(player.currentTime()).toBe(120);
    player.currentTime(3); component.seekBy(-10);
    expect(player.currentTime()).toBe(0);
    fixture.destroy();
  }));

  it('uses HLS.js instead of VHS for real Shortizle video elements and destroys it on exit', () => {
    const { player } = sourcePlayer();
    const media = document.createElement('video');
    spyOn(media, 'play').and.returnValue(Promise.resolve());
    player.tech.and.returnValue({ el: () => media });
    spyOn(Hls, 'isSupported').and.returnValue(true);
    const handlers = new Map<string, (...args: any[]) => void>();
    const hls = jasmine.createSpyObj('Hls', ['on', 'loadSource', 'attachMedia', 'destroy']);
    hls.audioTracks = [{ lang: 'en', name: 'English' }, { lang: 'tr', name: 'Türkçe' }];
    hls.audioTrack = 0;
    hls.on.and.callFake((name: string, callback: (...args: any[]) => void) => handlers.set(name, callback));
    spyOn<any>(component, 'createHls').and.returnValue(hls);
    const recover = spyOn(component, 'recoverSource');
    player.src.calls.reset();
    component.initializePlayer(sessionUrl);
    expect(hls.loadSource).toHaveBeenCalledWith(sessionUrl);
    expect(hls.attachMedia).toHaveBeenCalledWith(media);
    expect(player.src).not.toHaveBeenCalled();
    handlers.get(Hls.Events.AUDIO_TRACKS_UPDATED)?.();
    expect(hls.audioTrack).toBe(1);
    component.changeAudioTrack('0');
    handlers.get(Hls.Events.AUDIO_TRACK_SWITCHED)?.();
    expect(hls.audioTrack).toBe(0); // A manual choice must survive track updates.
    handlers.get(Hls.Events.MANIFEST_PARSED)?.();
    expect(media.play).toHaveBeenCalled();
    handlers.get(Hls.Events.ERROR)?.(Hls.Events.ERROR, { fatal: false, details: 'fragLoadError' });
    expect(recover).not.toHaveBeenCalled();
    handlers.get(Hls.Events.ERROR)?.(Hls.Events.ERROR, { fatal: true, details: 'bufferAddCodecError' });
    expect(recover).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(hls.destroy).toHaveBeenCalled();
  });

  it('prefers Turkish native/VHS audio, respects manual choice and removes listeners', () => {
    const { player, emit } = sourcePlayer();
    const tracks: any = [{ language: 'en', label: 'English', enabled: true }, { language: 'tur', label: '', enabled: false }];
    tracks.addEventListener = jasmine.createSpy();
    tracks.removeEventListener = jasmine.createSpy();
    player.audioTracks = () => tracks;
    emit('loadedmetadata');
    expect(tracks[1].enabled).toBeTrue();
    expect(tracks[0].enabled).toBeFalse();
    component.changeAudioTrack('0');
    emit('loadedmetadata');
    expect(tracks[0].enabled).toBeTrue();
    expect(component.selectedAudioTrack).toBe(0);
    fixture.destroy();
    expect(tracks.removeEventListener).toHaveBeenCalledTimes(3);
  });

  it('switches dubbing groups and resumes at the same position', async () => {
    const { player, emit } = sourcePlayer();
    await fixture.whenStable();
    player.currentTime(42);
    await component.changeAudioGroup('altyazi');
    emit('loadedmetadata');
    expect(service.getAlternativeSource).toHaveBeenCalledWith(sessionUrl, 1, 'altyazi');
    expect(player.currentTime()).toBe(42);
  });

  it('honors a manual switch while playback continues and prevents duplicate requests', async () => {
    const { player, emit } = sourcePlayer();
    let resolve!: (url: string) => void;
    service.getAlternativeSource.and.returnValue(new Promise<string>(done => resolve = done));
    player.currentTime(42); emit('timeupdate');
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('[aria-label="Sonraki kaynak"]') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(button.disabled).toBeTrue();
    await component.changeSource();
    emit('playing');
    resolve(sessionUrl + '?revision=1');
    await fixture.whenStable(); emit('loadedmetadata'); fixture.detectChanges();
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(1);
    expect(player.currentTime()).toBe(42);
    expect(component.sourceNumber).toBe(2);
    expect(fixture.nativeElement.querySelector('.source-number span').textContent).toContain('Kaynak 2');
    expect(service.getSeriesDetails).not.toHaveBeenCalled();
  });

  it('allows manual switching after automatic retries stop and while paused', async () => {
    sourcePlayer();
    component.togglePlay();
    component.sourceError = 'Kaynaklar kullanılamıyor.';
    (component as any).sourceAttempts = 3;
    await component.changeSource();
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(1);
    expect(component.sourceError).toBe('');
    expect(component.sourceNumber).toBe(2);
  });

  it('keeps the manually selected source after media and child playlist errors', async () => {
    const { emit, responses } = sourcePlayer();
    await component.changeSource();
    emit('error');
    const child = sessionUrl.replace('master.m3u8', 'resource/broken.m3u8');
    [...responses].forEach(hook => hook({ uri: child }, null, { statusCode: 502 }));
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(1);
    expect(component.sourceNumber).toBe(2);
    expect(component.sourceError).toContain('Seçilen kaynak');
    await component.changeSource(-1);
    expect(service.getAlternativeSource.calls.mostRecent().args[1]).toBe(1);
    expect(component.sourceNumber).toBe(1);
  });

  it('does not skip a manually selected source when its resolver fails', async () => {
    sourcePlayer();
    service.getAlternativeSource.and.rejectWith(new Error('Kaynak bozuk'));
    await component.changeSource();
    await component.recoverSource();
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(1);
    expect(component.sourceNumber).toBe(2);
    expect(component.sourceError).toBe('Kaynak bozuk');
  });

  it('switches master when the very first child playlist fails without a player error event', async () => {
    const { emit } = sourcePlayer(true);
    await fixture.whenStable(); emit('loadedmetadata');
    expect(service.getAlternativeSource).toHaveBeenCalledWith(sessionUrl);
    expect(router.navigate.calls.mostRecent().args[1]!.queryParams!['url']).toBe(sessionUrl + '?revision=1');
    expect(service.getSeriesDetails).not.toHaveBeenCalled();
  });

  it('recovers on a child m3u8 HTTP failure, keeps the position and ignores late old-source responses', async () => {
    const { player, responses, emit } = sourcePlayer();
    player.currentTime(42); emit('timeupdate');
    const oldHook = [...responses][0];
    const child = sessionUrl.replace('master.m3u8', 'resource/d2a519871f814ab28c833e44be8c798b.m3u8');
    oldHook({ uri: child }, null, { statusCode: 404 });
    oldHook({ uri: child }, null, { statusCode: 502 });
    emit('error'); // An unrecoverable player error still switches immediately.
    await fixture.whenStable(); emit('loadedmetadata');
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(1);
    expect(player.currentTime()).toBe(42);
    oldHook({ uri: child }, null, { statusCode: 502 });
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(1);
  });

  it('keeps working video on transient child failures but switches if playback then stalls', fakeAsync(() => {
    const { player, responses, emit } = sourcePlayer();
    player.currentTime(1); emit('timeupdate');
    const hook = [...responses][0];
    const child = sessionUrl.replace('master.m3u8', 'resource/optional-or-retried.m3u8');
    hook({ uri: child }, null, { statusCode: 502 });
    expect(service.getAlternativeSource).not.toHaveBeenCalled();
    tick(10000);
    player.currentTime(11); emit('timeupdate');
    tick(15000);
    expect(service.getAlternativeSource).not.toHaveBeenCalled();
    hook({ uri: child }, null, { statusCode: 404 });
    tick(19999);
    expect(service.getAlternativeSource).not.toHaveBeenCalled();
    tick(1);
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(1);
    fixture.destroy();
  }));

  it('ignores successful, aborted and unrelated HLS responses and removes its request hook on exit', () => {
    const { responses, xhr } = sourcePlayer();
    const hook = [...responses][0];
    const child = sessionUrl.replace('master.m3u8', 'resource/child.m3u8');
    hook({ uri: child }, null, { statusCode: 200 });
    hook({ uri: child, aborted: true }, new Error('aborted'), { statusCode: 0 });
    hook({ uri: child.replace('a'.repeat(32), 'b'.repeat(32)) }, null, { statusCode: 502 });
    hook({ uri: child.replace('api.example', 'other.example') }, null, { statusCode: 502 });
    expect(service.getAlternativeSource).not.toHaveBeenCalled();
    component.ngOnDestroy();
    expect(xhr.offResponse).toHaveBeenCalledWith(hook); expect(responses.size).toBe(0);
    hook({ uri: child }, null, { statusCode: 502 });
    expect(service.getAlternativeSource).not.toHaveBeenCalled();
  });

  it('switches after a playback error and resumes the same episode at the saved second', async () => {
    const { player, emit } = sourcePlayer();
    player.currentTime(42); emit('timeupdate'); emit('error');
    await fixture.whenStable();
    emit('loadedmetadata');
    expect(service.getAlternativeSource).toHaveBeenCalledWith(sessionUrl);
    expect(player.currentTime()).toBe(42);
    expect(router.navigate).toHaveBeenCalledWith(['/player'], { queryParams: {
      url: sessionUrl + '?revision=1', series, season: '1', episode: '1'
    }, replaceUrl: true });
    expect(service.getSeriesDetails).not.toHaveBeenCalled();
  });

  it('does not cancel a codec-error recovery just because audio continues playing', async () => {
    const { player, emit } = sourcePlayer();
    player.error.and.returnValue({ code: 4, message: 'No compatible source' });
    player.videoWidth.and.returnValue(0); player.videoHeight.and.returnValue(0);
    let resolve!: (url: string) => void;
    service.getAlternativeSource.and.returnValue(new Promise(done => resolve = done));
    const pending = component.recoverSource();
    player.currentTime(10); emit('playing'); emit('timeupdate');
    resolve(sessionUrl + '?revision=1'); await pending;
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate.calls.mostRecent().args[1]!.queryParams!['url']).toContain('revision=1');
  });

  it('switches an audio-only stream when no video frames arrive', fakeAsync(() => {
    const { player, emit } = sourcePlayer();
    player.videoWidth.and.returnValue(0); player.videoHeight.and.returnValue(0); player.readyState.and.returnValue(4);
    emit('playing');
    player.currentTime(1); emit('timeupdate'); tick(10000);
    player.currentTime(11); emit('timeupdate'); tick(10000);
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  }));

  it('retains the original position if another source fails before loading metadata', async () => {
    const { player, emit } = sourcePlayer();
    player.currentTime(42); emit('timeupdate'); emit('error'); await fixture.whenStable();
    emit('error'); await fixture.whenStable(); emit('loadedmetadata');
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(2);
    expect(player.currentTime()).toBe(42);
  });

  it('detects a prolonged stall but does not switch while manually paused', fakeAsync(() => {
    const { player, emit } = sourcePlayer();
    tick(19999); expect(service.getAlternativeSource).not.toHaveBeenCalled();
    tick(1); expect(service.getAlternativeSource).toHaveBeenCalledTimes(1);
    player.currentTime(1); emit('timeupdate'); emit('waiting');
    component.togglePlay(); tick(25000);
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  }));

  it('bounds automatic source attempts instead of retrying forever', async () => {
    const { emit } = sourcePlayer();
    for (let attempt = 0; attempt < 4; attempt++) { emit('error'); await fixture.whenStable(); }
    expect(service.getAlternativeSource).toHaveBeenCalledTimes(3);
    expect(component.sourceError).toContain('Kaynaklar kullanılamıyor');
  });

  it('shows exhaustion without advancing to a different episode', async () => {
    const { player, emit } = sourcePlayer();
    service.getAlternativeSource.and.rejectWith(new Error('Aynı dilde çalışan başka kaynak bulunamadı.'));
    emit('error'); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Aynı dilde');
    player.error.and.returnValue({ code: 2 }); emit('ended');
    expect(service.getSeriesDetails).not.toHaveBeenCalled(); expect(router.navigate).not.toHaveBeenCalled();
  });

  it('clears an exhausted-source warning when playback resumes', async () => {
    const { player, emit } = sourcePlayer();
    service.getAlternativeSource.and.rejectWith(new Error('Aynı dilde çalışan başka kaynak bulunamadı.'));
    emit('error'); await fixture.whenStable();
    expect(component.sourceError).toContain('başka kaynak');
    emit('playing'); fixture.detectChanges();
    expect(component.sourceError).toBe('');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    component.sourceError = 'Eski hata';
    player.currentTime(10); emit('timeupdate');
    expect(component.sourceError).toBe('');
  });

  it('does not show a late failover error after playback has already recovered', async () => {
    const { player, emit } = sourcePlayer();
    let reject!: (error: Error) => void;
    service.getAlternativeSource.and.returnValue(new Promise((_resolve, fail) => reject = fail));
    const pending = component.recoverSource();
    player.currentTime(10); emit('timeupdate');
    reject(new Error('Aynı dilde çalışan başka kaynak bulunamadı.')); await pending;
    expect(component.sourceError).toBe(''); expect(component.sourceLoading).toBeFalse();
  });

  it('keeps a recovered stream instead of replacing it with a late alternative', async () => {
    const { emit } = sourcePlayer();
    let resolve!: (url: string) => void;
    service.getAlternativeSource.and.returnValue(new Promise(done => resolve = done));
    const pending = component.recoverSource(); emit('playing');
    resolve(sessionUrl + '?revision=1'); await pending;
    expect(router.navigate).not.toHaveBeenCalled(); expect(component.sourceError).toBe('');
  });

  it('ignores a late alternative source after leaving the player', async () => {
    sourcePlayer();
    let resolve!: (url: string) => void;
    service.getAlternativeSource.and.returnValue(new Promise(r => resolve = r));
    const pending = component.recoverSource(); component.ngOnDestroy(); resolve(sessionUrl + '?revision=1'); await pending;
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('uses the next published episode in order, resolves it and replaces the player URL', async () => {
    await component.playNextEpisode();
    expect(service.getVideoUrl).toHaveBeenCalledWith('/resolve/1/3');
    expect(router.navigate).toHaveBeenCalledWith(['/player'], { queryParams: {
      url: 'https://api.example/next.m3u8', series, season: 1, episode: 3
    }, replaceUrl: true });
  });

  it('applies the manually selected source to the next episode', async () => {
    sourcePlayer();
    await component.changeSource();
    service.getVideoUrl.and.resolveTo(sessionUrl);
    service.getAlternativeSource.calls.reset();
    await component.playNextEpisode();
    expect(service.getAlternativeSource).toHaveBeenCalledWith(sessionUrl, 2);
    const query = router.navigate.calls.mostRecent().args[1]!.queryParams!;
    expect(query['episode']).toBe(3);
    expect(query['selectedSource']).toBe(2);
    expect(query['manualSource']).toBe('1');
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
