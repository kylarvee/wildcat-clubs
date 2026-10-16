import { TZDate } from "@date-fns/tz";
import { campusDate, TZ } from "@/lib/time";

/** Date helpers for the seed. Everything is built in campus (Mountain) time and stored as UTC. */

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const WEEK = 7 * DAY;

export const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);
export const addMin = (d: Date, n: number) => new Date(d.getTime() + n * MIN);
export const addHours = (d: Date, n: number) => new Date(d.getTime() + n * HOUR);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const minDate = (...ds: Date[]) => new Date(Math.min(...ds.map((d) => d.getTime())));
export const maxDate = (...ds: Date[]) => new Date(Math.max(...ds.map((d) => d.getTime())));
export const between = (d: Date, a: Date, b: Date) => d.getTime() >= a.getTime() && d.getTime() < b.getTime();

export { campusDate };

export type LocalParts = { y: number; m: number; d: number; H: number; M: number; dow: number };

/** Campus wall-clock parts of an instant. */
export function local(at: Date): LocalParts {
  const t = new TZDate(at, TZ);
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), H: t.getHours(), M: t.getMinutes(), dow: t.getDay() };
}

/** The same campus calendar day as `at`, at H:M campus time. */
export function atLocal(at: Date, H: number, M = 0): Date {
  const p = local(at);
  return campusDate(p.y, p.m, p.d, H, M);
}

/** Pure calendar arithmetic (no time zone). */
export function calAdd(y: number, m: number, d: number, n: number) {
  const u = new Date(Date.UTC(y, m - 1, d + n));
  return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate(), dow: u.getUTCDay() };
}

export function calDow(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "2026-10-16" in campus time. */
export function ymd(at: Date) {
  const p = local(at);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Tue, Oct 6, 2026 · 6:00 PM" */
export function human(at: Date, withTime = true) {
  const p = local(at);
  const h12 = p.H % 12 === 0 ? 12 : p.H % 12;
  const time = `${h12}:${String(p.M).padStart(2, "0")} ${p.H < 12 ? "AM" : "PM"}`;
  return `${DOWS[p.dow]}, ${MONTHS[p.m - 1]} ${p.d}, ${p.y}${withTime ? ` · ${time}` : ""}`;
}

export function humanTime(at: Date) {
  const p = local(at);
  const h12 = p.H % 12 === 0 ? 12 : p.H % 12;
  return `${h12}:${String(p.M).padStart(2, "0")} ${p.H < 12 ? "AM" : "PM"}`;
}

export function monthDay(at: Date) {
  const p = local(at);
  return `${MONTHS[p.m - 1]} ${p.d}`;
}

/** Rounds down to a 5-minute mark (so "live now" events start at a believable time). */
export function floor5(at: Date) {
  const ms = 5 * MIN;
  return new Date(Math.floor(at.getTime() / ms) * ms);
}
