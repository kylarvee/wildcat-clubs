import "server-only";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeQuery } from "./query-text";

/**
 * What students search for on the clubs page, so WSUSA can see unmet demand.
 * Rows hold the words, how many clubs matched and whether the person was
 * signed in — never an account, a session or anything else that identifies
 * them. Kept SEARCH_LOG_DAYS (lib/search/index-build), pruned by the jobs.
 */

export const MIN_LOGGED_CHARS = 2;

// The same search re-rendered moments later (a Register click refreshes the page) counts once.
const recent = new Map<string, number>();
const REPEAT_MS = 15_000;

/** Records one search after the response is sent. Never throws. */
export function logSearchSoon(entry: { query: string; results: number; signedIn: boolean }): void {
  const query = normalizeQuery(entry.query);
  if ([...query].length < MIN_LOGGED_CHARS) return;
  const now = Date.now();
  const key = `${entry.signedIn ? 1 : 0}|${entry.results}|${query}`;
  if ((recent.get(key) ?? 0) > now - REPEAT_MS) return;
  recent.set(key, now);
  if (recent.size > 500) for (const [k, at] of recent) if (at <= now - REPEAT_MS) recent.delete(k);
  const run = () =>
    db.searchQuery
      .create({ data: { query, results: Math.max(0, Math.round(entry.results)), signedIn: entry.signedIn } })
      .then(() => undefined)
      .catch((e) => console.error("[search] logging the search failed", e));
  try {
    after(run);
  } catch {
    void run();
  }
}

export type SearchInsights = {
  days: number;
  searches: number;
  /** Share of searches made while signed in (0–1). */
  signedInShare: number | null;
  top: { query: string; count: number; results: number }[];
  /** Searches whose latest try found nothing: what students want and can't find. */
  unmet: { query: string; count: number; lastAt: Date }[];
};

/** The admin "What students search for" card. */
export async function searchInsights(days = 30, now = new Date()): Promise<SearchInsights> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const sinceSql = Prisma.sql`(${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const [totals, top, unmet] = await Promise.all([
    db.searchQuery.aggregate({ where: { at: { gte: since } }, _count: { _all: true } }),
    db.$queryRaw<{ query: string; n: number; latest: number }[]>`
      SELECT query, count(*)::int AS n, (array_agg(results ORDER BY at DESC))[1]::int AS latest
        FROM "SearchQuery" WHERE at >= ${sinceSql}
       GROUP BY query ORDER BY n DESC, max(at) DESC LIMIT 10`,
    db.$queryRaw<{ query: string; n: number; last_at: Date }[]>`
      SELECT query, count(*)::int AS n, max(at) AS last_at
        FROM "SearchQuery" WHERE at >= ${sinceSql}
       GROUP BY query
      HAVING (array_agg(results ORDER BY at DESC))[1] = 0
       ORDER BY n DESC, max(at) DESC LIMIT 10`,
  ]);
  const signedIn = await db.searchQuery.count({ where: { at: { gte: since }, signedIn: true } });
  const searches = totals._count._all;
  return {
    days,
    searches,
    signedInShare: searches ? signedIn / searches : null,
    top: top.map((r) => ({ query: r.query, count: r.n, results: r.latest })),
    unmet: unmet.map((r) => ({ query: r.query, count: r.n, lastAt: r.last_at })),
  };
}
