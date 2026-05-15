import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cesurpolat.TVChannels',
  appName: 'IPTV',
  webDir: 'dist/iptv/browser',
  plugins: {
    
    /* CapacitorNodeJS: {
      "nodeDir": "nodejs"
    }, */

    Updater: {
      baseServerUrl: 'https://cdn.advanced-streaming.online',
    }
  }
};

export default config;
