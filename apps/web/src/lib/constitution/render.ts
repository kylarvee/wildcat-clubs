import {
  DOC_LABEL,
  enabledSections,
  FIELDS,
  missing,
  MISSING_CLOSE,
  MISSING_OPEN,
  type Block,
  type ClubFacts,
  type DocKind,
  type DraftData,
  type RenderContext,
} from "@/lib/constitution/templates";

/**
 * Turns a draft + the club it's for into a structured document. The builder
 * preview, the stored contentHtml and the PDF all render from this one shape.
 */

export type RenderedArticle = { id: string; number: number; roman: string; title: string; blocks: Block[] };

export type RenderedDoc = {
  kind: DocKind;
  label: string; // "Constitution" | "Bylaws"
  title: string; // "Constitution of the Weber State Chess Club"
  clubName: string;
  preamble: string;
  articles: RenderedArticle[];
};

export function roman(n: number): string {
  const map: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

export const EMPTY_FACTS: ClubFacts = { name: null, type: null, departmentName: null, collegeName: null };

export function renderDoc(kind: DocKind, data: DraftData, facts: ClubFacts = EMPTY_FACTS): RenderedDoc {
  const clubName = facts.name?.trim() || missing("Club name");
  const raw = (id: string) => (data.fields[id] ?? FIELDS.get(id)?.default ?? "").trim();
  const enabled = new Set([...enabledSections(data, "constitution"), ...enabledSections(data, "bylaws")].map((s) => s.id));
  const ctx: RenderContext = {
    raw,
    v: (id) => raw(id) || missing(FIELDS.get(id)?.label.replace(/[.…]+$/, "").replace(/ \(optional.*\)$/, "") ?? id),
    lines: (id) => raw(id).split(/\r?\n/).map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean),
    has: (id) => enabled.has(id),
    facts,
    clubName,
  };
  const articles = enabledSections(data, kind).map((s, i) => ({
    id: s.id,
    number: i + 1,
    roman: roman(i + 1),
    title: s.title,
    blocks: s
      .body(ctx)
      .filter((b): b is Block | string => Boolean(b))
      .map((b) => (typeof b === "string" ? ({ type: "p", text: b } as Block) : b)),
  }));
  const label = DOC_LABEL[kind];
  return {
    kind,
    label,
    title: `${label} of ${clubName}`,
    clubName,
    preamble:
      kind === "constitution"
        ? `We, the members of ${clubName} at Weber State University, adopt this Constitution to set out the Club's purpose, how it is led, and how it serves its members and the WSU community.`
        : `These Bylaws carry out the Constitution of ${clubName}. If they conflict, the Constitution controls.`,
    articles,
  };
}

/** Splits text into plain and ⟦missing⟧ runs for highlighting. */
export function splitMissing(text: string): { text: string; missing: boolean }[] {
  const out: { text: string; missing: boolean }[] = [];
  let rest = text;
  while (rest) {
    const a = rest.indexOf(MISSING_OPEN);
    const b = a >= 0 ? rest.indexOf(MISSING_CLOSE, a) : -1;
    if (a < 0 || b < 0) { out.push({ text: rest, missing: false }); break; }
    if (a > 0) out.push({ text: rest.slice(0, a), missing: false });
    out.push({ text: rest.slice(a + 1, b), missing: true });
    rest = rest.slice(b + 1);
  }
  return out;
}

/** Plain text with missing values shown as [brackets] (PDFs, emails). */
export function plain(text: string) {
  return splitMissing(text).map((r) => (r.missing ? `[${r.text}]` : r.text)).join("");
}

export function hasMissing(doc: RenderedDoc) {
  const all = [doc.title, doc.preamble, ...doc.articles.flatMap((a) => a.blocks.flatMap((b) => (b.type === "p" ? [b.text] : b.items)))];
  return all.some((t) => t.includes(MISSING_OPEN));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s: string) => splitMissing(s).map((r) => (r.missing ? `<mark>[${esc(r.text)}]</mark>` : esc(r.text))).join("");

/** Stored as ClubDocument.contentHtml (in-app reading + search). Escaped; safe for RichContent. */
export function docToHtml(doc: RenderedDoc): string {
  const parts = [`<h1>${inline(doc.title)}</h1>`, `<p><em>${inline(doc.preamble)}</em></p>`];
  for (const a of doc.articles) {
    parts.push(`<h2>Article ${a.roman}. ${esc(a.title)}</h2>`);
    for (const b of a.blocks) {
      if (b.type === "p") parts.push(`<p>${inline(b.text)}</p>`);
      else parts.push(`<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`);
    }
  }
  return parts.join("\n");
}
