declare module 'capacitor-web-updater' {
  export interface UpdaterPlugin {
    echo(options: { value: string }): Promise<{ value: string }>;
    listAssets(): Promise<{ value: string[] }>;
    listVersions(): Promise<{ value: string[] }>;
    getVersion(options: { value: string }): Promise<{ value: boolean }>;
  }

  export const Updater: UpdaterPlugin;
}