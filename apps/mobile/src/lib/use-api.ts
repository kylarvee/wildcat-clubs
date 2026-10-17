import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Loads one API resource for a screen: first load, pull-to-refresh, a quiet
 * refresh when the screen comes back into focus, and the last answer kept per
 * key so going back to a screen shows it instantly (and offline). Keys should
 * include the user id so one account never sees another's cached data.
 */

type Entry = { data: unknown; at: number };
const cache = new Map<string, Entry>();
/** Bumped when something changed server-side (a check-in, joining a club). */
let epoch = 0;

/** Forget everything (sign-out). */
export function clearApiCache() {
  cache.clear();
  epoch++;
}

/** After a write: every screen refetches the next time it's in view. */
export function invalidateApi() {
  epoch++;
}

type State<T> = { data: T | undefined; error: unknown; loading: boolean; refreshing: boolean };

export function useApi<T>(key: string | null, fetcher: () => Promise<T>, opts: { staleMs?: number; keepPrevious?: boolean } = {}) {
  const staleMs = opts.staleMs ?? 30_000;
  const keepPrevious = Boolean(opts.keepPrevious);
  const [state, setState] = useState<State<T>>(() => {
    const hit = key ? cache.get(key) : undefined;
    return { data: hit?.data as T | undefined, error: null, loading: Boolean(key) && !hit, refreshing: false };
  });
  const fetcherRef = useRef(fetcher);
  const request = useRef(0);
  const lastLoad = useRef(0);
  const seenEpoch = useRef(epoch);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (!key) return;
      const id = ++request.current;
      lastLoad.current = Date.now();
      seenEpoch.current = epoch;
      setState((s) => ({ ...s, loading: mode === 'initial' && s.data === undefined, refreshing: mode === 'refresh' }));
      try {
        const data = await fetcherRef.current();
        if (id !== request.current) return;
        cache.set(key, { data, at: Date.now() });
        setState({ data, error: null, loading: false, refreshing: false });
      } catch (error) {
        if (id !== request.current) return;
        setState((s) => ({ ...s, error, loading: false, refreshing: false }));
      }
    },
    [key],
  );

  // New key (or sign-in / sign-out): show what we have, then fetch.
  useEffect(() => {
    if (!key) {
      request.current++;
      setState({ data: undefined, error: null, loading: false, refreshing: false });
      return;
    }
    const hit = cache.get(key);
    // Search-style screens keep showing the last results while the next ones load.
    setState((s) => ({ data: hit ? (hit.data as T) : keepPrevious ? s.data : undefined, error: null, loading: !hit, refreshing: false }));
    void load(hit ? 'silent' : 'initial');
  }, [key, load, keepPrevious]);

  // Coming back to the screen: refresh quietly if it's been a while.
  useFocusEffect(
    useCallback(() => {
      if (key && (seenEpoch.current !== epoch || Date.now() - lastLoad.current > staleMs)) void load('silent');
    }, [key, load, staleMs]),
  );

  const refresh = useCallback(() => load('refresh'), [load]);
  const reload = useCallback(() => load('initial'), [load]);
  const setData = useCallback(
    (update: (prev: T | undefined) => T | undefined) => {
      setState((s) => {
        const data = update(s.data);
        if (key && data !== undefined) cache.set(key, { data, at: Date.now() });
        return { ...s, data };
      });
    },
    [key],
  );

  return { ...state, refresh, reload, setData };
}
