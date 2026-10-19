/**
 * Offset paging for mobile lists the domain hands over whole (newest first).
 * The cursor is the offset as a string; clients treat it as opaque. Pure, so
 * it can be unit-tested.
 */

/** A cursor from the query string; anything unreadable starts at the top. */
export function parseCursor(raw: string | null | undefined): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A page size from the query string, kept between 1 and `max`. */
export function parseLimit(raw: string | null | undefined, fallback: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * One page of `rows`, where `rows` holds at least everything up to
 * offset + limit (plus one more when there is one): the items and the next
 * cursor, null at the end.
 */
export function pageOf<T>(rows: T[], offset: number, limit: number): { items: T[]; nextCursor: string | null } {
  const end = offset + limit;
  return { items: rows.slice(offset, end), nextCursor: rows.length > end ? String(end) : null };
}
