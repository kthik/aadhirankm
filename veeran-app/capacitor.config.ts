import type { CapacitorConfig } from '@capacitor/cli';

/*
 * The shell that packages the real Veeran client as an Android app.
 *
 * webDir points at the Vite build in ../client, so there is exactly one copy of
 * the app: what ships in the APK is what the browser gets.
 *
 * androidScheme is http rather than the default https on purpose. The API is
 * reached over plain HTTP on a venue LAN, and a page served over https://localhost
 * calling http:// is mixed content, which the web view blocks. Serving the page
 * from http://localhost puts both on the same scheme, and cleartext allows the
 * LAN call itself.
 */
const config: CapacitorConfig = {
  appId: 'com.veeran.app',
  appName: 'Veeran',
  webDir: '../client/dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
