import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.santi.splitwiselite',   // keep this stable
  appName: 'Splitwise Lite',
  webDir: 'dist',
  server: { androidScheme: 'https' }
};

export default config;
