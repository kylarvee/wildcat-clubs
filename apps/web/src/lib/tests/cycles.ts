/**
 * Cycles — which "round" of a recurring test (or a renewing officer
 * requirement) a moment belongs to. Pure: pass the academic calendar in.
 * Keys are stored on TestAssignment / TestAttempt.cycleKey, so they must stay
 * stable: "once", "2026-W42", "2026-10", "Fall 2026", "2026-2027", "2026".
 * All boundaries are in campus time (America/Denver).
 */
import type { RenewalPeriod, TestRecurrence } from "@prisma/client";
import { TZDate } from "@date-fns/tz";
import { addDays, getISOWeek, getISOWeekYear, startOfISOWeek } from "date-fns";
import { TZ } from "@/lib/time";

export type TermLike = { name: string; academicYear: string; startsOn: Date; endsOn: Date };

export type Cycle = {
  key: string;
  /** For people: "Week of Oct 12", "October 2026", "Fall 2026", "2026–27", "2026". */
  label: string;
  start: Date;
  /** Exclusive end; null for "once". */
  end: Date | null;
};

const ONCE: Cycle = { key: "once", label: "One time", start: new Date(0), end: null };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/** The term containing `at`, else the most recent term that already started (same rule as lib/terms). */
export function currentOrLastTermOf<T extends TermLike>(terms: T[], at: Date): T | null {
  const sorted = [...terms].sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());
  return sorted.find((t) => t.startsOn <= at && at <= t.endsOn) ?? [...sorted].reverse().find((t) => t.startsOn <= at) ?? null;
}

/** "2026-2027" → "2026–27". */
export function shortAcademicYear(label: string): string {
  const m = /^(\d{4})-(\d{4})$/.exec(label);
  return m ? `${m[1]}–${m[2].slice(2)}` : label;
}

function weekCycle(at: Date): Cycle {
  const local = new TZDate(at, TZ);
  const start = startOfISOWeek(local);
  const key = `${getISOWeekYear(local)}-W${String(getISOWeek(local)).padStart(2, "0")}`;
  return { key, label: `Week of ${SHORT_MONTHS[start.getMonth()]} ${start.getDate()}`, start: new Date(start.getTime()), end: new Date(addDays(start, 7).getTime()) };
}

function monthCycle(at: Date): Cycle {
  const local = new TZDate(at, TZ);
  const y = local.getFullYear();
  const m = local.getMonth();
  return {
    key: `${y}-${String(m + 1).padStart(2, "0")}`,
    label: `${MONTHS[m]} ${y}`,
    start: new Date(new TZDate(y, m, 1, TZ).getTime()),
    end: new Date(new TZDate(m === 11 ? y + 1 : y, (m + 1) % 12, 1, TZ).getTime()),
  };
}

function yearCycle(at: Date): Cycle {
  const y = new TZDate(at, TZ).getFullYear();
  return { key: String(y), label: String(y), start: new Date(new TZDate(y, 0, 1, TZ).getTime()), end: new Date(new TZDate(y + 1, 0, 1, TZ).getTime()) };
}

function termCycle(at: Date, terms: TermLike[]): Cycle {
  const t = currentOrLastTermOf(terms, at);
  if (!t) return yearCycle(at); // no calendar yet: fall back to calendar years
  return { key: t.name, label: t.name, start: t.startsOn, end: new Date(t.endsOn.getTime() + 1) };
}

function academicYearCycle(at: Date, terms: TermLike[]): Cycle {
  const t = currentOrLastTermOf(terms, at);
  if (!t) {
    // No calendar: July–June in campus time.
    const local = new TZDate(at, TZ);
    const y = local.getMonth() >= 6 ? local.getFullYear() : local.getFullYear() - 1;
    const label = `${y}-${y + 1}`;
    return { key: label, label: shortAcademicYear(label), start: new Date(new TZDate(y, 6, 1, TZ).getTime()), end: new Date(new TZDate(y + 1, 6, 1, TZ).getTime()) };
  }
  const same = terms.filter((x) => x.academicYear === t.academicYear).sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());
  return { key: t.academicYear, label: shortAcademicYear(t.academicYear), start: same[0].startsOn, end: new Date(same.at(-1)!.endsOn.getTime() + 1) };
}

/** The cycle a recurring test is in at `at`. */
export function testCycle(recurrence: TestRecurrence, at: Date, terms: TermLike[]): Cycle {
  switch (recurrence) {
    case "ONE_OFF":
      return ONCE;
    case "WEEKLY":
      return weekCycle(at);
    case "MONTHLY":
      return monthCycle(at);
    case "SEMESTER":
      return termCycle(at, terms);
    case "ACADEMIC_YEAR":
      return academicYearCycle(at, terms);
    case "ANNUAL":
      return yearCycle(at);
  }
}

/**
 * The cycle an officer requirement is in. Matches lib/authz/requirements
 * periodStartFor(): NONE never renews, SEMESTER = the current (or last) term,
 * ACADEMIC_YEAR = its first term's start, ANNUAL = Jan 1 campus time.
 */
export function renewalCycle(renewal: RenewalPeriod, at: Date, terms: TermLike[]): Cycle {
  switch (renewal) {
    case "NONE":
      return ONCE;
    case "SEMESTER":
      return termCycle(at, terms);
    case "ACADEMIC_YEAR":
      return academicYearCycle(at, terms);
    case "ANNUAL":
      return yearCycle(at);
  }
}

/** The renewal period that matches a test recurrence, when one exists (requirements renew by these). */
export function recurrenceForRenewal(renewal: RenewalPeriod): TestRecurrence {
  return renewal === "NONE" ? "ONE_OFF" : renewal === "SEMESTER" ? "SEMESTER" : renewal === "ANNUAL" ? "ANNUAL" : "ACADEMIC_YEAR";
}

/** A friendly label for a stored cycle key ("2026-2027" → "2026–27", "once" → "One time"). */
export function cycleKeyLabel(key: string): string {
  if (key === "once") return "One time";
  if (/^\d{4}-\d{4}$/.test(key)) return shortAcademicYear(key);
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (month) return `${MONTHS[Number(month[2]) - 1] ?? month[2]} ${month[1]}`;
  const week = /^(\d{4})-W(\d{2})$/.exec(key);
  if (week) return `Week ${Number(week[2])}, ${week[1]}`;
  return key;
}
