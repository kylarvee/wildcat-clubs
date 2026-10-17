import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { TZ } from "@/lib/time";

/**
 * Profile date formatting, LinkedIn style. Pure and client-safe.
 *
 *   "Sep 2024 – May 2026 · 1 yr 9 mos"
 *   "Aug 2025 – Present · 1 yr 3 mos"
 *
 * Durations count calendar months inclusively in campus time, the way
 * LinkedIn does: Sep 2024 – May 2026 is 21 months (1 yr 9 mos), and a role
 * that starts and ends in the same month is "1 mo".
 */

export function monthIndex(d: Date): number {
  const t = new TZDate(d, TZ);
  return t.getFullYear() * 12 + t.getMonth();
}

/** "Sep 2024" */
export function fmtMonthYear(d: Date): string {
  return format(new TZDate(d, TZ), "MMM yyyy");
}

/** "1 yr 9 mos", "5 mos", "1 mo", "2 yrs" — inclusive months between start and end (or now). */
export function fmtDuration(start: Date, end: Date | null, now: Date = new Date()): string {
  const months = Math.max(1, monthIndex(end ?? now) - monthIndex(start) + 1);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const yrs = y ? `${y} yr${y === 1 ? "" : "s"}` : "";
  const mos = m ? `${m} mo${m === 1 ? "" : "s"}` : "";
  return [yrs, mos].filter(Boolean).join(" ");
}

/** "Sep 2024 – May 2026" or "Sep 2024 – Present". */
export function fmtMonthSpan(start: Date, end: Date | null): string {
  return `${fmtMonthYear(start)} – ${end ? fmtMonthYear(end) : "Present"}`;
}

/** "Sep 2024 – May 2026 · 1 yr 9 mos" */
export function fmtExperienceRange(start: Date, end: Date | null, now: Date = new Date()): string {
  return `${fmtMonthSpan(start, end)} · ${fmtDuration(start, end, now)}`;
}

/** "2022 – 2026", "2022 – Present", "2026", or "" when neither year is known. */
export function fmtYearSpan(startYear: number | null | undefined, endYear: number | null | undefined): string {
  if (startYear && endYear) return startYear === endYear ? String(endYear) : `${startYear} – ${endYear}`;
  if (startYear) return `${startYear} – Present`;
  if (endYear) return String(endYear);
  return "";
}

/** The earliest start and latest end of a group of spans (open end = still going). */
export function overallSpan(spans: { start: Date; end: Date | null }[]): { start: Date; end: Date | null } | null {
  if (!spans.length) return null;
  const start = new Date(Math.min(...spans.map((s) => s.start.getTime())));
  const end = spans.some((s) => !s.end) ? null : new Date(Math.max(...spans.map((s) => s.end!.getTime())));
  return { start, end };
}

/** "May 2026" for alumni badges ("Graduated May 2026"). */
export function fmtGraduated(d: Date): string {
  return format(new TZDate(d, TZ), "MMMM yyyy");
}

/** Value for <input type="month"> ("2024-09") in campus time. */
export function toMonthInput(d: Date | null | undefined): string {
  return d ? format(new TZDate(d, TZ), "yyyy-MM") : "";
}

/** Value for <input type="date"> ("2026-10-16") in campus time. */
export function toDateInput(d: Date | null | undefined): string {
  return d ? format(new TZDate(d, TZ), "yyyy-MM-dd") : "";
}

/**
 * How to address someone in a sentence: their first name, or title + last
 * name when the name starts with one ("Dr. Elena Alvarez" → "Dr. Alvarez").
 */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1 && /^(dr|prof|professor|mr|mrs|ms|mx)\.?$/i.test(parts[0])) return `${parts[0]} ${parts[parts.length - 1]}`;
  return parts[0] ?? name;
}
