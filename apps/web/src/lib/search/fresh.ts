import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { reindexClubs } from "./index-build";

/**
 * Keeps the search index fresh from the write paths (lib/domain). The work
 * runs after the response is sent, logs its own errors, and never fails or
 * slows the write that asked for it. Whatever slips through (a write path
 * that doesn't call these, a crash in between) is caught by the stale scan
 * in the scheduled jobs (lib/jobs/tick).
 */

/** Clubs already waiting for a rebuild (one per request is enough), with when they were queued. */
const queued = new Map<string, number>();
/** A queued rebuild that hasn't started by now is assumed lost, so a later write can queue it again. */
const QUEUE_TTL_MS = 30_000;

function later(run: () => Promise<void>) {
  const safe = () => run().catch((e) => console.error("[search] reindex failed", e));
  try {
    after(safe);
  } catch {
    // Outside a request (scripts, tests): run on the next tick instead.
    setTimeout(() => void safe(), 0);
  }
}

/** Rebuilds these clubs' search documents soon. Null and repeated ids are ignored. */
export function reindexClubSoon(...clubIds: (string | null | undefined)[]): void {
  const now = Date.now();
  const ids = [...new Set(clubIds.filter((id): id is string => Boolean(id)))].filter((id) => (queued.get(id) ?? 0) < now - QUEUE_TTL_MS);
  if (!ids.length) return;
  for (const id of ids) queued.set(id, now);
  later(async () => {
    for (const id of ids) queued.delete(id);
    await reindexClubs(ids);
  });
}

/** An event changed: its host and every approved co-host (plus `alsoClubIds`, e.g. co-hosts it had before). */
export function reindexEventClubsSoon(eventId: string, alsoClubIds: (string | null | undefined)[] = []): void {
  later(async () => {
    const e = await db.event.findUnique({ where: { id: eventId }, select: { clubId: true, cohosts: { where: { status: "APPROVED" }, select: { clubId: true } } } });
    const ids = [e?.clubId, ...(e?.cohosts.map((c) => c.clubId) ?? []), ...alsoClubIds].filter((id): id is string => Boolean(id));
    if (ids.length) await reindexClubs(ids);
  });
}
