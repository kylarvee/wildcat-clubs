/**
 * Pasted links on an event ("Slides", "Sign-up form"). The schema keeps files
 * as EventAttachment rows; links ride at the end of the event's description as
 * one <ul data-type="eventLinks"> list, which survives the sanitizer and is
 * split back out for the editor and the event page. Client-safe.
 */

export type EventLink = { label: string; url: string };

const BLOCK = /<ul data-type="eventLinks">([\s\S]*?)<\/ul>/i;
const ANCHOR = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

function decode(s: string) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function encode(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function isHttpUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Splits stored description HTML into the body and its links. */
export function splitEventLinks(html: string | null | undefined): { body: string; links: EventLink[] } {
  if (!html) return { body: "", links: [] };
  const m = BLOCK.exec(html);
  if (!m) return { body: html, links: [] };
  const links: EventLink[] = [];
  for (const a of m[1].matchAll(ANCHOR)) {
    const url = decode(a[1]);
    const label = decode(a[2].replace(/<[^>]+>/g, "")).trim();
    if (isHttpUrl(url)) links.push({ url, label: label && label !== url ? label : "" });
  }
  return { body: html.replace(BLOCK, "").trim(), links };
}

/** Joins a body and links back into one HTML string (run the result through the sanitizer). */
export function joinEventLinks(body: string, links: EventLink[]): string {
  const clean = links.filter((l) => isHttpUrl(l.url));
  if (clean.length === 0) return body;
  const items = clean.map((l) => `<li><a href="${encode(l.url)}">${encode(l.label || l.url)}</a></li>`).join("");
  return `${body}<ul data-type="eventLinks">${items}</ul>`;
}

/** Friendly label for a link without one ("docs.google.com"). */
export function linkLabel(l: EventLink) {
  if (l.label) return l.label;
  try {
    return new URL(l.url).hostname.replace(/^www\./, "");
  } catch {
    return l.url;
  }
}
