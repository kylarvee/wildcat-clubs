import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '@/auth/session';
import { configureNotificationDisplay } from '@/lib/push';
import { openHref } from '@/lib/links';
import { useColors, useIsDark } from '@/theme';

// Web preview: finishes the Google sign-in popup when it lands back here.
WebBrowser.maybeCompleteAuthSession();
SplashScreen.preventAutoHideAsync().catch(() => {});
configureNotificationDisplay();

export default function RootLayout() {
  const c = useColors();
  const dark = useIsDark();
  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, primary: c.brandText, background: c.background, card: c.surface, text: c.ink, border: c.line } };
  return (
    <ThemeProvider value={navTheme}>
      <SessionProvider>
        <Stack screenOptions={{ headerTintColor: c.brandText, headerTitleStyle: { color: c.ink }, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: c.background } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="club/[slug]" options={{ title: '' }} />
          <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
          <Stack.Screen name="c/[code]" options={{ title: 'Check in' }} />
          <Stack.Screen name="tasks" options={{ title: 'Tasks' }} />
          {/* Leader check-in tools: the rotating QR fills the screen; Add someone opens over it. */}
          <Stack.Screen name="live/[id]" options={{ presentation: 'fullScreenModal', headerShown: false, title: 'Check-in QR' }} />
          <Stack.Screen name="live/add/[id]" options={{ presentation: 'modal', title: 'Add someone' }} />
        </Stack>
        <Boot />
        {Platform.OS !== 'web' ? <NotificationTaps /> : null}
        <StatusBar style="auto" />
      </SessionProvider>
    </ThemeProvider>
  );
}

/** Hides the splash once we know who's signed in; greets signed-out people with the sign-in screen once per launch. */
function Boot() {
  const { status } = useSession();
  const pathname = usePathname();
  const greeted = useRef(false);
  useEffect(() => {
    if (status === 'loading') return;
    SplashScreen.hideAsync().catch(() => {});
    // Only from Home — a check-in deep link or a shared club link goes straight where it points.
    if (status === 'signedOut' && !greeted.current && pathname === '/') {
      greeted.current = true;
      const t = setTimeout(() => router.push('/welcome'), 0);
      return () => clearTimeout(t);
    }
    greeted.current = true;
  }, [status, pathname]);
  return null;
}

/** Tapping a push notification opens the screen it's about (or the web page for things the app doesn't do). */
function NotificationTaps() {
  const { status, refreshMe } = useSession();
  const last = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (status === 'loading' || !last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const href = last.notification.request.content.data?.href;
    Notifications.clearLastNotificationResponse();
    if (typeof href === 'string' && href) openHref(href);
    else router.push('/inbox');
  }, [last, status]);

  // A push while the app is open: refresh the inbox badge.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => void refreshMe());
    return () => sub.remove();
  }, [refreshMe]);
  return null;
}
