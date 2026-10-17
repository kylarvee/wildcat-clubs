import { useSyncExternalStore } from 'react';

/**
 * "Not now" on a live check-in prompt. Remembered until the app closes (the
 * web prompt does the same per browser session), and shared by the Home
 * banners and the club page pop-up so one "Not now" covers both.
 */
let dismissed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function dismissLive(occurrenceId: string) {
  // A new Set each time, so components (and the React Compiler) see a change.
  dismissed = new Set([...dismissed, occurrenceId]);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const snapshot = () => dismissed;

/** The occurrence ids dismissed so far this launch. */
export function useLiveDismissals(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
