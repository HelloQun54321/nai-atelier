import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.helloqun54321.naiatelier',
  appName: 'NAI Atelier',
  webDir: '.android-build/web',
  server: { androidScheme: 'https', hostname: 'localhost' },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: process.env.ATELIER_ANDROID_DEBUG === '1' },
};

export default config;
