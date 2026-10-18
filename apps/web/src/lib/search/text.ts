/**
 * Pure text helpers for the club search index (no database, no React), so
 * the indexer stays importable from plain `tsx` scripts like the seed.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** One clean line or paragraph: no control characters, single spaces. */
export function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n")
    .trim();
}

/**
 * Stored rich text (already sanitized on write) as plain text, for indexing.
 * Block ends become line breaks; embeds and an event's pasted-links list
 * carry no words of their own, so they're dropped.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const text = html
    .replace(/<ul data-type="eventLinks">[\s\S]*?<\/ul>/gi, " ")
    .replace(/<(script|style|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div|blockquote|tr|pre|ul|ol|table)>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return cleanText(decodeEntities(text));
}

/**
 * Text as Postgres should see it: slashes split ("VC/PE" would otherwise be
 * read as one file-path token and hide both words), underscores read as spaces.
 */
export function indexable(s: string | null | undefined): string {
  return cleanText((s ?? "").replace(/[/\\_|]+/g, " ")).replace(/\n/g, " ");
}

/** A file name as words: "Makerspace_Safety-Checklist.pdf" → "Makerspace Safety-Checklist". */
export function fileWords(name: string): string {
  return indexable(name.replace(/\.[a-z0-9]{1,5}$/i, ""));
}

/** Cuts at a word boundary and adds an ellipsis when it had to cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Splits text into passages of at most `max` characters, keeping paragraphs
 * and sentences together where they fit, so a snippet reads naturally.
 */
export function chunkText(text: string, max = 600): string[] {
  const out: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) out.push(current.trim());
    current = "";
  };
  const pieces = cleanText(text)
    .split("\n")
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=\S)/));
  for (const raw of pieces) {
    let piece = raw.trim();
    if (!piece) continue;
    while (piece.length > max) {
      // One very long sentence: cut it at a word boundary.
      push();
      const cut = piece.slice(0, max);
      const space = cut.lastIndexOf(" ");
      const at = space > max * 0.5 ? space : max;
      out.push(piece.slice(0, at).trim());
      piece = piece.slice(at).trim();
    }
    if (current && current.length + 1 + piece.length > max) push();
    current = current ? `${current} ${piece}` : piece;
  }
  push();
  return out;
}

const SMALL_WORDS = new Set(["of", "and", "the", "for", "at", "in", "a", "an", "to", "on", "de", "la", "del", "y", "&", "+"]);
/** Trailing words people leave out of an acronym ("Model United Nations" for MUNO). */
const TRAILING_GENERIC = new Set(["club", "organization", "association", "group", "team"]);

/**
 * Other names a club goes by, for the name field of the index. A name like
 * "Society of Women Engineers (SWE)" already carries its acronym; one without
 * gets its initials when it has three or more significant words
 * ("Society of Physics Students" → "SPS"), plus the initials without a
 * trailing "Club"/"Organization" ("Model United Nations Organization" → "MUNO", "MUN").
 */
export function nameAliases(name: string): string[] {
  if (/\([^()]*\)/.test(name)) return [];
  const base = name
    .replace(/\s+(at|@)\s+.*$/i, "")
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = new Set<string>();
  const existing = new Set(name.toLowerCase().split(/[^\p{L}\p{N}]+/u));
  for (const part of base) {
    const words = part
      .split(/[\s]+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((w) => w && !SMALL_WORDS.has(w.toLowerCase()));
    if (words.length < 3) continue;
    const initials = (ws: string[]) => ws.map((w) => w[0]!.toUpperCase()).join("");
    const variants = [initials(words)];
    if (TRAILING_GENERIC.has(words[words.length - 1]!.toLowerCase()) && words.length >= 4) variants.push(initials(words.slice(0, -1)));
    for (const v of variants) if (v.length >= 3 && v.length <= 8 && !existing.has(v.toLowerCase())) out.add(v);
  }
  return [...out];
}
