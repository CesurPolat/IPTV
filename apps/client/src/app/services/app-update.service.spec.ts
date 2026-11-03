import { TestBed } from '@angular/core/testing';
import { UpdaterPlugin } from 'capacitor-web-updater';
import { APP_UPDATER, AppUpdateService } from './app-update.service';
import { environment } from '../../environments/environment';

describe('AppUpdateService native updater integration', () => {
  let service: AppUpdateService;
  let updater: jasmine.SpyObj<UpdaterPlugin>;
  let reload: jasmine.Spy;
  const nextMajor = Number(environment.version.split('.')[0]) + 1;
  const url = (name: string) => `https://iptvcdn.cesurpolat.dev/versions/${name}.zip`;
  const release = (version: string, name = version.replace(/\./g, '_')) => ({ version, url: url(name) });
  const latest = release(`${nextMajor}.10.0`);

  beforeEach(() => {
    updater = jasmine.createSpyObj<UpdaterPlugin>('Updater', ['listVersions', 'getVersion']);
    TestBed.configureTestingModule({ providers: [{ provide: APP_UPDATER, useValue: updater }] });
    service = TestBed.inject(AppUpdateService);
    reload = spyOn<any>(service, 'reloadApp');
    updater.getVersion.and.resolveTo({ value: true });
    spyOn(console, 'error');
  });

  it('parses the Android JSON string, sorts versions numerically and passes the full ZIP URL', async () => {
    updater.listVersions.and.resolveTo({ value: JSON.stringify([
      latest, release(environment.version), release(`${nextMajor}.9.0`)
    ]) });
    expect((await service.checkForUpdates()).updateAvailable).toBeTrue();
    expect(await service.applyUpdate()).toBeTrue();
    expect(updater.getVersion).toHaveBeenCalledOnceWith({ value: latest.url });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('uses the declared version even if the ZIP filename contains no version', async () => {
    const candidate = release(`${nextMajor}.0.0`, 'release');
    updater.listVersions.and.resolveTo({ value: JSON.stringify([candidate]) });
    expect((await service.checkForUpdates()).updateAvailable).toBeTrue();
    await service.applyUpdate();
    expect(updater.getVersion).toHaveBeenCalledWith({ value: candidate.url });
  });

  it('does not offer the installed version, older versions or build-metadata-only changes', async () => {
    for (const version of [environment.version, '0.0.0', environment.version + '+build.2']) {
      updater.listVersions.and.resolveTo({ value: JSON.stringify([release(version)]) });
      expect((await service.checkForUpdates()).updateAvailable).toBeFalse();
      expect(await service.applyUpdate()).toBeFalse();
    }
    expect(updater.getVersion).not.toHaveBeenCalled();
  });

  it('prefers the stable release over its prerelease', async () => {
    updater.listVersions.and.resolveTo({ value: JSON.stringify([
      release(`${nextMajor}.0.0-rc.10`), release(`${nextMajor}.0.0`)
    ]) });
    await service.checkForUpdates(); await service.applyUpdate();
    expect(updater.getVersion).toHaveBeenCalledWith({ value: url(`${nextMajor}_0_0`) });
  });

  it('ignores malformed release entries and invalid download addresses', async () => {
    updater.listVersions.and.resolveTo({ value: JSON.stringify([
      null, 8, { version: `${nextMajor}.99.0`, url: '8' },
      { version: `${nextMajor}.99.0`, url: 'http://example.com/update.zip' },
      { version: `${nextMajor}.99.0`, url: 'https://example.com/update.html' },
      { version: 'invalid', url: url('invalid') }, latest
    ]) });
    await service.checkForUpdates(); await service.applyUpdate();
    expect(updater.getVersion).toHaveBeenCalledWith({ value: latest.url });
  });

  it('clears a stale update after invalid JSON, a non-array response or an empty list', async () => {
    for (const value of ['broken JSON', '{}', '[]']) {
      updater.listVersions.and.resolveTo({ value: JSON.stringify([latest]) });
      await service.checkForUpdates();
      updater.listVersions.and.resolveTo({ value });
      expect((await service.checkForUpdates()).updateAvailable).toBeFalse();
      expect(await service.applyUpdate()).toBeFalse();
    }
    expect(updater.getVersion).not.toHaveBeenCalled();
  });

  it('supports legacy URL arrays and underscored ZIP filenames', async () => {
    updater.listVersions.and.resolveTo({ value: JSON.stringify([latest.url, url('0_0_1')]) });
    await service.checkForUpdates(); await service.applyUpdate();
    expect(updater.getVersion).toHaveBeenCalledWith({ value: latest.url });
  });

  it('does not reload if native installation returns false or rejects', async () => {
    updater.listVersions.and.resolveTo({ value: JSON.stringify([latest]) });
    await service.checkForUpdates();
    updater.getVersion.and.resolveTo({ value: false });
    expect(await service.applyUpdate()).toBeFalse();
    updater.getVersion.and.rejectWith(new Error('download failed'));
    expect(await service.applyUpdate()).toBeFalse();
    expect(reload).not.toHaveBeenCalled();
  });

  it('prevents simultaneous installation requests', async () => {
    updater.listVersions.and.resolveTo({ value: JSON.stringify([latest]) });
    await service.checkForUpdates();
    let finish!: (value: { value: boolean }) => void;
    updater.getVersion.and.returnValue(new Promise(resolve => finish = resolve));
    const pending = service.applyUpdate();
    expect(await service.applyUpdate()).toBeFalse();
    finish({ value: true });
    expect(await pending).toBeTrue();
    expect(updater.getVersion).toHaveBeenCalledTimes(1);
  });
});
