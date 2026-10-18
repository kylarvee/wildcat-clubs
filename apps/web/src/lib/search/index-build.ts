import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { buildClubDoc, type ClubDocSource } from "./doc";
import { forgetVocabulary } from "./match";

/**
 * THE INDEXER. Rebuilds ClubSearchDoc rows from each approved club's own
 * visible content (see doc.ts for what goes where). Derived data only: it
 * never changes anything people entered, so it doesn't log activity.
 *
 * Importable from plain `tsx` scripts (the seed): it may import only the
 * Prisma client and pure helpers — nothing that pulls in React or Next.
 *
 * Visibility is decided while loading: only PUBLIC content (plus events for
 * signed-in accounts, flagged campusOnly) is ever read. Members- and
 * leaders-only announcements, members-only events, hidden or reported
 * reviews, and files that aren't public are not loaded at all.
 */

type Client = Pick<PrismaClient, "club" | "position" | "event" | "eventCohost" | "announcement" | "clubDocument" | "review" | "searchQuery" | "$queryRaw" | "$executeRaw">;

export type IndexReport = { indexed: number; removed: number; ms: number };

const clubSelect = {
  id: true,
  slug: true,
  name: true,
  type: true,
  category: true,
  scope: true,
  shortDescription: true,
  descriptionHtml: true,
  focusOther: true,
  college: { select: { name: true, shortName: true } },
  department: { select: { name: true } },
  focusMajor: { select: { name: true } },
} satisfies Prisma.ClubSelect;

const eventSelect = { id: true, clubId: true, title: true, descriptionHtml: true, visibility: true, startsAt: true } satisfies Prisma.EventSelect;

/** Club files anyone may open: PUBLIC on the file or the nearest folder that sets it (a top-level item defaults to members). */
async function publicFileNames(client: Client, clubIds: string[]) {
  return client.$queryRaw<{ club_id: string; name: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT id, "clubId", "isFolder", name,
             CASE WHEN visibility = 'INHERIT' THEN NULL ELSE visibility::text END AS vis,
             "trashedAt" IS NOT NULL AS trashed, 0 AS depth
        FROM "FileItem" WHERE "clubId" = ANY(${clubIds}::text[]) AND "parentId" IS NULL
      UNION ALL
      SELECT f.id, f."clubId", f."isFolder", f.name,
             CASE WHEN f.visibility = 'INHERIT' THEN t.vis ELSE f.visibility::text END,
             t.trashed OR f."trashedAt" IS NOT NULL, t.depth + 1
        FROM "FileItem" f JOIN tree t ON f."parentId" = t.id
       WHERE t.depth < 32
    )
    SELECT "clubId" AS club_id, name FROM tree
     WHERE NOT "isFolder" AND NOT trashed AND COALESCE(vis, 'MEMBERS') = 'PUBLIC'
     ORDER BY name`;
}

function groupBy<T>(rows: T[], key: (r: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** Everything the documents of these approved clubs are built from, in a handful of batched queries. */
export async function loadDocSources(client: Client, clubIds?: string[]): Promise<ClubDocSource[]> {
  const clubs = await client.club.findMany({ where: { status: "APPROVED", ...(clubIds ? { id: { in: clubIds } } : {}) }, select: clubSelect });
  if (clubs.length === 0) return [];
  const ids = clubs.map((c) => c.id);
  const listed = { OR: [{ clubId: null }, { club: { status: { in: ["APPROVED", "RETIRED"] as const } } }] } satisfies Prisma.EventWhereInput;
  const [seats, hosted, cohosted, announcements, documents, reviews, files] = await Promise.all([
    client.position.findMany({ where: { clubId: { in: ids }, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { clubId: true, name: true } }),
    client.event.findMany({ where: { clubId: { in: ids }, status: "SCHEDULED", visibility: { in: ["PUBLIC", "UNIVERSITY"] } }, select: eventSelect }),
    client.eventCohost.findMany({
      where: {
        clubId: { in: ids },
        status: "APPROVED",
        // A university event marked members-only is open to every signed-in account.
        event: { status: "SCHEDULED", AND: [listed, { OR: [{ visibility: { in: ["PUBLIC", "UNIVERSITY"] } }, { visibility: "MEMBERS", clubId: null }] }] },
      },
      select: { clubId: true, event: { select: eventSelect } },
    }),
    client.announcement.findMany({ where: { clubId: { in: ids }, audience: "PUBLIC" }, orderBy: { createdAt: "desc" }, select: { id: true, clubId: true, title: true, bodyHtml: true } }),
    client.clubDocument.findMany({ where: { clubId: { in: ids }, status: "ACTIVE" }, orderBy: [{ kind: "asc" }, { version: "desc" }], select: { id: true, clubId: true, kind: true, title: true, contentHtml: true } }),
    // Hidden reviews and reported ones (until admins keep them) stay out.
    client.review.findMany({ where: { clubId: { in: ids }, hiddenAt: null, flags: { none: {} }, body: { not: null } }, orderBy: { updatedAt: "desc" }, select: { id: true, clubId: true, body: true } }),
    publicFileNames(client, ids),
  ]);

  const seatsBy = groupBy(seats, (s) => s.clubId);
  const eventsBy = groupBy([...hosted.map((e) => ({ clubId: e.clubId, e })), ...cohosted.map((c) => ({ clubId: c.clubId, e: c.event }))], (r) => r.clubId);
  const annBy = groupBy(announcements, (a) => a.clubId);
  const docsBy = groupBy(documents, (d) => d.clubId);
  const reviewsBy = groupBy(reviews, (r) => r.clubId);
  const filesBy = groupBy(files, (f) => f.club_id);

  return clubs.map((c) => {
    const seen = new Set<string>();
    const events = (eventsBy.get(c.id) ?? [])
      .map((r) => r.e)
      .filter((e) => !seen.has(e.id) && seen.add(e.id))
      // Newest first: upcoming and recent events make the most useful snippets.
      .sort((a, b) => (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0))
      .map((e) => ({ id: e.id, title: e.title, descriptionHtml: e.descriptionHtml, campusOnly: e.visibility !== "PUBLIC" }));
    return {
      club: {
        id: c.id,
        slug: c.slug,
        name: c.name,
        type: c.type,
        category: c.category,
        scope: c.scope,
        shortDescription: c.shortDescription,
        descriptionHtml: c.descriptionHtml,
        focus: c.focusMajor?.name ?? c.focusOther ?? null,
        college: c.college,
        department: c.department?.name ?? null,
      },
      seats: [...new Set((seatsBy.get(c.id) ?? []).map((s) => s.name))],
      events,
      announcements: annBy.get(c.id) ?? [],
      documents: docsBy.get(c.id) ?? [],
      reviews: (reviewsBy.get(c.id) ?? []).flatMap((r) => (r.body?.trim() ? [{ id: r.id, body: r.body }] : [])),
      files: [...new Set((filesBy.get(c.id) ?? []).map((f) => f.name))],
    };
  });
}

/**
 * Writes documents in batches. `asOf` is when loading began: a change made
 * while the batch was being built is newer than indexedAt, so the stale scan
 * picks it up. Clubs that stopped being approved meanwhile are skipped.
 */
async function writeDocs(client: Client, sources: ClubDocSource[], asOf: Date) {
  for (let i = 0; i < sources.length; i += 40) {
    const docs = sources.slice(i, i + 40).map((s) => ({ id: s.club.id, doc: buildClubDoc(s) }));
    await client.$executeRaw`
      INSERT INTO "ClubSearchDoc" ("clubId", "publicDoc", "campusDoc", passages, "indexedAt")
      SELECT t.id, v.pub, v.pub || setweight(to_tsvector('english', unaccent(t.cx)), 'C'), t.passages::jsonb,
             (${asOf.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        FROM unnest(
               ${docs.map((d) => d.id)}::text[], ${docs.map((d) => d.doc.public.a)}::text[], ${docs.map((d) => d.doc.public.b)}::text[],
               ${docs.map((d) => d.doc.public.c)}::text[], ${docs.map((d) => d.doc.public.d)}::text[], ${docs.map((d) => d.doc.campusC)}::text[],
               ${docs.map((d) => JSON.stringify(d.doc.passages))}::text[]
             ) AS t(id, a, b, c, d, cx, passages)
        JOIN "Club" c ON c.id = t.id AND c.status = 'APPROVED'
        CROSS JOIN LATERAL (
          SELECT setweight(to_tsvector('english', unaccent(t.a)), 'A') || setweight(to_tsvector('english', unaccent(t.b)), 'B')
              || setweight(to_tsvector('english', unaccent(t.c)), 'C') || setweight(to_tsvector('english', unaccent(t.d)), 'D') AS pub
        ) v
      ON CONFLICT ("clubId") DO UPDATE
        SET "publicDoc" = EXCLUDED."publicDoc", "campusDoc" = EXCLUDED."campusDoc", passages = EXCLUDED.passages, "indexedAt" = EXCLUDED."indexedAt"`;
  }
}

/** Drops documents of clubs that aren't approved any more (retired, or back in review). */
async function removeUnlisted(client: Client, clubIds?: string[]): Promise<number> {
  const only = clubIds ? Prisma.sql`AND d."clubId" = ANY(${clubIds}::text[])` : Prisma.empty;
  return client.$executeRaw`DELETE FROM "ClubSearchDoc" d USING "Club" c WHERE c.id = d."clubId" AND c.status <> 'APPROVED' ${only}`;
}

/** Rebuilds these clubs' documents (and drops those no longer approved). */
export async function reindexClubs(clubIds: string[], client: Client = db): Promise<IndexReport> {
  const started = Date.now();
  const ids = [...new Set(clubIds.filter(Boolean))];
  if (!ids.length) return { indexed: 0, removed: 0, ms: 0 };
  const asOf = new Date();
  const sources = await loadDocSources(client, ids);
  await writeDocs(client, sources, asOf);
  const removed = await removeUnlisted(client, ids);
  return { indexed: sources.length, removed, ms: Date.now() - started };
}

export async function reindexClub(clubId: string, client: Client = db): Promise<IndexReport> {
  return reindexClubs([clubId], client);
}

/** Every approved club, from scratch. About a second for ~300 clubs. */
export async function reindexAll(client: Client = db): Promise<IndexReport> {
  const started = Date.now();
  const asOf = new Date();
  const sources = await loadDocSources(client);
  await writeDocs(client, sources, asOf);
  const removed = await removeUnlisted(client);
  forgetVocabulary();
  return { indexed: sources.length, removed, ms: Date.now() - started };
}

/** Documents older than this are rebuilt anyway, so changes no timestamp records (a renamed seat or department) still arrive. */
export const MAX_DOC_AGE_HOURS = 24;

/**
 * Approved clubs whose document is missing or older than their content:
 * the club row itself, or the newest announcement, event (hosted or
 * co-hosted), document, seat, review, report or file. Deletions leave no
 * timestamp, so the write paths reindex on delete and MAX_DOC_AGE_HOURS
 * catches the rest.
 */
export async function staleClubIds(client: Client = db, limit = 300): Promise<string[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT c.id
      FROM "Club" c
      LEFT JOIN "ClubSearchDoc" d ON d."clubId" = c.id
     WHERE c.status = 'APPROVED'
       AND (
         d."clubId" IS NULL
         OR d."indexedAt" < c."updatedAt"
         OR d."indexedAt" < (now() AT TIME ZONE 'UTC') - make_interval(hours => ${MAX_DOC_AGE_HOURS}::int)
         OR EXISTS (SELECT 1 FROM "Announcement" a WHERE a."clubId" = c.id AND a."updatedAt" > d."indexedAt")
         OR EXISTS (SELECT 1 FROM "Event" e WHERE e."clubId" = c.id AND e."updatedAt" > d."indexedAt")
         OR EXISTS (SELECT 1 FROM "EventCohost" h JOIN "Event" e ON e.id = h."eventId"
                     WHERE h."clubId" = c.id AND (e."updatedAt" > d."indexedAt" OR h."createdAt" > d."indexedAt" OR h."decidedAt" > d."indexedAt"))
         OR EXISTS (SELECT 1 FROM "ClubDocument" x WHERE x."clubId" = c.id AND (x."createdAt" > d."indexedAt" OR x."decidedAt" > d."indexedAt"))
         OR EXISTS (SELECT 1 FROM "Position" p WHERE p."clubId" = c.id AND (p."createdAt" > d."indexedAt" OR p."archivedAt" > d."indexedAt"))
         OR EXISTS (SELECT 1 FROM "Review" r WHERE r."clubId" = c.id AND r."updatedAt" > d."indexedAt")
         OR EXISTS (SELECT 1 FROM "ReviewFlag" f JOIN "Review" r ON r.id = f."reviewId" WHERE r."clubId" = c.id AND f."createdAt" > d."indexedAt")
         OR EXISTS (SELECT 1 FROM "FileItem" fi WHERE fi."clubId" = c.id AND fi."updatedAt" > d."indexedAt")
       )
     ORDER BY d."indexedAt" ASC NULLS FIRST
     LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

/** The scheduled job: rebuild what's stale and drop what's no longer listed. */
export async function reindexStale(client: Client = db): Promise<IndexReport> {
  const started = Date.now();
  const ids = await staleClubIds(client);
  const r = ids.length ? await reindexClubs(ids, client) : { indexed: 0, removed: 0, ms: 0 };
  const removed = r.removed + (await removeUnlisted(client));
  return { indexed: r.indexed, removed, ms: Date.now() - started };
}

/** Approved clubs with no search document (should be none after the seed or a job run). */
export async function clubsWithoutDoc(client: Client = db): Promise<{ id: string; name: string }[]> {
  return client.$queryRaw<{ id: string; name: string }[]>`
    SELECT c.id, c.name FROM "Club" c LEFT JOIN "ClubSearchDoc" d ON d."clubId" = c.id
     WHERE c.status = 'APPROVED' AND d."clubId" IS NULL ORDER BY c.name`;
}

/** What people searched, kept this long (no account is ever attached). */
export const SEARCH_LOG_DAYS = 180;

export async function pruneSearchLog(client: Client = db, now = new Date()): Promise<number> {
  const r = await client.searchQuery.deleteMany({ where: { at: { lt: new Date(now.getTime() - SEARCH_LOG_DAYS * 86_400_000) } } });
  return r.count;
}

