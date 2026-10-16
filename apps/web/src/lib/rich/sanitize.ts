import "server-only";
import sanitizeHtml from "sanitize-html";

/**
 * Every piece of rich text (club descriptions, announcements, policies, test
 * pages, answers, event details…) is sanitized here before it's stored.
 * Embeds from the editor are kept as <div data-embed="…"> placeholders and
 * turned back into live previews by <RichContent>.
 */

const EMBED_IFRAME_HOSTS = ["www.youtube.com", "www.youtube-nocookie.com", "youtube.com", "drive.google.com", "docs.google.com", "www.google.com"];

export function sanitizeRichHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "strike", "a", "ul", "ol", "li", "blockquote",
      "code", "pre", "hr", "img", "table", "thead", "tbody", "tr", "th", "td", "colgroup", "col", "mark", "span", "div",
      "label", "input", "iframe", "sub", "sup",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel", "title"],
      img: ["src", "alt", "title", "width", "height"],
      iframe: ["src", "title", "allowfullscreen", "allow", "frameborder", "width", "height"],
      div: ["data-embed", "data-id", "data-src", "data-title", "data-mime", "data-type", "class"],
      ul: ["data-type"],
      li: ["data-checked", "data-type"],
      input: ["type", "checked", "disabled"],
      th: ["colspan", "rowspan", "colwidth", "style"],
      td: ["colspan", "rowspan", "colwidth", "style"],
      col: ["style"],
      mark: ["data-color", "style"],
      span: ["style"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      h4: ["style"],
    },
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
        "text-align": [/^(left|right|center|justify)$/],
        "min-width": [/^\d+px$/],
        width: [/^\d+px$/],
      },
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowedIframeHostnames: EMBED_IFRAME_HOSTS,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, ...(attribs.href?.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {}) },
      }),
      input: (tagName, attribs) => ({ tagName, attribs: attribs.type === "checkbox" ? { ...attribs, disabled: "disabled" } : {} }),
    },
  });
}

/** Plain text from rich HTML (previews, notifications, search, AI context). */
export function richToText(html: string | null | undefined, maxLength?: number): string {
  if (!html) return "";
  const text = sanitizeHtml(html.replace(/<\/(p|h\d|li|div|blockquote|tr)>/gi, "$&\n"), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return maxLength && text.length > maxLength ? text.slice(0, maxLength - 1).trimEnd() + "…" : text;
}
