import { Platform } from 'react-native';

/**
 * Where the app finds Wildcat Clubs. Set EXPO_PUBLIC_API_URL to the web
 * server's address; on a phone that's your computer's LAN IP (see README),
 * because "localhost" on a phone means the phone itself.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3100').replace(/\/+$/, '');

/**
 * Google OAuth client ids for "Continue with Weber State Google". Each is
 * optional; the button only shows on a platform whose id is set (and when the
 * server can verify Google tokens).
 */
const GOOGLE_CLIENT_IDS = {
  ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
  android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
  web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
};

export function googleClientIdForPlatform(): string {
  if (Platform.OS === 'ios') return GOOGLE_CLIENT_IDS.ios;
  if (Platform.OS === 'android') return GOOGLE_CLIENT_IDS.android;
  if (Platform.OS === 'web') return GOOGLE_CLIENT_IDS.web;
  return '';
}

export const GOOGLE_IDS = GOOGLE_CLIENT_IDS;
