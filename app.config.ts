import type { ExpoConfig } from 'expo/config';
const config: ExpoConfig = {
  name: '青账',
  slug: 'qingzhang',
  version: '1.0.0',
  scheme: 'qingzhang',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: 'com.qingzhang.app',
    supportsTablet: true,
    infoPlist: {
      CFBundleDisplayName: '青账',
      ITSAppUsesNonExemptEncryption: false,
      UIFileSharingEnabled: false,
      LSSupportsOpeningDocumentsInPlace: false,
    },
  },
  android: {
    package: 'com.qingzhang.app',
    versionCode: 1,
    allowBackup: false,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#16846B' },
    permissions: ['POST_NOTIFICATIONS'],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/favicon.png',
    name: '青账 · 让生活心中有数',
    themeColor: '#16846B',
  },
  updates: { enabled: false },
  plugins: [
    'expo-sqlite',
    'expo-sharing',
    'expo-font',
    '@react-native-community/datetimepicker',
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        imageWidth: 180,
        backgroundColor: '#F4F7F5',
        dark: { backgroundColor: '#101D19' },
      },
    ],
    ['expo-notifications', { color: '#16846B' }],
    './plugins/withLocalOnlyBackup.js',
  ],
};
export default config;
