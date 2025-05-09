import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cesurpolat.TVChannels',
  appName: 'IPTV',
  webDir: 'dist/iptv/browser',
  plugins: {
    SplashScreen: {
      launchAutoHide: false
    },
    LiveUpdates: {
      appId: '960ae4f0',
      channel: 'Production'
    }
  }
};

export default config;
