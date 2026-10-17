import type { Recurrence, Term } from "@prisma/client";
import { TZDate } from "@date-fns/tz";
import { TZ, campusDate } from "@/lib/time";

/**
 * Expands an event's recurrence into concrete occurrences (start/end pairs).
 * All rules work in campus wall-clock time, so a 6 PM weekly meeting stays at
 * 6 PM across daylight-saving changes.
 *
 *  NONE             one occurrence
 *  DAILY            every `interval` days
 *  WEEKLY           every `interval` weeks on `weekdays` (default: the start's weekday)
 *  MONTHLY          same day of month every `interval` months (months without that day are skipped)
 *  YEARLY           same month/day every `interval` years
 *  SEMESTERLY       once per term that counts for activity, same offset from the term's first day
 *  ACADEMIC_YEARLY  once per academic year, in the same kind of term (fall/spring), same offset
 *                   (for both: a start between terms means each term's first day)
 *  All-day meetings run from campus midnight to the next campus midnight.
 *
 * Without `until` or `count`, recurrence runs one year past the start. With only
 * a `count`, the count decides (up to MAX_OCCURRENCES, within five years).
 */

export type RecurrenceSpec = {
  startsAt: Date;
  durationMinutes: number;
  allDay?: boolean;
  recurrence: Recurrence;
  interval?: number;
  weekdays?: number[];
  until?: Date | null;
  count?: number | null;
};

export type OccurrenceTimes = { startsAt: Date; endsAt: Date };

export const MAX_OCCURRENCES = 400;
const DEFAULT_HORIZON_DAYS = 365;
const COUNT_HORIZON_DAYS = 5 * 366;

type Local = { y: number; m: number; d: number; H: number; M: number; dow: number };

function local(at: Date): Local {
  const t = new TZDate(at, TZ);
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), H: t.getHours(), M: t.getMinutes(), dow: t.getDay() };
}

/** Calendar arithmetic on local dates (no time zone involved). */
function shiftDays(p: { y: number; m: number; d: number }, n: number) {
  const u = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate(), dow: u.getUTCDay() };
}

function daysBetween(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }) {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function expandOccurrences(spec: RecurrenceSpec, terms: Term[] = []): OccurrenceTimes[] {
  const start = local(spec.startsAt);
  const durMs = Math.max(5, spec.durationMinutes) * 60_000;
  // An all-day meeting ends at the next campus midnight (23 or 25 hours away on daylight-saving days).
  const endOf = (s: Date) => {
    if (!spec.allDay) return new Date(s.getTime() + durMs);
    const n = shiftDays(local(s), 1);
    return campusDate(n.y, n.m, n.d);
  };
  const interval = Math.max(1, spec.interval ?? 1);
  const horizon = spec.until ?? new Date(spec.startsAt.getTime() + (spec.count ? COUNT_HORIZON_DAYS : DEFAULT_HORIZON_DAYS) * 86_400_000);
  const limit = Math.min(spec.count ?? MAX_OCCURRENCES, MAX_OCCURRENCES);

  const out: OccurrenceTimes[] = [];
  const push = (y: number, m: number, d: number) => {
    const s = spec.allDay ? campusDate(y, m, d, 0, 0) : campusDate(y, m, d, start.H, start.M);
    if (s < spec.startsAt || s > endOfLocalDay(horizon)) return false;
    out.push({ startsAt: s, endsAt: endOf(s) });
    return true;
  };
  const done = () => out.length >= limit;

  switch (spec.recurrence) {
    case "NONE":
      out.push({ startsAt: spec.startsAt, endsAt: endOf(spec.startsAt) });
      break;

    case "DAILY":
      for (let i = 0; !done(); i += interval) {
        const p = shiftDays(start, i);
        if (campusDate(p.y, p.m, p.d) > horizon) break;
        push(p.y, p.m, p.d);
      }
      break;

    case "WEEKLY": {
      const days = (spec.weekdays?.length ? [...new Set(spec.weekdays)] : [start.dow]).filter((x) => x >= 0 && x <= 6).sort();
      const weekStart = shiftDays(start, -start.dow); // Sunday of the start week
      for (let w = 0; !done(); w += interval) {
        const sunday = shiftDays(weekStart, w * 7);
        if (campusDate(sunday.y, sunday.m, sunday.d) > horizon) break;
        for (const dow of days) {
          if (done()) break;
          const p = shiftDays(sunday, dow);
          push(p.y, p.m, p.d);
        }
      }
      break;
    }

    case "MONTHLY":
      for (let i = 0; !done(); i += interval) {
        const mIndex = start.m - 1 + i;
        const y = start.y + Math.floor(mIndex / 12);
        const m = (mIndex % 12) + 1;
        if (campusDate(y, m, 1) > horizon) break;
        if (start.d <= daysInMonth(y, m)) push(y, m, start.d);
      }
      break;

    case "YEARLY":
      for (let i = 0; !done(); i += interval) {
        const y = start.y + i;
        if (campusDate(y, 1, 1) > horizon) break;
        if (start.d <= daysInMonth(y, start.m)) push(y, start.m, start.d);
      }
      break;

    case "SEMESTERLY":
    case "ACADEMIC_YEARLY": {
      const sorted = [...terms].sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());
      const home = sorted.find((t) => t.startsOn <= spec.startsAt && spec.startsAt <= t.endsOn) ?? sorted.find((t) => t.startsOn > spec.startsAt);
      if (!home) {
        out.push({ startsAt: spec.startsAt, endsAt: endOf(spec.startsAt) });
        break;
      }
      // A start between terms has no place in a term, so it lands on each term's first day.
      const offset = Math.max(0, daysBetween(local(home.startsOn), start));
      const candidates = sorted.filter(
        (t) => t.startsOn >= home.startsOn && (spec.recurrence === "SEMESTERLY" ? t.countsForActivity || t.id === home.id : t.kind === home.kind),
      );
      // Semesterly with interval 2 = every other term, etc.
      for (let i = 0; i < candidates.length && !done(); i += interval) {
        const t = candidates[i];
        const p = shiftDays(local(t.startsOn), offset);
        if (campusDate(p.y, p.m, p.d) > t.endsOn) continue; // offset runs past a short term
        if (campusDate(p.y, p.m, p.d) > horizon && spec.until) break;
        push(p.y, p.m, p.d);
      }
      break;
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

function endOfLocalDay(at: Date) {
  const p = local(at);
  return campusDate(p.y, p.m, p.d, 23, 59);
}

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  NONE: "Does not repeat",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  SEMESTERLY: "Every semester",
  ACADEMIC_YEARLY: "Every academic year",
  YEARLY: "Every year",
};

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
