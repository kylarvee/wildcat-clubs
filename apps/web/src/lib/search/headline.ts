import type { Segment } from "./types";

/**
 * ts_headline output → text segments. Postgres marks matched words with two
 * control characters (stripped from every indexed text, so they can't occur
 * naturally); the UI renders segments as text with <mark> around hits, never
 * as HTML.
 */

export const HIT_START = "\u0001";
export const HIT_END = "\u0002";

export function toSegments(headline: string): Segment[] {
  const out: Segment[] = [];
  const push = (text: string, hit: boolean) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += text;
    else out.push({ text, hit });
  };
  for (const [i, part] of headline.split(HIT_START).entries()) {
    if (i === 0) {
      push(part.replaceAll(HIT_END, ""), false);
      continue;
    }
    const end = part.indexOf(HIT_END);
    push(end < 0 ? part : part.slice(0, end), true);
    if (end >= 0) push(part.slice(end + 1).replaceAll(HIT_END, ""), false);
  }
  return out;
}

/** Adds "…" where the excerpt starts or ends inside the passage (fragments are joined with " … "). */
export function withEllipses(segments: Segment[], body: string): Segment[] {
  const fragments = segments
    .map((s) => s.text)
    .join("")
    .split(" … ");
  const first = fragments[0].trim();
  const last = fragments[fragments.length - 1].trim();
  const text = body.trim();
  const out = [...segments];
  if (first && !text.startsWith(first)) out.unshift({ text: "… ", hit: false });
  if (last && !text.endsWith(last)) out.push({ text: " …", hit: false });
  return out;
}
