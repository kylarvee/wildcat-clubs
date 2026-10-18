import { Prisma } from "@prisma/client";
import type { ParsedQuery } from "./query-text";

/**
 * SQL fragments for a parsed query (see query-text.ts). Every piece of user
 * text goes in as a bound parameter: websearch_to_tsquery accepts any input,
 * and prefixes are already letters and digits, cast as quoted lexemes.
 * Imports only Prisma, so the seed can use it too.
 *
 * Queries using these join "ClubSearchDoc" d to "Club" c.
 */

const ws = (text: string) => Prisma.sql`websearch_to_tsquery('english', unaccent(${text}))`;
/**
 * A prefix matches names, labels, about and events only (weights A–C): it's
 * for words still being typed, and "art:*" across every constitution's
 * "Article I" would match every club. Whole words search everything.
 */
const prefix = (lexeme: string) => Prisma.sql`(quote_literal(lower(unaccent(${lexeme}))) || ':*ABC')::tsquery`;
const anyOf = (parts: Prisma.Sql[]) => (parts.length === 1 ? parts[0] : Prisma.sql`(${Prisma.join(parts, " || ")})`);
const EMPTY = Prisma.sql`''::tsquery`;

/** Every word must match (the last one may be a prefix). */
export function strictTsquery(p: ParsedQuery): Prisma.Sql {
  const head = p.head ? ws(p.head) : null;
  const tail = p.tail ? anyOf([ws(p.tail), ...p.prefixes.map(prefix)]) : null;
  if (head && tail) return Prisma.sql`(${head} && ${tail})`;
  return head ?? tail ?? EMPTY;
}

/** Any word may match: the last resort when nothing matches every word. */
export function looseTsquery(p: ParsedQuery): Prisma.Sql {
  const parts = [...(p.words.length ? [ws(p.words.join(" or "))] : []), ...p.prefixes.map(prefix)];
  return parts.length ? anyOf(parts) : EMPTY;
}

/** Exact lexemes (from the index's own vocabulary), all required: the "close spellings" retry. */
export function lexemesTsquery(lexemes: string[]): Prisma.Sql {
  if (!lexemes.length) return EMPTY;
  return Prisma.sql`(${Prisma.join(
    lexemes.map((l) => Prisma.sql`quote_literal(${l})::tsquery`),
    " && ",
  )})`;
}

/** The viewer's document: signed-in Weber State accounts also match campus-only content. */
export const docColumn = (signedIn: boolean) => (signedIn ? Prisma.sql`d."campusDoc"` : Prisma.sql`d."publicDoc"`);

/**
 * Typo- and acronym-tolerant club-name match (pg_trgm): every query word must
 * resemble a whole word of the name — strict_word_similarity ≥ 0.5, or ≥ 0.75
 * for a three-letter word and exact for shorter ones. `ns.name_score` is the
 * weakest word's similarity, 0 when any word misses.
 *   "enginering" → Engineering Honor Society (0.77), "iee" → IEEE (0.8),
 *   "socity of women engineers" → SWE; but "swe" doesn't match "Swing",
 *   "chess" doesn't match "Chemistry", and "black student" doesn't pull in
 *   European Student Club (every word has to be there).
 * (Plain word_similarity lets a match straddle words — "ness club" ≈ "chess" — so it's too loose here.)
 */
export function nameScoreLateral(p: ParsedQuery): Prisma.Sql {
  return Prisma.sql`CROSS JOIN LATERAL (
    SELECT CASE WHEN bool_and(strict_word_similarity(w, lower(unaccent(c.name))) >= CASE WHEN length(w) <= 2 THEN 1 WHEN length(w) = 3 THEN 0.75 ELSE 0.5 END)
                THEN min(strict_word_similarity(w, lower(unaccent(c.name)))) ELSE 0 END AS name_score
      FROM unnest(${p.words}::text[]) AS w
  ) ns`;
}

