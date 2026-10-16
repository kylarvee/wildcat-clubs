import type { Recurrence } from "@prisma/client";
import { fmtDate, fmtTime } from "@/lib/time";
import { campusParts } from "@/lib/events/wallclock";

/**
 * Plain-English recurrence summaries ("Every Tuesday and Thursday until Dec 11").
 * Client-safe, so the editor can show the summary as people change the rule.
 */

export type RecurrenceSummaryInput = {
  startsAt: Date | string;
  recurrence: Recurrence;
  interval?: number | null;
  weekdays?: number[] | null;
  until?: Date | string | null;
  count?: number | null;
  allDay?: boolean;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PLURAL_DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "Tuesday", "Tuesday and Thursday", "Monday, Wednesday and Friday". */
export function joinWords(words: string[]) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function untilText(until: Date | string, startsAt: Date | string) {
  const sameYear = campusParts(until).y === campusParts(startsAt).y;
  return fmtDate(until, sameYear ? "MMM d" : "MMM d, yyyy");
}

export function describeRecurrence(r: RecurrenceSummaryInput): string {
  const n = Math.max(1, r.interval ?? 1);
  const start = campusParts(r.startsAt);
  let base: string;
  switch (r.recurrence) {
    case "NONE":
      return "Does not repeat";
    case "DAILY":
      base = n === 1 ? "Every day" : `Every ${n} days`;
      break;
    case "WEEKLY": {
      const days = (r.weekdays?.length ? [...new Set(r.weekdays)] : [start.dow]).filter((d) => d >= 0 && d <= 6).sort();
      if (n === 1 && days.length === 5 && days.join() === "1,2,3,4,5") base = "Every weekday";
      else if (n === 1) base = `Every ${joinWords(days.map((d) => DAY_NAMES[d]))}`;
      else base = `Every ${n} weeks on ${joinWords(days.map((d) => PLURAL_DAY_NAMES[d]))}`;
      break;
    }
    case "MONTHLY":
      base = `${n === 1 ? "Every month" : `Every ${n} months`} on the ${ordinal(start.d)}`;
      break;
    case "YEARLY":
      base = `${n === 1 ? "Every year" : `Every ${n} years`} on ${fmtDate(r.startsAt, "MMM d")}`;
      break;
    case "SEMESTERLY":
      base = n === 1 ? "Once every semester" : `Once every ${n} semesters`;
      break;
    case "ACADEMIC_YEARLY":
      base = n === 1 ? "Once every academic year" : `Once every ${n} academic years`;
      break;
  }
  if (r.until) return `${base} until ${untilText(r.until, r.startsAt)}`;
  if (r.count) return `${base}, ${r.count} ${r.count === 1 ? "time" : "times"}`;
  return `${base} for a year`;
}

/** "Every Tuesday and Thursday until Dec 11 · 6:00 PM" */
export function describeSchedule(r: RecurrenceSummaryInput): string {
  const when = r.allDay ? "all day" : fmtTime(r.startsAt);
  if (r.recurrence === "NONE") return `${fmtDate(r.startsAt, "EEEE, MMM d, yyyy")} · ${when}`;
  return `${describeRecurrence(r)} · ${when}`;
}
