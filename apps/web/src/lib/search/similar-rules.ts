import { STANDING_LABEL, standingOf, type ClubStanding } from "@/lib/labels/clubs";
import { fmtDate } from "@/lib/time";
import { parseQuery } from "./query-text";

/**
 * "Similar clubs already exist": the rules, pure (no database), so the
 * ranking and the standing text are unit-tested. lib/search/similar gathers
 * the facts with THE club search engine's index (approved clubs) and a small
 * name match of its own for retired clubs, which aren't indexed.
 *
 * Two signals, each 0–1, for a proposed club (name + short description):
 *   name     how much of the proposal's name the club's name shares: words
 *            that closely match (typos, plurals and words still being typed
 *            count). Approved and retired clubs alike.
 *   purpose  how much of the proposal's words (name and short description,
 *            stemmed) the club's search document has: in its name, its
 *            labels and short description, or its about and events.
 *            Approved clubs only (the index).
 * Each signal is coverage × √breadth. Coverage weighs words by how rare they
 * are, so a word on many clubs ("wildcat", "association", "campus") adds
 * little. Breadth is the share of the proposal's telling (not common) words
 * the club has, so one shared word in another sense ("Advisory Board" for
 * "Board Game Night") doesn't make a match, and a club sharing only common
 * words isn't one at all. For purpose, breadth counts only what's on the
 * club's card (its name, labels and short description): its about and events
 * add to the coverage, but one co-hosted event about a thing doesn't make a
 * club about it. score = the stronger signal plus a quarter of the weaker,
 * with purpose counting SIMILAR.purposeWeight as much as name; clubs scoring
 * at least SIMILAR.min are listed, best first, at most SIMILAR.limit.
 */

export const SIMILAR = {
  limit: 5,
  /** A partial match on a whole name ("Ballroom and Hip Hop Club" for "Ballroom Dance") lands just above this. */
  min: 0.32,
  /** A name word on at least this share of club names (and at least 3) is common: it only adds to a match. */
  commonNameShare: 0.02,
  /** A word in at least this share of club documents is too common to say anything about purpose. */
  commonTextShare: 0.08,
  /** Description words count less than name words. */
  descriptionWeight: 0.6,
  /** Where in a club's document a word was found: name, labels and short description, about and events. */
  section: { a: 1, b: 0.8, c: 0.5 },
  /** A name like yours says more than your words on someone's card, so purpose counts a little less. */
  purposeWeight: 0.85,
  /** How much the weaker signal adds. */
  bonus: 0.25,
} as const;

// ─── Words ───────────────────────────────────────────────────────────────────

/**
 * Words that name a kind of group rather than what it does ("Robotics Team",
 * "Chess League"). The search engine's own filler list (club, society,
 * student, wsu…) goes first; these go too, for comparing clubs.
 */
const GROUP_WORDS = new Set(["team", "teams", "league", "leagues", "crew", "squad", "guild", "collective", "network", "alliance", "coalition", "council", "committee", "chapter", "association", "federation", "union", "circle", "community"]);

/** The words of a name or description that say what it is: lowercase, accents folded, without filler ("club", "society", "student", "wsu", "team"…) or stop words. */
export function meaningfulWords(text: string | null | undefined): string[] {
  return (parseQuery(text)?.words ?? []).filter((w) => !GROUP_WORDS.has(w));
}

function trigrams(word: string): Set<string> {
  const s = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** pg_trgm's similarity() for two words: shared trigrams over all trigrams (each word padded the way pg_trgm pads it). */
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = trigrams(a);
  const B = trigrams(b);
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return common / (A.size + B.size - common);
}

/**
 * How alike two words are, 0–1: trigram similarity, or 0.75 when they share a
 * beginning of at least 4 letters that's two-thirds of the shorter word
 * ("beekeepers"/"beekeeping", "robots"/"robotics", "phot" while typing "photography").
 */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  const stem = shared >= 4 && shared >= (2 / 3) * Math.min(a.length, b.length) ? 0.75 : 0;
  return Math.max(trigramSimilarity(a, b), stem);
}

/** The bar a word has to clear, like the engine's name match: exact up to 2 letters, 0.75 for 3, else 0.5. */
export const wordBar = (word: string) => (word.length <= 2 ? 1 : word.length === 3 ? 0.75 : 0.5);

/** The best match for `word` among `words` (0 when none clears the bar). */
export function bestMatch(word: string, words: readonly string[]): number {
  let best = 0;
  for (const w of words) best = Math.max(best, wordSimilarity(word, w));
  return best >= wordBar(word) ? best : 0;
}

/** Rarer words weigh more: ln(N ÷ (df + 1)), where df is how many of the N names or documents have the word. */
export function rarity(df: number, total: number): number {
  return Math.max(0, Math.log(Math.max(1, total) / (Math.max(0, df) + 1)));
}

// ─── Name ────────────────────────────────────────────────────────────────────

export type NameIndex = { names: string[][]; df: (word: string) => number; total: number };

/** Every candidate club's name words, and how many names have a word like a given one. */
export function nameIndex(names: readonly string[][]): NameIndex {
  const list = names.map((n) => [...new Set(n)]);
  const cache = new Map<string, number>();
  return {
    names: list,
    total: list.length,
    df: (word) => {
      let n = cache.get(word);
      if (n === undefined) {
        n = list.filter((ws) => bestMatch(word, ws) > 0).length;
        cache.set(word, n);
      }
      return n;
    },
  };
}

/** A name word on many club names ("association", "state", "wildcat"). */
export const isCommonNameWord = (df: number, total: number) => df >= Math.max(3, SIMILAR.commonNameShare * total);

/** coverage × √breadth, 0 when no telling word matched. */
export function signal(coverage: number, tellingMatched: number, tellingTotal: number): number {
  if (tellingMatched <= 0 || tellingTotal <= 0 || coverage <= 0) return 0;
  return Math.min(1, coverage) * Math.sqrt(Math.min(1, tellingMatched / tellingTotal));
}

/**
 * The name signal: the rarity-weighted share of the proposal's name words
 * that match a word of the club's name (each counted by how close it is),
 * times √(its telling words matched ÷ its telling words). Two clubs both
 * called "Wildcat Something" aren't alike for that.
 */
export function nameSignal(proposal: readonly string[], club: readonly string[], index: Pick<NameIndex, "df" | "total">): number {
  let total = 0;
  let got = 0;
  let telling = 0;
  let tellingMatched = 0;
  for (const p of new Set(proposal)) {
    const df = index.df(p);
    const w = rarity(df, index.total);
    const common = isCommonNameWord(df, index.total);
    total += w;
    if (!common) telling++;
    const best = bestMatch(p, club);
    if (!best) continue;
    got += w * best;
    if (!common) tellingMatched++;
  }
  return total > 0 ? signal(got / total, tellingMatched, telling) : 0;
}

// ─── Purpose (the index) ─────────────────────────────────────────────────────

export type ProposalLexeme = { lexeme: string; fromName: boolean };

export type WeightedLexeme = { lexeme: string; weight: number; /** Rare enough to say something on its own. */ telling: boolean };

/**
 * The proposal's stemmed words with their weights for the purpose signal:
 * rarer words count more, description words SIMILAR.descriptionWeight as
 * much as name words. Words in SIMILAR.commonTextShare of documents or more
 * still count toward the whole (so matching only part of an idea scores
 * low) but aren't `telling`: a club matching nothing else isn't listed.
 */
export function lexemeWeights(lexemes: readonly ProposalLexeme[], df: (lexeme: string) => number, total: number): WeightedLexeme[] {
  const byLexeme = new Map<string, boolean>();
  for (const l of lexemes) byLexeme.set(l.lexeme, (byLexeme.get(l.lexeme) ?? false) || l.fromName);
  const out: WeightedLexeme[] = [];
  for (const [lexeme, fromName] of byLexeme) {
    const n = df(lexeme);
    const weight = rarity(n, total) * (fromName ? 1 : SIMILAR.descriptionWeight);
    if (weight > 0) out.push({ lexeme, weight, telling: total > 0 && n / total < SIMILAR.commonTextShare });
  }
  return out;
}

/**
 * The purpose signal from what the index found in one club's document: the
 * weighted share of the proposal found there (each word counted by where:
 * SIMILAR.section), times √(telling words on its card ÷ the proposal's telling words).
 */
export function purposeSignal(covered: number, total: number, tellingMatched: number, tellingTotal: number): number {
  return total > 0 ? signal(covered / total, tellingMatched, tellingTotal) : 0;
}

// ─── Score and order ─────────────────────────────────────────────────────────

export function similarityScore(name: number, purpose: number) {
  const p = purpose * SIMILAR.purposeWeight;
  return Math.min(1, Math.max(name, p) + SIMILAR.bonus * Math.min(name, p));
}

export type SimilarCandidate = { id: string; name: string; status: "APPROVED" | "RETIRED"; nameScore: number; purposeScore: number };

export type Scored<T> = T & { score: number; reason: "name" | "purpose" };

/** The clubs worth showing, best first: approved before retired on a tie, then by name. */
export function rankSimilar<T extends SimilarCandidate>(candidates: readonly T[], limit: number = SIMILAR.limit): Scored<T>[] {
  return candidates
    .map((c) => ({ ...c, score: similarityScore(c.nameScore, c.purposeScore), reason: (c.nameScore >= c.purposeScore * SIMILAR.purposeWeight ? "name" : "purpose") as "name" | "purpose" }))
    .filter((c) => c.score >= SIMILAR.min)
    .sort((a, b) => b.score - a.score || Number(a.status === "RETIRED") - Number(b.status === "RETIRED") || a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
    .slice(0, limit);
}

// ─── Standing ────────────────────────────────────────────────────────────────

export type SimilarStanding = ClubStanding | "retired";

/** One similar club as the wizard and the office's review show it (plain data, safe to send to the browser). */
export type SimilarClub = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  logoColor: string;
  shortDescription: string;
  status: "APPROVED" | "RETIRED";
  standing: SimilarStanding;
  /** "Active", "Pilot period", "Inactive", "Retired". */
  standingLabel: string;
  /** Members and when it was last active, in words: ["12 members", "No events since March"]. */
  facts: string[];
  /** Which signal put it on the list: a name like the proposal's, or what it's about. */
  reason: "name" | "purpose";
  /** The viewer already belongs to it (or asked to), when a viewer was given. */
  viewer: { member: boolean; pending: boolean } | null;
  /** Retired clubs: whether someone's request to bring it back is open, and whether it's the viewer's. */
  revival: { open: boolean; mine: boolean } | null;
  /** The office that oversees it ("WSUSA", "Campus Recreation"): who'd decide a request to bring it back. */
  office: string;
};

/** Held events count as recent for this long (the activity score's window). */
const RECENT_DAYS = 30;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "March", or "March 2025" when it isn't this year. */
function monthOf(d: Date, now: Date) {
  return fmtDate(d, "yyyy") === fmtDate(now, "yyyy") ? fmtDate(d, "MMMM") : fmtDate(d, "MMMM yyyy");
}

/**
 * A similar club's standing in plain words: Active / Pilot period / Inactive
 * (the metrics layer's ACTIVE CLUB rule) or Retired, with its members and
 * when it was last active ("No events since March").
 */
export function similarStanding(i: {
  status: "APPROVED" | "RETIRED";
  isActive: boolean;
  inPilot: boolean;
  /** Registered members now; for a retired club, the members it had when it retired. */
  members: number;
  /** Its last held event (started, with a check-in), hosted or co-hosted. */
  lastHeldAt: Date | null;
  retiredAt: Date | null;
  now: Date;
}): { standing: SimilarStanding; label: string; facts: string[] } {
  if (i.status === "RETIRED") {
    const facts = [i.retiredAt ? `Retired in ${fmtDate(i.retiredAt, "MMMM yyyy")}` : "Retired"];
    if (i.members > 0) facts.push(`Had ${plural(i.members, "member")}`);
    if (i.lastHeldAt) facts.push(`Last event in ${fmtDate(i.lastHeldAt, "MMMM yyyy")}`);
    return { standing: "retired", label: "Retired", facts };
  }
  const standing = standingOf({ inPilot: i.inPilot, isActive: i.isActive });
  const recent = i.lastHeldAt && i.now.getTime() - i.lastHeldAt.getTime() <= RECENT_DAYS * 86_400_000;
  const events = !i.lastHeldAt ? "No events yet" : recent ? `Last event ${fmtDate(i.lastHeldAt, "MMM d")}` : `No events since ${monthOf(i.lastHeldAt, i.now)}`;
  const members = i.members > 0 ? plural(i.members, "member") : "No members yet";
  // An inactive club leads with why: its quiet calendar, or (events going) how few members it has.
  const few = i.members > 0 ? `Only ${plural(i.members, "member")}` : "No members yet";
  const facts = standing === "inactive" && recent ? [few, events] : standing === "inactive" ? [events, members] : [members, events];
  return { standing, label: STANDING_LABEL[standing], facts };
}
