import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CLUB_REVIVAL } from "@/lib/founding/rules";
import { clubListMetrics, lastHeldEvents, membersAtRetirement } from "@/lib/metrics";
import { officeById } from "@/lib/offices";
import { vocabulary } from "./match";
import { docColumn } from "./sql";
import { lexemeWeights, meaningfulWords, nameIndex, nameSignal, purposeSignal, rankSimilar, SIMILAR, similarStanding, type ProposalLexeme, type SimilarClub } from "./similar-rules";

export type { SimilarClub } from "./similar-rules";

/**
 * "Similar clubs already exist": clubs like a proposed one (its name and
 * short description), for the Start a club wizard and the office reviewing a
 * submission. Built on THE club search engine: the purpose signal reads the
 * search index (approved clubs, the same weighted documents and vocabulary
 * the clubs list searches); retired clubs aren't indexed, so they're found by
 * a small name match of their own (lib/search/similar-rules nameSignal, the
 * same rule for every club). Founding and rejected clubs are never listed.
 * Each result carries its standing from lib/metrics: active, pilot, inactive
 * ("No events since March") or retired, with its members.
 */

const SECTION = {
  a: Prisma.raw(String(SIMILAR.section.a)),
  b: Prisma.raw(String(SIMILAR.section.b)),
  c: Prisma.raw(String(SIMILAR.section.c)),
};

/** club id → the purpose signal (0–1) for approved, indexed clubs that share any of the proposal's telling words. */
export async function purposeScores(nameWords: string[], descriptionWords: string[], signedIn: boolean): Promise<Map<string, number>> {
  const words = [...new Set([...nameWords, ...descriptionWords])];
  if (!words.length) return new Map();
  // Stemmed the way the index stems (stop words come back empty).
  const stems = await db.$queryRaw<{ w: string; stem: string | null }[]>`
    SELECT w, (SELECT min(lexeme) FROM unnest(to_tsvector('english', unaccent(w)))) AS stem FROM unnest(${words}::text[]) AS w`;
  const stemOf = new Map(stems.map((r) => [r.w, r.stem]));
  const fromName = new Set(nameWords);
  const lexemes: ProposalLexeme[] = words.flatMap((w) => {
    const lexeme = stemOf.get(w);
    return lexeme ? [{ lexeme, fromName: fromName.has(w) }] : [];
  });
  if (!lexemes.length) return new Map();
  const [vocab, total] = await Promise.all([vocabulary(db, signedIn), db.clubSearchDoc.count()]);
  const weighted = lexemeWeights(lexemes, (l) => vocab.get(l) ?? 0, total);
  const all = weighted.reduce((sum, l) => sum + l.weight, 0);
  if (!weighted.length || all <= 0) return new Map();
  const doc = docColumn(signedIn);
  const anyOf = Prisma.join(
    weighted.map((l) => Prisma.sql`quote_literal(${l.lexeme})::tsquery`),
    " || ",
  );
  const tellingTotal = weighted.filter((l) => l.telling).length;
  const rows = await db.$queryRaw<{ club_id: string; covered: number; telling_hits: number }[]>`
    WITH lex AS (
      SELECT t.weight, t.telling, quote_literal(t.lexeme)::tsquery AS q
        FROM unnest(${weighted.map((l) => l.lexeme)}::text[], ${weighted.map((l) => l.weight)}::float8[], ${weighted.map((l) => l.telling)}::boolean[]) AS t(lexeme, weight, telling)
    ),
    docs AS (
      SELECT d."clubId" AS club_id, ts_filter(${doc}, '{a}') AS a, ts_filter(${doc}, '{b}') AS b, ts_filter(${doc}, '{c}') AS c
        FROM "ClubSearchDoc" d
        JOIN "Club" c ON c.id = d."clubId" AND c.status = 'APPROVED'
       WHERE ${doc} @@ (${anyOf})
    )
    SELECT docs.club_id,
           sum(lex.weight * CASE WHEN docs.a @@ lex.q THEN ${SECTION.a} WHEN docs.b @@ lex.q THEN ${SECTION.b} WHEN docs.c @@ lex.q THEN ${SECTION.c} ELSE 0 END)::float8 AS covered,
           (count(*) FILTER (WHERE lex.telling AND (docs.a @@ lex.q OR docs.b @@ lex.q)))::int AS telling_hits
      FROM docs CROSS JOIN lex
     GROUP BY docs.club_id`;
  return new Map(rows.map((r) => [r.club_id, purposeSignal(Number(r.covered), all, Number(r.telling_hits), tellingTotal)]));
}

/**
 * Clubs like a proposed one, best first (at most SIMILAR.limit). `viewerId`
 * adds the viewer's membership and revival requests; `excludeClubId` leaves
 * out the club being reviewed. Only approved and retired clubs are listed.
 */
export async function similarClubs(input: {
  name: string;
  description?: string | null;
  excludeClubId?: string | null;
  viewerId?: string | null;
  /** Signed-in viewers also match campus-only content, as on the clubs list. Every caller today is signed in. */
  signedIn?: boolean;
  limit?: number;
}): Promise<SimilarClub[]> {
  const nameWords = meaningfulWords(input.name);
  const descriptionWords = meaningfulWords(input.description);
  if (!nameWords.length && !descriptionWords.length) return [];
  const [candidates, purpose] = await Promise.all([
    db.club.findMany({
      where: { status: { in: ["APPROVED", "RETIRED"] }, ...(input.excludeClubId ? { id: { not: input.excludeClubId } } : {}) },
      select: { id: true, slug: true, name: true, status: true, logoUrl: true, logoColor: true, shortDescription: true, retiredAt: true, officeId: true },
    }),
    purposeScores(nameWords, descriptionWords, input.signedIn ?? true),
  ]);
  const index = nameIndex(candidates.map((c) => meaningfulWords(c.name)));
  const ranked = rankSimilar(
    candidates.map((c, i) => ({
      ...c,
      status: c.status === "RETIRED" ? ("RETIRED" as const) : ("APPROVED" as const),
      nameScore: nameWords.length ? nameSignal(nameWords, index.names[i], index) : 0,
      purposeScore: c.status === "APPROVED" ? (purpose.get(c.id) ?? 0) : 0,
    })),
    input.limit ?? SIMILAR.limit,
  );
  if (!ranked.length) return [];

  const ids = ranked.map((c) => c.id);
  const retiredIds = ranked.filter((c) => c.status === "RETIRED").map((c) => c.id);
  const [metrics, lastHeld, former, mine, revivals, offices] = await Promise.all([
    clubListMetrics(ids),
    lastHeldEvents(ids),
    membersAtRetirement(retiredIds),
    input.viewerId
      ? db.membership.findMany({ where: { userId: input.viewerId, clubId: { in: ids }, status: { in: ["ACTIVE", "PENDING"] } }, select: { clubId: true, status: true } })
      : Promise.resolve([]),
    retiredIds.length ? db.task.findMany({ where: { sourceType: CLUB_REVIVAL, status: "OPEN", sourceId: { in: retiredIds } }, select: { sourceId: true, createdById: true } }) : Promise.resolve([]),
    Promise.all(ranked.map((c) => officeById(c.officeId))),
  ]);
  const now = new Date();
  return ranked.map((c, i) => {
    const m = metrics.get(c.id);
    const s = similarStanding({
      status: c.status,
      isActive: Boolean(m?.isActive),
      inPilot: Boolean(m?.inPilot),
      members: c.status === "RETIRED" ? (former.get(c.id) ?? 0) : (m?.registeredMembers ?? 0),
      lastHeldAt: lastHeld.get(c.id) ?? null,
      retiredAt: c.retiredAt,
      now,
    });
    const membership = mine.find((x) => x.clubId === c.id);
    const request = revivals.find((r) => r.sourceId === c.id);
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      logoUrl: c.logoUrl,
      logoColor: c.logoColor,
      shortDescription: c.shortDescription,
      status: c.status,
      standing: s.standing,
      standingLabel: s.label,
      facts: s.facts,
      reason: c.reason,
      viewer: input.viewerId && c.status === "APPROVED" ? { member: membership?.status === "ACTIVE", pending: membership?.status === "PENDING" } : null,
      revival: c.status === "RETIRED" ? { open: Boolean(request), mine: Boolean(request && input.viewerId && request.createdById === input.viewerId) } : null,
      office: offices[i].name,
    };
  });
}
