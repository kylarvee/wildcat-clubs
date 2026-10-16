import "server-only";
import { cache } from "react";
import type { Term } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * The academic calendar, read once per request. Activity, pilot periods,
 * retention by academic year, recurring tests and budgets all measure time
 * in these terms. Sysadmins edit the Term table; nothing else defines terms.
 */
export const getTerms = cache(async (): Promise<Term[]> => db.term.findMany({ orderBy: { startsOn: "asc" } }));

/** The term whose dates contain `at`, or null between terms. */
export function termAt(terms: Term[], at: Date): Term | null {
  return terms.find((t) => t.startsOn <= at && at <= t.endsOn) ?? null;
}

/** The term containing `at`, or else the most recent term that already started. */
export function currentOrLastTerm(terms: Term[], at: Date): Term | null {
  return termAt(terms, at) ?? [...terms].reverse().find((t) => t.startsOn <= at) ?? null;
}

/** The next term after `at` (for budgets planned between terms). */
export function nextTerm(terms: Term[], at: Date): Term | null {
  return terms.find((t) => t.startsOn > at) ?? null;
}

/** The activity-counting term before `term` (summer is skipped when it doesn't count). */
export function previousActivityTerm(terms: Term[], term: Term): Term | null {
  const earlier = terms.filter((t) => t.endsOn < term.startsOn && t.countsForActivity);
  return earlier.at(-1) ?? null;
}

/** Start/end of the academic year containing `at` (first term start → last term end with the same label). */
export function academicYearAt(terms: Term[], at: Date): { label: string; start: Date; end: Date } | null {
  const t = currentOrLastTerm(terms, at);
  if (!t) return null;
  const same = terms.filter((x) => x.academicYear === t.academicYear);
  return { label: t.academicYear, start: same[0].startsOn, end: same.at(-1)!.endsOn };
}

/** The term a date belongs to for budgeting: the containing term, else the next one, else the last one. */
export function budgetTermFor(terms: Term[], at: Date): Term | null {
  return termAt(terms, at) ?? nextTerm(terms, at) ?? terms.at(-1) ?? null;
}
