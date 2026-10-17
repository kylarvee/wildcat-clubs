import { TZDate } from "@date-fns/tz";
import { format, formatDistanceToNowStrict, isSameDay } from "date-fns";
import { INSTITUTION } from "@/lib/institution";

/** All dates are stored in UTC and shown in campus time. */
export const TZ = INSTITUTION.timezone;

export function inCampusTime(d: Date | string | number): TZDate {
  return new TZDate(new Date(d), TZ);
}

/** "Thu, Oct 16" */
export function fmtDate(d: Date | string, pattern = "EEE, MMM d") {
  return format(inCampusTime(d), pattern);
}

/** "Oct 16, 2026" */
export function fmtLongDate(d: Date | string) {
  return format(inCampusTime(d), "MMM d, yyyy");
}

/** "6:30 PM" */
export function fmtTime(d: Date | string) {
  return format(inCampusTime(d), "h:mm a");
}

/** "Thu, Oct 16 · 6:30 – 8:00 PM" (or across days when needed). */
export function fmtRange(start: Date | string, end: Date | string, allDay = false) {
  const s = inCampusTime(start);
  // All-day ends are exclusive (the next midnight), so the last day is the one before.
  const e = inCampusTime(allDay ? Math.max(s.getTime(), new Date(end).getTime() - 1) : end);
  if (allDay) return isSameDay(s, e) ? `${format(s, "EEE, MMM d")} · All day` : `${format(s, "MMM d")} – ${format(e, "MMM d")}`;
  if (isSameDay(s, e)) {
    // "10:00 AM – 2:00 PM" needs both halves of the day; "6:30 – 8:00 PM" doesn't.
    const startPattern = format(s, "a") === format(e, "a") ? "EEE, MMM d · h:mm" : "EEE, MMM d · h:mm a";
    return `${format(s, startPattern)} – ${format(e, "h:mm a")}`;
  }
  return `${format(s, "MMM d, h:mm a")} – ${format(e, "MMM d, h:mm a")}`;
}

export function fmtAgo(d: Date | string) {
  return `${formatDistanceToNowStrict(new Date(d))} ago`;
}

export function fmtMoney(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Builds a UTC Date from campus-local wall time parts (month is 1-based). */
export function campusDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(new TZDate(year, month - 1, day, hour, minute, TZ).getTime());
}

export const DAY_MS = 86_400_000;
