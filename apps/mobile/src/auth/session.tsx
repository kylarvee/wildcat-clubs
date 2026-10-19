import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
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
  /** Registered with the server. `delivering`: the server's Push switch is on too, so pushes really arrive. */
  | { kind: 'on'; delivering: boolean }
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
  /** Asks the server again whether pushes reach this phone (its Push switch can change while the app is open). */
  refreshPushStatus: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

type Stored = { token: string; user: MUser };
type PendingSignOut = { token: string; pushToken: string | null };

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

  /**
   * Finishes a sign-out that never reached the server. Until it does, the
   * server keeps sending that account's notifications to this phone (and the
   * session stays valid there). Safe to repeat.
   */
  const finishSignOut = useCallback(async () => {
    const raw = await getItem(KEYS.pendingSignOut);
    if (!raw) return;
    try {
      const pending = JSON.parse(raw) as PendingSignOut;
      await Api.signOut(pending.token, pending.pushToken);
    } catch (e) {
      // Still offline: try again on the next launch or return to the app. (Unreadable: drop it.)
      if (e instanceof ApiError) return;
    }
    await removeItem(KEYS.pendingSignOut);
  }, []);

  /** Registers (or re-registers) this phone for pushes unless switched off here. */
  const syncPush = useCallback(async (ask: boolean) => {
    // First, so an old sign-out finishing late can't undo this registration.
    await finishSignOut();
    if ((await getItem(KEYS.notifications)) === 'off') {
      // Switched off while offline: the server still sends here until it hears.
      const stale = await getItem(KEYS.pushToken);
      if (stale && token.current) {
        try {
          await Api.removePush(stale);
          await removeItem(KEYS.pushToken);
        } catch {
          // Still offline: next launch.
        }
      }
      setPush({ kind: 'off' });
      return;
    }
    const outcome = await getPushToken(ask);
    if (outcome.status === 'registered') {
      try {
        const r = await Api.registerPush({ token: outcome.token, platform: outcome.platform });
        await setItem(KEYS.pushToken, outcome.token);
        setPush({ kind: 'on', delivering: r.delivering });
      } catch {
        setPush({ kind: 'unavailable', reason: "Couldn't reach Wildcat Clubs to turn on notifications. We'll try again next time you open the app." });
      }
    } else if (outcome.status === 'denied') setPush({ kind: 'denied', canAskAgain: outcome.canAskAgain });
    else setPush({ kind: 'unavailable', reason: outcome.reason });
  }, [finishSignOut]);

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
        void finishSignOut();
        return;
      }
      token.current = stored.token;
      setUser(stored.user);
      setStatus('signedIn');
      await refreshMe();
      // syncPush starts by finishing any offline sign-out; if the stored session stopped working, just do that.
      if (token.current) void syncPush(false);
      else void finishSignOut();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMe, syncPush, finishSignOut]);

  // Back in the foreground: refresh badges (at most every 15 s), and finish an offline sign-out.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void finishSignOut();
      if (token.current && Date.now() - lastMe.current > 15_000) void refreshMe();
    });
    return () => sub.remove();
  }, [refreshMe, finishSignOut]);

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
        // Offline: forgotten here now; finishSignOut tells the server once we're back online.
        await setItem(KEYS.pendingSignOut, JSON.stringify({ token: current, pushToken } satisfies PendingSignOut));
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

  /**
   * Re-sends this phone's stored token, which changes nothing on the server
   * when it's already registered, to learn whether pushes are delivered now.
   * At most every 30 seconds; quiet when offline.
   */
  const lastPushCheck = useRef(0);
  const pushOn = push.kind === 'on';
  const refreshPushStatus = useCallback(async () => {
    if (!pushOn || !token.current || Date.now() - lastPushCheck.current < 30_000) return;
    const stored = await getItem(KEYS.pushToken);
    if (!stored) return;
    lastPushCheck.current = Date.now();
    try {
      const r = await Api.registerPush({ token: stored, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
      setPush((p) => (p.kind === 'on' ? { kind: 'on', delivering: r.delivering } : p));
    } catch {
      // Offline: keep what we last knew.
    }
  }, [pushOn]);

  const setUnread = useCallback((n: number) => {
    setMe((m) => (m ? { ...m, unreadNotifications: n } : m));
    setAppBadge(n);
  }, []);

  const value: SessionValue = { status, user, me, signIn, signOut, refreshMe, setUnread, push, setPushEnabled, refreshPushStatus };
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession() {
  const ctx = use(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>.');
  return ctx;
}

