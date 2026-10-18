import { differenceInCalendarDays } from "date-fns";
import { fmtDate, inCampusTime } from "@/lib/time";

/**
 * Dashboard date wording, in campus time. Pure, so server components and
 * tests share it.
 */

/** "Today 5:30 PM", "Tomorrow 6:00 PM", "Thu 5:30 PM" within a week, then "Nov 3, 5:30 PM". */
export function meetingLabel(at: Date, now: Date): string {
  const days = differenceInCalendarDays(inCampusTime(at), inCampusTime(now));
  const time = fmtDate(at, "h:mm a");
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days < 7) return `${fmtDate(at, "EEE")} ${time}`;
  return `${fmtDate(at, "MMM d")}, ${time}`;
}

/** Agenda day headings: "Today", "Tomorrow", then "Tue, Oct 20". */
export function agendaDayLabel(at: Date, now: Date): string {
  const days = differenceInCalendarDays(inCampusTime(at), inCampusTime(now));
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return fmtDate(at, "EEE, MMM d");
}

/** Campus calendar day key, for grouping ("2026-10-20"). */
export function dayKey(at: Date): string {
  return fmtDate(at, "yyyy-MM-dd");
}

const ROLE_PLURAL: Record<string, string> = { PRESIDENT: "presidents", VP: "VPs", OFFICER: "officers", AMBASSADOR: "ambassadors" };
const ROLE_ORDER = ["PRESIDENT", "VP", "OFFICER", "AMBASSADOR"];

/** Who a requirement reaches, in words: "Every club member", "Presidents, VPs and officers". */
export function audienceLabel(appliesTo: readonly string[]): string {
  if (appliesTo.includes("MEMBER")) return "Every club member";
  const names = ROLE_ORDER.filter((r) => appliesTo.includes(r)).map((r) => ROLE_PLURAL[r]);
  if (!names.length) return "Nobody yet";
  const text = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return text[0].toUpperCase() + text.slice(1);
}

/** "1 person" / "3 people". */
export function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}
