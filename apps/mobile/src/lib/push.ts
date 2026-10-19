import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { isRunningInExpoGo } from 'expo';
import { BRAND } from '@/theme';

/**
 * Push notifications through Expo's push service (the server's
 * lib/integrations/push sends to the tokens registered here).
 *
 * Getting a token needs an EAS project id: EXPO_PUBLIC_EAS_PROJECT_ID (in
 * .env.local or the EAS build's environment; app.config.ts copies it into
 * extra.eas.projectId) or app.json → expo.extra.eas.projectId. Android also
 * needs a Firebase google-services.json (README → Push notifications).
 * Without them — or on the web, or in Expo Go on Android, which can't receive
 * pushes — we skip quietly and say why in Me → Settings; everything else in
 * the app still works.
 */

export type PushOutcome =
  | { status: 'registered'; token: string; platform: 'ios' | 'android' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'unavailable'; reason: string };

export function pushProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId || Constants.easConfig?.projectId || process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() || null;
}

/** Why push can't work in this build at all (null = it can). */
export function pushUnavailableReason(): string | null {
  if (Platform.OS === 'web') return 'Push notifications come through the phone app, not the web preview.';
  if (Platform.OS === 'android' && isRunningInExpoGo()) return "Expo Go on Android can't receive push notifications. A development or store build can.";
  if (!pushProjectId()) return "This build isn't linked to an EAS project yet, so it can't get push notifications. The Notifications tab still updates.";
  return null;
}

/** Shows notifications as banners while the app is open. Call once at startup. */
export function configureNotificationDisplay() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
  });
}

/**
 * Asks for permission (when `ask` and the OS still allows asking) and returns
 * this phone's Expo push token.
 */
export async function getPushToken(ask: boolean): Promise<PushOutcome> {
  const unavailable = pushUnavailableReason();
  if (unavailable) return { status: 'unavailable', reason: unavailable };
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Wildcat Clubs',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: BRAND,
      });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && ask && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return { status: 'denied', canAskAgain: perm.canAskAgain };
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: pushProjectId()! });
    return { status: 'registered', token: data, platform: Platform.OS === 'ios' ? 'ios' : 'android' };
  } catch (e) {
    return { status: 'unavailable', reason: e instanceof Error && e.message ? `Couldn't turn on push notifications: ${e.message}` : "Couldn't turn on push notifications on this phone." };
  }
}

/** Keeps the app icon's badge in step with unread notifications (best effort). */
export function setAppBadge(count: number) {
  if (Platform.OS === 'web') return;
  Notifications.setBadgeCountAsync(count).catch(() => {});
}
