import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cesurpolat.TVChannels',
  appName: 'IPTV',
  webDir: 'dist/iptv/browser',
  plugins: {
    
    CapacitorNodeJS: {
      "nodeDir": "nodejs"
    },

    Updater: {//TODO: Implement the updater plugin
      autoUpdate: true,
      updateUrl: 'https://advanced-streaming.online/iptv/update.json',
      checkInterval: 3600 // Check for updates every hour
    }
  }
};

export default config;
