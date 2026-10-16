import { TZDate } from "@date-fns/tz";
import { TZ, campusDate } from "@/lib/time";

/**
 * Campus wall-clock helpers (client-safe).
 *
 * Calendars show campus time no matter where the viewer's browser is. The
 * calendar feed sends FullCalendar offset-less campus times ("2026-10-20T18:00:00")
 * and our calendars run FullCalendar in its "UTC" zone, so 6 PM in Ogden shows as
 * 6 PM everywhere. Dates FullCalendar hands back (selections, drags) are those
 * "fake UTC" wall-clock values; fromFakeUtc() turns them into real instants.
 */

export type CampusParts = { y: number; m: number; d: number; H: number; M: number; dow: number };

export function campusParts(at: Date | string | number): CampusParts {
  const t = new TZDate(new Date(at), TZ);
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), H: t.getHours(), M: t.getMinutes(), dow: t.getDay() };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-20T18:00:00" — campus wall clock, no offset. */
export function toWallClockIso(at: Date | string): string {
  const p = campusParts(at);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.H)}:${pad(p.M)}:00`;
}

/** "2026-10-20" in campus time (for <input type="date"> and all-day events). */
export function toDateInput(at: Date | string): string {
  const p = campusParts(at);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** "18:00" in campus time (for <input type="time">). */
export function toTimeInput(at: Date | string): string {
  const p = campusParts(at);
  return `${pad(p.H)}:${pad(p.M)}`;
}

/** Real instant from campus date + time inputs ("2026-10-20", "18:00"). Null when incomplete. */
export function fromInputs(date: string, time = "00:00"): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})/.exec(time || "00:00");
  if (!dm || !tm) return null;
  return campusDate(Number(dm[1]), Number(dm[2]), Number(dm[3]), Number(tm[1]), Number(tm[2]));
}

/** FullCalendar (timeZone "UTC") date → the real instant it stands for. */
export function fromFakeUtc(d: Date): Date {
  return campusDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}

/** A real instant → the "fake UTC" Date FullCalendar uses to show it in campus time. */
export function toFakeUtc(at: Date | string): Date {
  const p = campusParts(at);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, p.H, p.M));
}

/** Adds whole days to a campus calendar date ("2026-10-20" + 1 → "2026-10-21"). */
export function addDaysToDateInput(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const u = new Date(Date.UTC(y, m - 1, d + days));
  return `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())}`;
}
