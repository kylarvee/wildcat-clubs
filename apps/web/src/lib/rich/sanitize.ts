import "server-only";
import sanitizeHtml from "sanitize-html";
import { isEmbedKind, safeLinkTarget } from "@/lib/rich/embeds";

/**
 * Every piece of rich text (club descriptions, announcements, policies, test
 * pages, answers, event details…) is sanitized here before it's stored, and
 * again by <RichContent> before it's shown.
 *
 * Keeps everything the editor makes (headings, marks, links, lists, task
 * lists, tables, alignment, highlight, images, code) and embed placeholders
 * (<div data-embed="…">, turned into live previews by <RichContent>).
 * Drops scripts, event handlers, unknown schemes, arbitrary classes (a stray
 * Tailwind class could restyle the page) and iframes outside a short list of
 * video/document hosts.
 */

const EMBED_IFRAME_HOSTS = ["www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "drive.google.com", "docs.google.com", "www.google.com"];

const HEX_OR_RGB = [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i];
const PX = [/^\d{1,4}px$/];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "strike", "a", "ul", "ol", "li", "blockquote",
    "code", "pre", "hr", "img", "table", "thead", "tbody", "tr", "th", "td", "colgroup", "col", "mark", "span", "div",
    "label", "input", "iframe", "sub", "sup",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel", "title"],
    img: ["src", "alt", "title", "width", "height"],
    iframe: ["src", "title", "allowfullscreen", "allow", "width", "height", "loading", "referrerpolicy", "sandbox"],
    div: ["data-embed", "data-id", "data-src", "data-title", "data-mime", "data-type"],
    ul: ["data-type"],
    ol: ["start", "type"],
    li: ["data-checked", "data-type"],
    input: ["type", "checked", "disabled"],
    table: ["style"],
    th: ["colspan", "rowspan", "colwidth", "style"],
    td: ["colspan", "rowspan", "colwidth", "style"],
    col: ["style", "width"],
    mark: ["data-color", "style"],
    span: ["style"],
    p: ["style"],
    h1: ["style"],
    h2: ["style"],
    h3: ["style"],
    h4: ["style"],
  },
  // TipTap wraps editable tables in div.tableWrapper; nothing else may carry a class.
  allowedClasses: { div: ["tableWrapper"] },
  allowedStyles: {
    "*": {
      color: HEX_OR_RGB,
      "background-color": HEX_OR_RGB,
      "text-align": [/^(left|right|center|justify)$/],
      "min-width": PX,
      width: PX,
    },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https", "data"], iframe: ["https"] },
  allowProtocolRelative: false,
  allowedIframeHostnames: EMBED_IFRAME_HOSTS,
  allowIframeRelativeUrls: false,
  transformTags: {
    a: (tagName, attribs) => {
      const external = /^https?:/i.test(attribs.href ?? "");
      const next = { ...attribs };
      if (external) Object.assign(next, { target: "_blank", rel: "noopener noreferrer nofollow" });
      else if (next.target) next.rel = "noopener noreferrer";
      return { tagName, attribs: next };
    },
    input: (tagName, attribs) => ({
      tagName,
      // Only task-list checkboxes survive, and they're read-only once rendered.
      attribs: attribs.type === "checkbox" ? { type: "checkbox", ...(attribs.checked !== undefined ? { checked: "checked" } : {}), disabled: "disabled" } : {},
    }),
    iframe: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        loading: "lazy",
        referrerpolicy: "strict-origin-when-cross-origin",
        sandbox: "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms",
      },
    }),
    div: (tagName, attribs) => ({ tagName, attribs: cleanEmbedAttrs(attribs) }),
  },
  // Inputs that aren't task-list checkboxes come out of the transform with no type: drop them.
  exclusiveFilter: (frame) => frame.tag === "input" && frame.attribs.type !== "checkbox",
};

/** Keeps embed data attributes only when they describe a real embed with safe values. */
function cleanEmbedAttrs(attribs: sanitizeHtml.Attributes): sanitizeHtml.Attributes {
  if (!("data-embed" in attribs)) return attribs;
  const { "data-embed": kind, "data-id": id, "data-src": src, "data-title": title, "data-mime": mime, ...rest } = attribs;
  if (!isEmbedKind(kind)) return rest;
  const out: sanitizeHtml.Attributes = { ...rest, "data-embed": kind };
  if (id && /^[\w-]{1,64}$/.test(id)) out["data-id"] = id;
  // A map's src is an address or place name; every other kind's src is a link.
  const safeSrc = kind === "map" ? src?.replace(/[\u0000-\u001f]/g, "").trim() : safeLinkTarget(src);
  if (safeSrc) out["data-src"] = safeSrc.slice(0, kind === "map" ? 300 : 2000);
  if (title?.trim()) out["data-title"] = title.trim().slice(0, 300);
  if (mime && /^[\w.+-]+\/[\w.+-]+$/.test(mime)) out["data-mime"] = mime.slice(0, 120);
  return out;
}

export function sanitizeRichHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, OPTIONS);
}

const EMBED_LABEL: Record<string, string> = { video: "Video", document: "Document", file: "File", event: "Event", map: "Map" };

/** Plain text from rich HTML (previews, notifications, search, AI context). */
export function richToText(html: string | null | undefined, maxLength?: number): string {
  if (!html) return "";
  const withBreaks = html
    // Embeds have no text of their own; name them so previews and the AI know they're there.
    .replace(/<div\b[^>]*\bdata-embed="(\w+)"[^>]*>\s*<\/div>/gi, (tag: string, kind: string) => {
      const title = /\bdata-title="([^"]*)"/i.exec(tag)?.[1];
      const label = EMBED_LABEL[kind] ?? "Attachment";
      return `<p>[${label}${title ? `: ${title}` : ""}]</p>`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h\d|li|div|blockquote|tr|pre)>/gi, "$&\n");
  const text = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;| /g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return maxLength && text.length > maxLength ? text.slice(0, maxLength - 1).trimEnd() + "…" : text;
}
