import { SeriesProgressService } from './series-progress.service';

describe('SeriesProgressService', () => {
  const service = new SeriesProgressService();
  const item = { series: 'series-a', name: 'A', image: '', season: 1, episode: 2, position: 42, updatedAt: 10 };

  afterEach(() => localStorage.removeItem('series_progress_v1'));

  it('keeps one entry per series and sorts by recent playback', () => {
    service.save(item);
    service.save({ ...item, series: 'series-b', updatedAt: 20 });
    service.save({ ...item, episode: 3, updatedAt: 30 });
    expect(service.list().map(entry => entry.series)).toEqual(['series-a', 'series-b']);
    expect(service.get('series-a')?.episode).toBe(3);
    service.remove('series-a');
    expect(service.get('series-a')).toBeUndefined();
  });

  it('ignores corrupt or inaccessible storage', () => {
    localStorage.setItem('series_progress_v1', '{invalid');
    expect(service.list()).toEqual([]);
    spyOn(Storage.prototype, 'getItem').and.throwError('unavailable');
    expect(service.list()).toEqual([]);
  });
});
