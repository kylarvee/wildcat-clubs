/**
 * Client-side time labels. The server already labels event times in campus
 * time; these cover the few instants the app formats itself (check-in time,
 * "5 min ago"), also in campus time so they match the web.
 */
const CAMPUS_TZ = 'America/Denver';

function fmt(iso: string, opts: Intl.DateTimeFormatOptions) {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: CAMPUS_TZ }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-US', opts).format(d);
  }
}

/** "6:42 PM" */
export function campusTime(iso: string) {
  return fmt(iso, { hour: 'numeric', minute: '2-digit' });
}

/** "Oct 3" or "Oct 3, 2025" outside this year. */
export function campusDay(iso: string) {
  const sameYear = new Date(iso).getFullYear() === new Date().getFullYear();
  return fmt(iso, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Just now", "12 min ago", "3 h ago", "Yesterday", "Oct 3". */
export function timeAgo(iso: string, now = Date.now()) {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'Yesterday';
  return campusDay(iso);
}

/** 0.83 → "83%"; null → "—". */
export function pct(rate: number | null | undefined) {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Psychology Club's", "Wildcat Robotics'". */
export function possessive(name: string) {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}
