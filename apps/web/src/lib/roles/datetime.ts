import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { campusDate, TZ } from "@/lib/time";

/**
 * `<input type="datetime-local">` speaks wall-clock time with no zone. Every
 * time a leader types is campus time (Ogden), whatever their laptop says, so
 * we convert explicitly in both directions.
 */

/** "2026-10-20T18:30" (campus wall time) → UTC Date, or null if malformed. */
export function parseCampusLocal(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return campusDate(y, mo, d, h, mi);
}

/** UTC Date → "2026-10-20T18:30" in campus time, for a datetime-local default value. */
export function toCampusLocal(d: Date): string {
  return format(new TZDate(d, TZ), "yyyy-MM-dd'T'HH:mm");
}
