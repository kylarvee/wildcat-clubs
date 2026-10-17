import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { router, type Href } from 'expo-router';
import { API_URL } from '@/config';
import { parseCheckinInput } from '@/lib/checkin-link';

/**
 * Notifications and announcements carry web paths ("/clubs/chess-club",
 * "/events/…?o=…"). The phone app has screens for the everyday ones; anything
 * else (budgets, tasks, tests, messages…) opens on the web in the in-app
 * browser. That browser keeps its own web sign-in: the first signed-in page
 * asks you to sign in there once, and it remembers you after that.
 */
export function routeForHref(href: string): Href | null {
  let url: URL;
  try {
    url = new URL(href, API_URL);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);

  if (parts[0] === 'c' && parts[1]) {
    const parsed = parseCheckinInput({ url: url.toString() });
    if (parsed) return { pathname: '/c/[code]', params: { code: parsed.code, ...(parsed.token ? { t: parsed.token } : {}) } };
  }
  if (path === '/' || path === '/dashboard') return '/';
  if (path === '/clubs') return '/clubs';
  if (parts[0] === 'clubs' && parts.length === 2) return { pathname: '/club/[slug]', params: { slug: parts[1] } };
  // The event screen takes a meeting id, or an event id (it opens the next meeting).
  if (parts[0] === 'events' && parts[1] && parts.length === 2) return { pathname: '/event/[id]', params: { id: url.searchParams.get('o') || parts[1] } };
  if (path === '/calendar') return '/calendar';
  if (path === '/notifications') return '/inbox';
  if (path === '/me/attendance') return '/me';
  return null;
}

/** Opens a Wildcat Clubs page on the web (in-app browser on phones). */
export async function openWeb(path = '/') {
  const url = /^https?:\/\//i.test(path) ? path : `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    await Linking.openURL(url);
  }
}

/** Follows a notification / announcement link: a screen when the app has one, else the web. */
export function openHref(href: string | null | undefined) {
  if (!href) return;
  const route = routeForHref(href);
  if (route) router.push(route);
  else void openWeb(href);
}

/** Opens a place in the phone's maps app. */
export function openMaps(query: string) {
  const q = encodeURIComponent(query);
  const url = Platform.OS === 'ios' ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
  void Linking.openURL(url);
}
