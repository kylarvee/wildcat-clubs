import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { ApiError, configureApi } from '@/api/client';
import { Api } from '@/api/endpoints';
import type { MMe, MSession, MUser } from '@/api/types';
import { clearApiCache } from '@/lib/use-api';
import { getPushToken, setAppBadge } from '@/lib/push';
import { getItem, KEYS, removeItem, setItem } from '@/lib/storage';

/**
 * Who is signed in on this phone. The session token lives in secure storage
 * (expo-secure-store); every API call sends it as a bearer token. Signing in
 * also registers this phone for push notifications unless the person turned
 * them off here.
 */

type Status = 'loading' | 'signedOut' | 'signedIn';

export type PushState =
  | { kind: 'on' }
  | { kind: 'off' }
  | { kind: 'denied'; canAskAgain: boolean }
  | { kind: 'unavailable'; reason: string };

type SessionValue = {
  status: Status;
  user: MUser | null;
  me: MMe | null;
  signIn: (session: MSession) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  /** The inbox changed the unread count; keep the tab badge in step. */
  setUnread: (n: number) => void;
  push: PushState;
  setPushEnabled: (on: boolean) => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

type Stored = { token: string; user: MUser };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<MUser | null>(null);
  const [me, setMe] = useState<MMe | null>(null);
  const [push, setPush] = useState<PushState>({ kind: 'off' });
  const token = useRef<string | null>(null);
  const lastMe = useRef(0);

  const forget = useCallback(async () => {
    token.current = null;
    clearApiCache();
    setUser(null);
    setMe(null);
    setStatus('signedOut');
    setAppBadge(0);
    await removeItem(KEYS.session);
  }, []);

  useEffect(() => {
    configureApi({ getToken: () => token.current, onUnauthorized: () => void forget() });
  }, [forget]);

  const refreshMe = useCallback(async () => {
    if (!token.current) return;
    lastMe.current = Date.now();
    try {
      const next = await Api.me();
      setMe(next);
      setUser(next.user);
      setAppBadge(next.unreadNotifications);
      await setItem(KEYS.session, JSON.stringify({ token: token.current, user: next.user } satisfies Stored));
    } catch (e) {
      // Offline: keep the stored account. A 401 already signed us out (configureApi).
      if (!(e instanceof ApiError)) throw e;
    }
  }, []);

  /** Registers (or re-registers) this phone for pushes unless switched off here. */
  const syncPush = useCallback(async (ask: boolean) => {
    if ((await getItem(KEYS.notifications)) === 'off') {
      setPush({ kind: 'off' });
      return;
    }
    const outcome = await getPushToken(ask);
    if (outcome.status === 'registered') {
      try {
        await Api.registerPush({ token: outcome.token, platform: outcome.platform });
        await setItem(KEYS.pushToken, outcome.token);
        setPush({ kind: 'on' });
      } catch {
        setPush({ kind: 'unavailable', reason: "Couldn't reach Wildcat Clubs to turn on notifications. We'll try again next time you open the app." });
      }
    } else if (outcome.status === 'denied') setPush({ kind: 'denied', canAskAgain: outcome.canAskAgain });
    else setPush({ kind: 'unavailable', reason: outcome.reason });
  }, []);

  // Launch: restore the stored session, then confirm it with the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await getItem(KEYS.session);
      let stored: Stored | null = null;
      try {
        stored = raw ? (JSON.parse(raw) as Stored) : null;
      } catch {
        stored = null;
      }
      if (cancelled) return;
      if (!stored?.token) {
        setStatus('signedOut');
        return;
      }
      token.current = stored.token;
      setUser(stored.user);
      setStatus('signedIn');
      await refreshMe();
      if (token.current) void syncPush(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMe, syncPush]);

  // Back in the foreground: refresh badges (at most every 15 s).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && token.current && Date.now() - lastMe.current > 15_000) void refreshMe();
    });
    return () => sub.remove();
  }, [refreshMe]);

  const signIn = useCallback(
    async (session: MSession) => {
      clearApiCache();
      token.current = session.token;
      setUser(session.user);
      setStatus('signedIn');
      await setItem(KEYS.session, JSON.stringify({ token: session.token, user: session.user } satisfies Stored));
      await refreshMe();
      // Right after signing in is when we ask for notification permission.
      void syncPush(true);
    },
    [refreshMe, syncPush],
  );

  const signOut = useCallback(async () => {
    const current = token.current;
    const pushToken = await getItem(KEYS.pushToken);
    if (current) {
      try {
        await Api.signOut(current, pushToken);
      } catch {
        // Offline: the token still gets forgotten here; it expires on the server.
      }
    }
    await removeItem(KEYS.pushToken);
    setPush({ kind: 'off' });
    await forget();
  }, [forget]);

  const setPushEnabled = useCallback(
    async (on: boolean) => {
      if (on) {
        await removeItem(KEYS.notifications);
        await syncPush(true);
        return;
      }
      await setItem(KEYS.notifications, 'off');
      const pushToken = await getItem(KEYS.pushToken);
      if (pushToken) {
        try {
          await Api.removePush(pushToken);
          await removeItem(KEYS.pushToken);
        } catch {
          // Try again next launch; the switch still reads "off".
        }
      }
      setPush({ kind: 'off' });
    },
    [syncPush],
  );

  const setUnread = useCallback((n: number) => {
    setMe((m) => (m ? { ...m, unreadNotifications: n } : m));
    setAppBadge(n);
  }, []);

  const value: SessionValue = { status, user, me, signIn, signOut, refreshMe, setUnread, push, setPushEnabled };
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession() {
  const ctx = use(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>.');
  return ctx;
}

