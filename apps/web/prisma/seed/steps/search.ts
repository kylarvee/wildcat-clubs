import type { PrismaClient } from "@prisma/client";
import { clubsWithoutDoc, reindexAll } from "@/lib/search/index-build";
import { countClubMatches } from "@/lib/search/match";
import type { Ctx } from "../ctx";
import { createRng } from "../lib/rng";
import { addDays } from "../lib/dates";

/**
 * The club search index (lib/search), built from everything the seed wrote,
 * and a month of sample searches for the admin "What students search for"
 * card — a few of them for things no club offers, which is the point of the
 * card. Runs after insertAll (it reads the database, not ctx rows).
 */

/** [what a student typed, how many times in the last 30 days]. Counts are worked out against the index, never assumed. */
const SAMPLE_SEARCHES: [string, number][] = [
  ["robotics", 11],
  ["nursing", 9],
  ["volunteer", 8],
  ["dance", 7],
  ["pre med", 6],
  ["chess", 6],
  ["swe", 4],
  ["accounting", 4],
  ["anime", 4],
  ["climbing", 3],
  ["film", 3],
  ["photography", 3],
  // Interest no club meets (yet):
  ["ultimate frisbee", 5],
  ["quidditch", 3],
  ["beekeeping", 2],
  ["lacrosse", 2],
];

export async function buildSearch(db: PrismaClient, ctx: Ctx, log: (s: string) => void) {
  const r = await reindexAll(db);
  const missing = await clubsWithoutDoc(db);
  if (missing.length) {
    throw new Error(`Search index: ${missing.length} approved clubs have no search document (${missing.slice(0, 5).map((c) => c.name).join(", ")}${missing.length > 5 ? ", …" : ""}).`);
  }

  const rng = createRng(20261018);
  const rows: { id: string; query: string; results: number; signedIn: boolean; at: Date }[] = [];
  const empty: string[] = [];
  for (const [query, times] of SAMPLE_SEARCHES) {
    const results = await countClubMatches(query, db);
    if (!results) empty.push(query);
    for (let i = 0; i < times; i++) rows.push({ id: ctx.id(), query, results, signedIn: rng.chance(0.65), at: addDays(ctx.NOW, -rng.float(0.05, 29.5)) });
  }
  await db.searchQuery.createMany({ data: rows });
  log(`  Search index: ${r.indexed} clubs in ${(r.ms / 1000).toFixed(1)}s; ${rows.length} sample searches (${empty.length ? `nothing found for ${empty.join(", ")}` : "every sample found a club"}).`);
}
