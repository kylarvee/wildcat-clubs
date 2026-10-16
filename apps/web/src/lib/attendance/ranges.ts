import { campusDate, DAY_MS, fmtDate } from "@/lib/time";

/**
 * Date ranges for the attendance tracker and "my attendance" filters
 * (this term / last term / academic year / custom). Pure: callers pass the
 * academic calendar (lib/terms getTerms()) so this can be tested without a DB.
 * Custom dates are campus-calendar days (YYYY-MM-DD), inclusive on both ends.
 */

export type RangeKey = "term" | "lastTerm" | "year" | "custom";
export type PresetRangeKey = Exclude<RangeKey, "custom">;

export const RANGE_OPTIONS: { key: PresetRangeKey; label: string }[] = [
  { key: "term", label: "This term" },
  { key: "lastTerm", label: "Last term" },
  { key: "year", label: "Academic year" },
];

export type TermLike = { name: string; startsOn: Date; endsOn: Date; academicYear: string; countsForActivity: boolean };

export type ResolvedRange = {
  key: RangeKey;
  from: Date;
  to: Date;
  label: string;
  /** YYYY-MM-DD (campus) — for date inputs and export links. */
  fromInput: string;
  toInput: string;
};

export function toDateInput(d: Date) {
  return fmtDate(d, "yyyy-MM-dd");
}

function parts(s: string | null | undefined): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Reject impossible days like Feb 30 (the Date would roll into March).
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1) return null;
  return [y, mo, d];
}

/** Campus midnight at the start of a YYYY-MM-DD day, or null if it isn't a real date. */
export function startOfDayInput(s: string | null | undefined): Date | null {
  const p = parts(s);
  return p ? campusDate(p[0], p[1], p[2]) : null;
}

/** The last millisecond of a YYYY-MM-DD campus day. */
export function endOfDayInput(s: string | null | undefined): Date | null {
  const p = parts(s);
  return p ? new Date(campusDate(p[0], p[1], p[2] + 1).getTime() - 1) : null;
}

function sorted(terms: TermLike[]) {
  return [...terms].sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());
}

/** The term containing `at`, else the most recent one that already started. */
export function currentOrLastTermOf(terms: TermLike[], at: Date): TermLike | null {
  const list = sorted(terms);
  return list.find((t) => t.startsOn <= at && at <= t.endsOn) ?? [...list].reverse().find((t) => t.startsOn <= at) ?? null;
}

/** The term before `term` — skipping summer-style terms that don't count for activity when possible. */
export function previousTermOf(terms: TermLike[], term: TermLike): TermLike | null {
  const earlier = sorted(terms).filter((t) => t.endsOn < term.startsOn);
  return earlier.filter((t) => t.countsForActivity).at(-1) ?? earlier.at(-1) ?? null;
}

export function academicYearOf(terms: TermLike[], at: Date): { label: string; start: Date; end: Date } | null {
  const t = currentOrLastTermOf(terms, at);
  if (!t) return null;
  const same = sorted(terms).filter((x) => x.academicYear === t.academicYear);
  return { label: t.academicYear, start: same[0].startsOn, end: same[same.length - 1].endsOn };
}

function make(key: RangeKey, from: Date, to: Date, label: string): ResolvedRange {
  return { key, from, to, label, fromInput: toDateInput(from), toInput: toDateInput(to) };
}

function spanLabel(from: Date, to: Date) {
  const sameYear = fmtDate(from, "yyyy") === fmtDate(to, "yyyy");
  return `${fmtDate(from, sameYear ? "MMM d" : "MMM d, yyyy")} – ${fmtDate(to, "MMM d, yyyy")}`;
}

/**
 * Turns `?range=&from=&to=` into concrete dates. Unknown or incomplete input
 * falls back to this term. Without an academic calendar (fresh install), the
 * presets fall back to rolling windows so the tracker still works.
 */
export function resolveRange(input: { range?: string | null; from?: string | null; to?: string | null }, terms: TermLike[], now: Date): ResolvedRange {
  const key = (["term", "lastTerm", "year", "custom"] as const).find((k) => k === input.range) ?? "term";

  if (key === "custom") {
    let from = startOfDayInput(input.from);
    let to = endOfDayInput(input.to);
    if (from || to) {
      from ??= resolveRange({ range: "term" }, terms, now).from;
      to ??= endOfDayInput(toDateInput(now))!;
      if (from > to) {
        const a = startOfDayInput(toDateInput(to))!;
        const b = endOfDayInput(toDateInput(from))!;
        from = a;
        to = b;
      }
      return make("custom", from, to, spanLabel(from, to));
    }
    return resolveRange({ range: "term" }, terms, now);
  }

  const current = currentOrLastTermOf(terms, now);
  if (key === "year") {
    const ay = academicYearOf(terms, now);
    if (ay) return make("year", ay.start, ay.end, `${ay.label.replace("-", "–")} academic year`);
    return make("year", new Date(now.getTime() - 365 * DAY_MS), now, "Last 12 months");
  }
  if (key === "lastTerm") {
    const prev = current ? previousTermOf(terms, current) : null;
    if (prev) return make("lastTerm", prev.startsOn, prev.endsOn, prev.name);
    return make("lastTerm", new Date(now.getTime() - 240 * DAY_MS), new Date(now.getTime() - 120 * DAY_MS), "120–240 days ago");
  }
  if (current) return make("term", current.startsOn, current.endsOn, current.name);
  return make("term", new Date(now.getTime() - 120 * DAY_MS), now, "Last 120 days");
}
