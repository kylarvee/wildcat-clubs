import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { campusDate, DAY_MS, TZ } from "@/lib/time";

/**
 * Pure timeline math for the role history: academic years, who covered a
 * seat when, and the gaps nobody did. No database access, so it's easy to
 * test and safe to import anywhere.
 *
 * Academic years run July 1 → June 30 in campus time ("2025–26"), which keeps
 * a summer hand-off inside the year it ends rather than splitting it.
 */

export type Interval = { start: Date; end: Date | null };
export type Span = { start: Date; end: Date };
export type AcademicYear = { label: string; start: Date; end: Date };

/** Shorter vacancies are hand-off noise, not gaps worth flagging. */
export const MIN_GAP_DAYS = 7;

export function academicYearOf(d: Date): AcademicYear {
  const local = new TZDate(d, TZ);
  const y = local.getMonth() >= 6 ? local.getFullYear() : local.getFullYear() - 1;
  return { label: `${y}–${String((y + 1) % 100).padStart(2, "0")}`, start: campusDate(y, 7, 1), end: campusDate(y + 1, 7, 1) };
}

/** Every academic year touching [from, to], oldest first. */
export function academicYearsBetween(from: Date, to: Date): AcademicYear[] {
  const years: AcademicYear[] = [];
  let y = academicYearOf(from);
  for (let i = 0; i < 100 && y.start < to; i++) {
    years.push(y);
    y = academicYearOf(new Date(y.end.getTime() + DAY_MS));
  }
  return years;
}

/** Merge overlapping intervals (open ends run to `until`). */
export function mergeIntervals(intervals: Interval[], until: Date): Span[] {
  const spans = intervals
    .map((i) => ({ start: i.start, end: i.end ?? until }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
    } else out.push({ ...s });
  }
  return out;
}

/**
 * Stretches inside [from, to] when nobody held the seat, ignoring blips
 * shorter than `minGapDays`.
 */
export function coverageGaps(intervals: Interval[], from: Date, to: Date, minGapDays = MIN_GAP_DAYS): Span[] {
  const covered = mergeIntervals(intervals, to);
  const gaps: Span[] = [];
  let cursor = from;
  for (const c of covered) {
    if (c.end <= cursor) continue;
    if (c.start > cursor) gaps.push({ start: cursor, end: c.start < to ? c.start : to });
    if (c.end > cursor) cursor = c.end;
    if (cursor >= to) break;
  }
  if (cursor < to) gaps.push({ start: cursor, end: to });
  return gaps.filter((g) => g.end.getTime() - g.start.getTime() >= minGapDays * DAY_MS);
}

/**
 * Greedy lane packing so co-holders (two co-presidents, two VPs) sit on
 * separate rows of the timeline instead of drawing over each other.
 */
export function assignLanes<T extends Interval>(items: T[], until: Date): { item: T; lane: number }[] {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
  const laneEnds: number[] = [];
  return sorted.map((item) => {
    const end = (item.end ?? until).getTime();
    let lane = laneEnds.findIndex((e) => e <= item.start.getTime());
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else laneEnds[lane] = end;
    return { item, lane };
  });
}

/** Position of a span inside a window as left/width percentages (clipped). */
export function spanPercent(span: Span, window: Span): { left: number; width: number } | null {
  const total = window.end.getTime() - window.start.getTime();
  const s = Math.max(span.start.getTime(), window.start.getTime());
  const e = Math.min(span.end.getTime(), window.end.getTime());
  if (e <= s || total <= 0) return null;
  return { left: ((s - window.start.getTime()) / total) * 100, width: ((e - s) / total) * 100 };
}

/** "Mar 2025", "Jan–May 2025", "Aug 2024 – Jan 2025", or "since Mar 2026" when still open. */
export function fmtMonthRange(start: Date, end: Date | null): string {
  const s = new TZDate(start, TZ);
  if (!end) return `since ${format(s, "MMM yyyy")}`;
  const e = new TZDate(end, TZ);
  if (s.getFullYear() === e.getFullYear()) {
    if (s.getMonth() === e.getMonth()) return format(s, "MMM yyyy");
    return `${format(s, "MMM")}–${format(e, "MMM yyyy")}`;
  }
  return `${format(s, "MMM yyyy")} – ${format(e, "MMM yyyy")}`;
}

/** "1 yr 3 mo", "5 mo", "3 wk" — how long someone held a seat. */
export function fmtTenure(start: Date, end: Date | null, now: Date = new Date()): string {
  const days = Math.max(0, Math.round(((end ?? now).getTime() - start.getTime()) / DAY_MS));
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.round(days / 7)} wk`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} mo`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y} yr ${m} mo` : `${y} yr`;
}
