import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Small key/value storage. On phones it's the keychain / keystore
 * (expo-secure-store), which is where the session token belongs. The web
 * preview has no secure store, so it falls back to localStorage.
 */

function webStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export async function getItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return webStorage()?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') webStorage()?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Storage full or locked: the app still works for this launch.
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') webStorage()?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing to clean up.
  }
}

export const KEYS = {
  session: 'wc.session',
  pushToken: 'wc.pushToken',
  /** "off" when the person switched notifications off on this phone. */
  notifications: 'wc.notifications',
} as const;
