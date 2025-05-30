import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cesurpolat.TVChannels',
  appName: 'IPTV',
  webDir: 'dist/iptv/browser',
  plugins: {
    
    Updater: {
      autoUpdate: true,
      updateUrl: 'https://advanced-storage.online/iptv/update.json',
      checkInterval: 3600 // Check for updates every hour
    }
  }
};

export default config;
