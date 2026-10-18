/**
 * Turns what someone typed into the pieces the search SQL needs. Pure, so
 * it's unit-tested and safe to share with the seed.
 *
 * The SQL (lib/search/sql.ts) builds, for the viewer's document:
 *   strict  websearch_to_tsquery(head) AND (websearch_to_tsquery(tail) OR any prefix:*)
 *   loose   any of `words` (OR), plus the prefixes — used only when strict finds nothing
 * websearch_to_tsquery never raises on odd input, and prefixes are reduced
 * here to letters and digits and cast as quoted lexemes, so no input can
 * break a query.
 *
 * Prefixes: the word as typed plus one and two letters shorter (never under
 * four), because the index holds stems: a pause at "nursi" or "roboti" should
 * still find nurs(ing) and robot(ics).
 */

export const MAX_QUERY = 100;

/** Words that describe nearly every club; dropped from a query that has other words ("chess club" → chess). */
const FILLER = new Set([
  "club", "clubs", "group", "groups", "org", "orgs", "organization", "organizations", "organisation", "society", "societies",
  "student", "students", "wsu", "weber",
]);

/** Common English words that carry no meaning on their own (Postgres drops them from the query anyway). */
const STOP = new Set(["a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "with", "about", "by", "from", "is", "are", "my", "your", "our", "me", "we", "you", "i", "it", "that", "this", "who", "what", "like", "into"]);

export type ParsedQuery = {
  /** Lowercase, single-spaced, trimmed and capped: what's logged and grouped. */
  normalized: string;
  /** websearch_to_tsquery input for everything before the last word (quotes, -word and "or" kept). */
  head: string;
  /** The last word as typed, matched whole (stemmed) — null when the query ends in a phrase, "-word" or "or". */
  tail: string | null;
  /** The last word's final run of letters/digits, matched as a prefix ("robo" → robotics); null without a tail. */
  prefix: string | null;
  /** `prefix` and up to two shorter forms (never under four letters), each matched as a prefix. */
  prefixes: string[];
  /** Plain positive words (letters and digits, accents folded; filler and stop words dropped): club-name matching and the fallbacks. */
  words: string[];
};

type Token = { kind: "word" | "phrase" | "or"; text: string; negated: boolean; closed: boolean };

/** Lowercase, NFC, single spaces, trimmed, at most MAX_QUERY characters. */
export function normalizeQuery(q: string | null | undefined): string {
  return (q ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, MAX_QUERY)
    .trim();
}

/** A word's runs of letters and digits, accents folded, lowercase: "Pre-Med" → ["pre", "med"]. */
export function letterRuns(word: string): string[] {
  return word
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((r) => r.slice(0, 40));
}

/** The last run of letters and digits: all that may go inside a quoted tsquery prefix. */
export function prefixLexeme(word: string): string | null {
  const runs = letterRuns(word);
  return runs[runs.length - 1] ?? null;
}

function tokenize(q: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < q.length) {
    if (q[i] === " ") {
      i++;
      continue;
    }
    let negated = false;
    if (q[i] === "-" && i + 1 < q.length && q[i + 1] !== " ") {
      negated = true;
      i++;
    }
    if (q[i] === '"') {
      const end = q.indexOf('"', i + 1);
      const text = (end < 0 ? q.slice(i + 1) : q.slice(i + 1, end)).trim();
      if (text) out.push({ kind: "phrase", text, negated, closed: end >= 0 });
      i = end < 0 ? q.length : end + 1;
      continue;
    }
    let j = i;
    while (j < q.length && q[j] !== " " && q[j] !== '"') j++;
    const text = q.slice(i, j);
    i = j;
    if (!text) continue;
    if (!negated && text === "or") out.push({ kind: "or", text, negated: false, closed: true });
    else out.push({ kind: "word", text, negated, closed: true });
  }
  return out;
}

const render = (t: Token) => (t.kind === "phrase" ? `${t.negated ? "-" : ""}"${t.text.replace(/"/g, "")}"` : `${t.negated ? "-" : ""}${t.text}`);

/** Null when there's nothing to search for. */
export function parseQuery(raw: string | null | undefined): ParsedQuery | null {
  const normalized = normalizeQuery(raw);
  if (!normalized) return null;
  let tokens = tokenize(normalized);
  // Filler words go only when something more specific is left to search for.
  const specific = tokens.filter((t) => t.kind !== "or" && !t.negated && !(t.kind === "word" && FILLER.has(t.text)));
  if (specific.length) tokens = tokens.filter((t) => !(t.kind === "word" && !t.negated && FILLER.has(t.text)));
  // A dangling "or" means nothing.
  while (tokens.length && tokens[tokens.length - 1].kind === "or") tokens.pop();
  while (tokens.length && tokens[0].kind === "or") tokens.shift();
  if (!tokens.length) return null;

  const last = tokens[tokens.length - 1];
  const open = last.kind === "word" && !last.negated;
  const prefix = open ? prefixLexeme(last.text) : null;
  const head = (open ? tokens.slice(0, -1) : tokens).map(render).join(" ");
  const words = tokens
    .filter((t) => t.kind !== "or" && !t.negated)
    .flatMap((t) => (t.kind === "phrase" ? t.text.split(" ") : [t.text]))
    .flatMap(letterRuns)
    .filter((w) => !FILLER.has(w) && !STOP.has(w));
  if (!head && !prefix && !words.length) return null;
  return { normalized, head, tail: open && prefix ? last.text : null, prefix: open ? prefix : null, prefixes: open && prefix ? prefixForms(prefix) : [], words: [...new Set(words)] };
}

/** "roboti" → ["roboti", "robot", "robo"]; "chess" → ["chess", "ches"]; "art" → ["art"]. */
export function prefixForms(prefix: string): string[] {
  const out = [prefix];
  for (const cut of [1, 2]) {
    const shorter = [...prefix].slice(0, -cut).join("");
    if ([...shorter].length >= 4) out.push(shorter);
  }
  return out;
}
