import "server-only";
import { db } from "@/lib/db";
import { PASSAGE_LABEL, type PassageKind } from "./doc";
import type { SearchOutcome } from "./match";
import { HIT_END, HIT_START, toSegments, withEllipses } from "./headline";
import type { SearchMatch } from "./types";

export type { SearchMatch, SearchMode, Segment } from "./types";
export { searchIndex, type SearchOutcome } from "./match";

/**
 * THE CLUB SEARCH, server side: which clubs match (match.ts) and the
 * "Found in" snippet for each — the best passage the viewer may see, with
 * the matched words marked. lib/search/rank orders the results.
 */

// ─── "Found in" snippets ─────────────────────────────────────────────────────

const TITLE_OPTS = `StartSel=${HIT_START}, StopSel=${HIT_END}, HighlightAll=true`;
const BODY_OPTS = `StartSel=${HIT_START}, StopSel=${HIT_END}, MaxWords=24, MinWords=12, ShortWord=3, MaxFragments=2, FragmentDelimiter=" … "`;
/** Passage kinds whose title is a fixed word, not the item's name. */
const UNTITLED = new Set<PassageKind>(["about", "details", "seats", "files", "review", "document"]);

/**
 * The best visible passage for each club, for clubs whose card doesn't
 * already show why they matched (name, short description, focus, place).
 * Campus-only passages are left out for signed-out viewers.
 */
export async function matchSnippets(outcome: SearchOutcome, clubs: { id: string; card: string }[], signedIn: boolean): Promise<Map<string, SearchMatch>> {
  const out = new Map<string, SearchMatch>();
  if (!clubs.length) return out;
  const rows = await db.$queryRaw<{ club_id: string; kind: PassageKind; href: string; body: string; title_hl: string; body_hl: string | null }[]>`
    WITH q AS (SELECT ${outcome.tsquery} AS card_tsq, ${outcome.snippetTsquery} AS tsq),
    todo AS (
      SELECT t.id FROM unnest(${clubs.map((c) => c.id)}::text[], ${clubs.map((c) => c.card)}::text[]) AS t(id, card), q
       WHERE NOT (to_tsvector('english', unaccent(t.card)) @@ q.card_tsq)
    ),
    cand AS (
      SELECT d."clubId" AS club_id, e.ord, e.p->>'kind' AS kind, e.p->>'href' AS href, e.p->>'title' AS title, e.p->>'text' AS body,
             -- A fixed title ("About", "Files") isn't something to match.
             CASE WHEN (e.p->>'kind') = ANY(${[...UNTITLED]}::text[]) THEN ''::tsvector ELSE to_tsvector('english', unaccent(e.p->>'title')) END AS tv_title,
             to_tsvector('english', unaccent(e.p->>'text')) AS tv_body
        FROM todo JOIN "ClubSearchDoc" d ON d."clubId" = todo.id
       CROSS JOIN LATERAL jsonb_array_elements(d.passages) WITH ORDINALITY AS e(p, ord)
       WHERE ${signedIn} OR NOT COALESCE((e.p->>'campusOnly')::boolean, false)
    ),
    best AS (
      SELECT DISTINCT ON (cand.club_id) cand.*, cand.tv_body @@ q.tsq AS body_hit
        FROM cand, q
       WHERE (cand.tv_title || cand.tv_body) @@ q.tsq
       ORDER BY cand.club_id, ts_rank_cd(cand.tv_title || cand.tv_body, q.tsq) DESC, cand.ord
    )
    SELECT best.club_id, best.kind, best.href, best.body,
           ts_headline('english', best.title, q.tsq, ${TITLE_OPTS}) AS title_hl,
           CASE WHEN best.body_hit THEN ts_headline('english', best.body, q.tsq, ${BODY_OPTS}) END AS body_hl
      FROM best, q`;
  for (const r of rows) {
    const label = PASSAGE_LABEL[r.kind] ?? "Club page";
    out.set(r.club_id, {
      kind: r.kind,
      label,
      title: UNTITLED.has(r.kind) ? [] : toSegments(r.title_hl),
      snippet: r.body_hl ? withEllipses(toSegments(r.body_hl), r.body) : null,
      href: r.href,
    });
  }
  return out;
}

