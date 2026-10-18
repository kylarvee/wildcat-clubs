import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { parseQuery, type ParsedQuery } from "./query-text";
import { closestWord } from "./spelling";
import { docColumn, lexemesTsquery, looseTsquery, nameScoreLateral, strictTsquery } from "./sql";
import type { SearchMode } from "./types";

/**
 * Which clubs match a query, and how well — the passes of THE CLUB SEARCH
 * (engine.ts adds "Found in" snippets). Database and pure helpers only, so
 * the seed can count matches exactly the way the clubs list does.
 *
 *   all    every word matches (the last as a prefix), or the name is a close match
 *   close  nothing did, but swapping unknown words for the index's nearest
 *          spellings does ("robitics" → robot…)
 *   some   last resort: clubs matching any of the words
 *
 * Relevance is ts_rank_cd over the weighted document (A name … D announcements,
 * documents, reviews), squashed to 0–1 (rank ÷ (rank + 1)), or the name
 * similarity when that's higher.
 */

type Client = Pick<PrismaClient, "$queryRaw">;

export type SearchOutcome = {
  query: ParsedQuery;
  mode: SearchMode;
  /** club id → relevance (0–1). */
  hits: Map<string, number>;
  /** Clubs that match what was asked (every word, a close name, or a close spelling); 0 when only some words matched. */
  matches: number;
  /** What matched (for "is it already on the card?"). */
  tsquery: Prisma.Sql;
  /** What snippets look for and highlight: any of the words. */
  snippetTsquery: Prisma.Sql;
};

/** ts_rank_cd weights, in Postgres order {D, C, B, A}. */
const RANK_WEIGHTS = Prisma.raw(`'{0.1, 0.2, 0.4, 1.0}'::float4[]`);

async function hitsFor(client: Client, tsq: Prisma.Sql, signedIn: boolean, names: Prisma.Sql | null): Promise<Map<string, number>> {
  const doc = docColumn(signedIn);
  const rows = await client.$queryRaw<{ club_id: string; text_rank: number; name_score: number }[]>`
    SELECT d."clubId" AS club_id,
           CASE WHEN ${doc} @@ q.tsq THEN ts_rank_cd(${RANK_WEIGHTS}, ${doc}, q.tsq, 32) ELSE 0 END AS text_rank,
           ${names ? Prisma.sql`ns.name_score` : Prisma.sql`0`} AS name_score
      FROM "ClubSearchDoc" d
      JOIN "Club" c ON c.id = d."clubId" AND c.status = 'APPROVED'
     CROSS JOIN (SELECT ${tsq} AS tsq) q
      ${names ?? Prisma.empty}
     WHERE ${doc} @@ q.tsq ${names ? Prisma.sql`OR ns.name_score > 0` : Prisma.empty}`;
  return new Map(rows.map((r) => [r.club_id, Math.min(1, Math.max(Number(r.text_rank) || 0, Number(r.name_score) || 0))]));
}

// The index's own vocabulary (names, labels, about, events: weights A–C), per document kind, refreshed every few minutes.
const VOCAB_TTL_MS = 10 * 60_000;
const vocabCache = new Map<string, { at: number; words: Promise<Map<string, number>> }>();

function vocabulary(client: Client, signedIn: boolean): Promise<Map<string, number>> {
  const key = signedIn ? "campus" : "public";
  const hit = vocabCache.get(key);
  if (hit && Date.now() - hit.at < VOCAB_TTL_MS) return hit.words;
  const words = (
    signedIn
      ? client.$queryRaw<{ word: string; ndoc: number }[]>`SELECT word, ndoc FROM ts_stat('SELECT "campusDoc" FROM "ClubSearchDoc"', 'ABC')`
      : client.$queryRaw<{ word: string; ndoc: number }[]>`SELECT word, ndoc FROM ts_stat('SELECT "publicDoc" FROM "ClubSearchDoc"', 'ABC')`
  ).then((rows) => new Map(rows.filter((r) => /^\p{L}{3,}$/u.test(r.word)).map((r) => [r.word, Number(r.ndoc)])));
  vocabCache.set(key, { at: Date.now(), words });
  words.catch(() => vocabCache.delete(key));
  return words;
}

/** Forget the cached vocabulary (after a full reindex). */
export function forgetVocabulary() {
  vocabCache.clear();
}

/** Every word as a lexeme the index knows — corrected where needed — or null when that doesn't help. */
async function closeSpellings(client: Client, p: ParsedQuery, signedIn: boolean): Promise<string[] | null> {
  if (!p.words.some((w) => w.length >= 4)) return null;
  const [stems, vocab] = await Promise.all([
    client.$queryRaw<{ w: string; stem: string | null }[]>`
      SELECT w, (SELECT min(lexeme) FROM unnest(to_tsvector('english', unaccent(w)))) AS stem FROM unnest(${p.words}::text[]) AS w`,
    vocabulary(client, signedIn),
  ]);
  let corrected = false;
  const lexemes: string[] = [];
  for (const { w, stem } of stems) {
    if (!stem) continue; // a stop word
    if (vocab.has(stem)) {
      lexemes.push(stem);
      continue;
    }
    const near = closestWord([stem, w], vocab);
    if (!near) return null;
    lexemes.push(near);
    corrected = true;
  }
  return corrected && lexemes.length ? [...new Set(lexemes)] : null;
}

/** Null when there's nothing to search for. */
export async function searchIndex(raw: string, signedIn: boolean, client: Client = db): Promise<SearchOutcome | null> {
  const p = parseQuery(raw);
  if (!p) return null;
  const strict = strictTsquery(p);
  const loose = looseTsquery(p);
  const all = await hitsFor(client, strict, signedIn, nameScoreLateral(p));
  if (all.size) return { query: p, mode: "all", hits: all, matches: all.size, tsquery: strict, snippetTsquery: loose };

  const lexemes = await closeSpellings(client, p, signedIn);
  if (lexemes) {
    const tsq = lexemesTsquery(lexemes);
    const close = await hitsFor(client, tsq, signedIn, null);
    if (close.size) return { query: p, mode: "close", hits: close, matches: close.size, tsquery: tsq, snippetTsquery: tsq };
  }
  const some = await hitsFor(client, loose, signedIn, null);
  return { query: p, mode: "some", hits: some, matches: 0, tsquery: loose, snippetTsquery: loose };
}

/** How many approved clubs a search finds, as the clubs list counts them (what the search log records). */
export async function countClubMatches(q: string, client: Client = db, signedIn = false): Promise<number> {
  return (await searchIndex(q, signedIn, client))?.matches ?? 0;
}
