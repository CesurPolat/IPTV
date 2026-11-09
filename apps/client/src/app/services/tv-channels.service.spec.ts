import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TvChannelsService } from './tv-channels.service';
import { NotificationService } from './notification.service';

describe('Shortizle client integration', () => {
  let service: TvChannelsService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule], providers: [
      TvChannelsService, { provide: NotificationService, useValue: { showError: jasmine.createSpy() } }
    ] });
    service = TestBed.inject(TvChannelsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('loads collection rows from the Shortizle API', async () => {
    const result = service.getShortizleCollections();
    http.expectOne(r => r.url.endsWith('/Streaming/Shortizle/collections')).flush({ heading: 'Koleksiyonlar', collections: [] });
    expect((await result).heading).toBe('Koleksiyonlar');
  });

  it('requests an alternative for the current session revision', async () => {
    const session = 'a'.repeat(32);
    const result = service.getAlternativeSource(`https://api.example/Streaming/Shortizle/${session}/master.m3u8?revision=2`);
    const request = http.expectOne(r => r.url.endsWith(`/Streaming/Shortizle/${session}/failover`));
    expect(request.request.method).toBe('POST'); expect(request.request.body).toEqual({ revision: 2 });
    request.flush('https://api.example/next.m3u8?revision=3');
    expect(await result).toContain('revision=3');
  });

  it('loads audio groups and switches sources from a native MP4 URL', async () => {
    const session = 'a'.repeat(32);
    const native = `https://api.example/Streaming/Shortizle/${session}/media.mp4?revision=2`;
    const audio = service.getAudioOptions(native);
    http.expectOne(`https://api.example/Streaming/Shortizle/${session}/audio`).flush({ selected: 'dublaj', groups: ['dublaj', 'altyazi'] });
    expect((await audio).selected).toBe('dublaj');
    const result = service.getAlternativeSource(native, 1, 'altyazi');
    const request = http.expectOne(r => r.url.endsWith(`/Streaming/Shortizle/${session}/failover`));
    expect(request.request.body).toEqual({ revision: 2, sourceNumber: 1, group: 'altyazi' });
    request.flush(native.replace('media.mp4?revision=2', 'master.m3u8?revision=3'));
    expect(await result).toContain('master.m3u8');
  });

  it('sends archive filters and repeated genres without changing the search text', async () => {
    const result = service.searchShortizle({ q: 'selam & test', genres: ['aksiyon', 'aile'], platform: 'reelshort', kind: 'dublaj', sort: 'popular', view: 'list', page: 2 });
    const request = http.expectOne(r => r.url.endsWith('/Streaming/Shortizle/search'));
    expect(request.request.params.get('q')).toBe('selam & test');
    expect(request.request.params.getAll('genres[]')).toEqual(['aksiyon', 'aile']);
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('platform')).toBe('reelshort');
    request.flush({ items: [], page: 2, lastPage: 2, perPage: 30, total: 30, options: { genres: [], platforms: [] } });
    expect((await result).page).toBe(2);
  });

  it('keeps Shortizle search results when the legacy provider fails', async () => {
    const result = service.searchContent('selam');
    http.expectOne(r => r.url.includes('/streaming/Search?')).flush('Unavailable', { status: 502, statusText: 'Bad Gateway' });
    http.expectOne(r => r.url.endsWith('/Streaming/Shortizle/search')).flush({ items: [{ id: '42', name: 'Selam', url: 'https://shortizle.com/icerik/selam', posterUrl: null }] });
    const items = await result;
    expect(items[0].source).toBe('https://shortizle.com/icerik/selam');
    expect(items[0].category).toBe('Series');
  });

  it('maps existing provider search responses alongside Shortizle', async () => {
    const result = service.searchContent('example');
    http.expectOne(r => r.url.includes('/streaming/Search?')).flush([{ name: 'Legacy', type: 'series', provider_results: [{ id: 1, slug: 'legacy-id' }] }]);
    http.expectOne(r => r.url.endsWith('/Streaming/Shortizle/search')).flush({ items: [] });
    expect((await result)[0].source).toBe('legacy-id');
  });

  it('loads Shortizle details and wraps episode URLs in the existing resolver', async () => {
    const result = service.getSeriesDetails('https://shortizle.com/icerik/example');
    http.expectOne(r => r.url.endsWith('/Streaming/Shortizle/series/example')).flush({
      name: 'Example', containsSeason: [{ seasonNumber: 1, episode: [{ name: 'Bölüm 1', episodeNumber: 1, url: 'https://shortizle.com/watch/example/1/1' }] }]
    });
    const detail = await result;
    const season = Array.isArray(detail!.containsSeason) ? detail!.containsSeason[0] : detail!.containsSeason;
    const episode = Array.isArray(season.episode) ? season.episode[0] : season.episode;
    expect(episode.url).toContain('/Streaming/GetMediaUrl?url=https%3A%2F%2Fshortizle.com%2Fwatch%2Fexample%2F1%2F1');
  });

  it('keeps legacy detail requests on the legacy endpoint', async () => {
    const result = service.getSeriesDetails('legacy-id');
    http.expectOne(r => r.url.includes('/Streaming/GetSeriesDetail?seriesId=legacy-id')).flush({ name: 'Legacy', containsSeason: [] });
    expect((await result)!.name).toBe('Legacy');
  });

  it('surfaces upstream denial rather than passing an error document to the player', async () => {
    spyOn(window, 'fetch').and.resolveTo(new Response(JSON.stringify({ detail: 'Abonelik gerekiyor.' }), { status: 403 }));
    await expectAsync(service.getVideoUrl('/Streaming/GetMediaUrl?url=example')).toBeRejectedWithError('Abonelik gerekiyor.');
  });
});
