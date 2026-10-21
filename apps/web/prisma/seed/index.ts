/**
 * Wildcat Clubs — mock database for user testing.
 *
 *   npm run db:reset   (fresh schema + this seed)
 *   npm run db:seed    (this seed only; it clears every table first)
 *
 * Deterministic: a seeded PRNG drives every choice, so each run produces the
 * same people, clubs and history — anchored to the current time, so
 * "upcoming", "last 30 days" and "live now" are always true when you run it.
 * SEED_NOW=2026-11-20T18:00:00Z pins the anchor (verify.ts reads it too).
 * See prisma/seed/PERSONAS.md for what each test persona can try.
 */
import { PrismaClient } from "@prisma/client";
import { Ctx } from "./ctx";
import { insertAll } from "./insert";
import { resetSeedStorage } from "./lib/assets";
import { buildReference } from "./steps/reference";
import { buildOffices, buildOfficeStories } from "./steps/offices";
import { buildPeople, markConcurrentEnrollment } from "./steps/people";
import { buildClubs, buildMemberships } from "./steps/clubs";
import { buildRoles } from "./steps/roles";
import { assignCovers, buildEvents, buildReviewStories } from "./steps/events";
import { buildAttendance } from "./steps/attendance";
import { buildGovernance, choosePastGrace } from "./steps/governance";
import { buildAnnouncements, buildElections, buildMessaging, buildReviews, buildSubscriptions } from "./steps/community";
import { buildFunding } from "./steps/money";
import { buildFiles } from "./steps/files";
import { buildInbox } from "./steps/inbox";
import { buildSearch } from "./steps/search";
import { buildRenewals } from "./steps/renewals";
import { buildFoundingStories } from "./steps/founding";
import { printSummary } from "./summary";

async function truncateAll(db: PrismaClient) {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

async function main() {
  const started = Date.now();
  const db = new PrismaClient();
  const ctx = new Ctx();
  const log = (s: string) => console.log(s);
  log(`Seeding Wildcat Clubs — anchored to ${ctx.NOW.toISOString()}`);

  try {
    await truncateAll(db);
    resetSeedStorage();

    const ref = buildReference(ctx);
    // Offices first: clubs, roles, governance and the inbox all route by them.
    buildOffices(ctx);
    const users = buildPeople(ctx);
    buildClubs(ctx);
    buildMemberships(ctx);
    markConcurrentEnrollment(ctx);
    buildRoles(ctx);
    buildEvents(ctx);
    choosePastGrace(ctx);
    buildAttendance(ctx);
    buildSubscriptions(ctx);
    buildGovernance(ctx);
    buildReviews(ctx);
    buildAnnouncements(ctx);
    buildMessaging(ctx);
    buildElections(ctx);
    buildFunding(ctx);
    buildFiles(ctx);
    assignCovers(ctx);
    buildInbox(ctx, users);
    // Events that waited for their office's review: after every step that draws from the generator, so nothing else shifts.
    buildReviewStories(ctx);
    buildOfficeStories(ctx);
    // Co-founders, the forming list and a revival request: no randomness, after every step that draws from the generator.
    buildFoundingStories(ctx);
    log(`Built in ${((Date.now() - started) / 1000).toFixed(1)}s — writing…`);

    await insertAll(db, ctx, ref, users, log);
    await buildSearch(db, ctx, log);
    await buildRenewals(db, ctx, log);
    await printSummary(db, ctx, log);
    log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
