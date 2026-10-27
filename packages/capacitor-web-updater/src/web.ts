import { WebPlugin } from '@capacitor/core';

import type { UpdaterPlugin } from './definitions';

export class UpdaterWeb extends WebPlugin implements UpdaterPlugin {
  async echo(options: { value: string }): Promise<{ value: string }> {
    console.log('ECHO', options);
    return options;
  }

  async listAssets(): Promise<{ value: string[] }> {
    console.warn("The 'listAssets' method is not implemented for the web platform.");
    return { value: [] };
  }

  async listVersions(): Promise<{ value: string }> {
    console.warn("The 'listVersions' method is not implemented for the web platform.");
    return { value: "[]" };
  }

  async getVersion(): Promise<{ value: boolean }> {
    console.warn("The 'getVersion' method is not implemented for the web platform.");
    // Web platformunda gerçek sürüm bilgisi alınamaz
    return { value: false };
  }
}
