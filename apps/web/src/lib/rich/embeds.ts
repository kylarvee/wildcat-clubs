/**
 * Embeds in rich text — the shared vocabulary between the editor (client),
 * the sanitizer and <RichContent> (server). Pure functions only: no DOM, no
 * database, safe to import anywhere.
 *
 * Stored form (the only one sanitizeRichHtml keeps):
 *   <div data-embed="video|document|file|event|map" data-id="…" data-src="…" data-title="…" data-mime="…"></div>
 *
 *   file      a platform file (FileItem id) — permission-checked when shown
 *   document  an outside document by URL (Google Docs/Sheets/Slides/Forms/Drive)
 *   video     a YouTube or Google Drive video URL
 *   event     an Event id — shown as a live card, respecting event visibility
 *   map       a campus Building id, or an address in data-src
 */

export const EMBED_KINDS = ["file", "document", "video", "event", "map"] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];

export type EmbedAttrs = {
  embed: EmbedKind;
  id: string | null;
  src: string | null;
  title: string | null;
  mime: string | null;
};

export function isEmbedKind(v: unknown): v is EmbedKind {
  return typeof v === "string" && (EMBED_KINDS as readonly string[]).includes(v);
}

/** Mirrors MAX_UPLOAD_BYTES in lib/files/storage (server-only), for client-side checks. */
export const MAX_UPLOAD_MB = 25;

// ─── URLs ────────────────────────────────────────────────────────────────────

/** Parses what a person pasted into a URL, adding https:// when they left it off. */
export function toHttpUrl(input: string | null | undefined): URL | null {
  const raw = (input ?? "").trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$|\?|#)/.test(raw) ? `https://${raw}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** An http(s) URL as a string, or null — for anything we put in an href or src. */
export function safeHttpUrl(input: string | null | undefined): string | null {
  return toHttpUrl(input)?.toString() ?? null;
}

/** Same-site paths ("/api/files/…", "/events/…") or http(s) URLs. Blocks "//evil" and every other scheme. */
export function safeLinkTarget(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) return raw;
  return safeHttpUrl(raw);
}

function hostOf(u: URL) {
  return u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, "");
}

/** "1h2m3s", "90s", "90" → seconds. */
function parseStart(t: string | null): number | null {
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) || null;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || !m[0]) return null;
  const s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return s || null;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const GOOGLE_ID = /^[A-Za-z0-9_-]{10,}$/;

/** YouTube watch / shorts / live / embed / youtu.be links → video id (+ start time). */
export function parseYouTube(input: string | null | undefined): { id: string; start: number | null } | null {
  const u = toHttpUrl(input);
  if (!u) return null;
  const host = hostOf(u);
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = u.pathname.split("/");
    if (first === "watch") id = u.searchParams.get("v");
    else if (first && ["shorts", "embed", "live", "v"].includes(first)) id = second ?? null;
  }
  if (!id || !YT_ID.test(id)) return null;
  return { id, start: parseStart(u.searchParams.get("t") ?? u.searchParams.get("start")) };
}

/** Google Drive file links (/file/d/ID/…, open?id=ID, uc?id=ID) → file id. */
export function parseDriveFileId(input: string | null | undefined): string | null {
  const u = toHttpUrl(input);
  if (!u) return null;
  const host = hostOf(u);
  if (host !== "drive.google.com" && host !== "docs.google.com") return null;
  const m = /^\/file\/d\/([^/]+)/.exec(u.pathname);
  const id = m?.[1] ?? (host === "drive.google.com" && /^\/(open|uc)$/.test(u.pathname) ? u.searchParams.get("id") : null);
  return id && GOOGLE_ID.test(id) ? id : null;
}

export type VideoInfo = {
  provider: "youtube" | "drive";
  embedUrl: string;
  openUrl: string;
  thumbnailUrl: string | null;
  providerLabel: string;
};

/** What the editor accepts as a video: YouTube or a Google Drive file. */
export function videoInfo(input: string | null | undefined): VideoInfo | null {
  const yt = parseYouTube(input);
  if (yt) {
    const q = new URLSearchParams({ rel: "0" });
    if (yt.start) q.set("start", String(yt.start));
    return {
      provider: "youtube",
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt.id}?${q}`,
      openUrl: `https://www.youtube.com/watch?v=${yt.id}${yt.start ? `&t=${yt.start}s` : ""}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg`,
      providerLabel: "YouTube",
    };
  }
  const drive = parseDriveFileId(input);
  if (drive) {
    return {
      provider: "drive",
      embedUrl: `https://drive.google.com/file/d/${drive}/preview`,
      openUrl: `https://drive.google.com/file/d/${drive}/view`,
      thumbnailUrl: null,
      providerLabel: "Google Drive",
    };
  }
  return null;
}

export type GoogleDocKind = "doc" | "sheet" | "slides" | "form" | "file" | "folder";

export type GoogleDocInfo = { kind: GoogleDocKind; label: string; previewUrl: string; openUrl: string };

const GOOGLE_DOC_LABEL: Record<GoogleDocKind, string> = {
  doc: "Google Doc",
  sheet: "Google Sheet",
  slides: "Google Slides",
  form: "Google Form",
  file: "Google Drive file",
  folder: "Google Drive folder",
};

/** Google Docs / Sheets / Slides / Forms / Drive links → their embeddable preview URL. */
export function googleDocInfo(input: string | null | undefined): GoogleDocInfo | null {
  const u = toHttpUrl(input);
  if (!u) return null;
  const host = hostOf(u);
  const make = (kind: GoogleDocKind, previewUrl: string, openUrl: string): GoogleDocInfo => ({ kind, label: GOOGLE_DOC_LABEL[kind], previewUrl, openUrl });

  if (host === "docs.google.com") {
    // /document/d/ID/edit  or published: /document/d/e/2PACX…/pub
    const m = /^\/(document|spreadsheets|presentation|forms)\/d\/(e\/)?([^/]+)/.exec(u.pathname);
    if (m && GOOGLE_ID.test(m[3])) {
      const [, app, published, id] = m;
      const base = `https://docs.google.com/${app}/d/${published ?? ""}${id}`;
      switch (app) {
        case "document":
          return make("doc", published ? `${base}/pub?embedded=true` : `${base}/preview`, published ? `${base}/pub` : `${base}/edit`);
        case "spreadsheets":
          return make("sheet", published ? `${base}/pubhtml?widget=true&headers=false` : `${base}/preview`, published ? `${base}/pubhtml` : `${base}/edit`);
        case "presentation":
          return make("slides", `${base}/embed?start=false&loop=false`, published ? `${base}/pub` : `${base}/edit`);
        case "forms":
          return make("form", `${base}/viewform?embedded=true`, `${base}/viewform`);
      }
    }
  }
  const fileId = parseDriveFileId(u.toString());
  if (fileId) return make("file", `https://drive.google.com/file/d/${fileId}/preview`, `https://drive.google.com/file/d/${fileId}/view`);
  if (host === "drive.google.com") {
    const folder = /\/folders\/([^/?#]+)/.exec(u.pathname)?.[1];
    if (folder && GOOGLE_ID.test(folder)) {
      return make("folder", `https://drive.google.com/embeddedfolderview?id=${folder}#list`, `https://drive.google.com/drive/folders/${folder}`);
    }
  }
  return null;
}

/** Google Maps embed (no API key) for a place name, address or "lat,lng". */
export function mapsEmbedUrl(query: string) {
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

/** The "Open in Google Maps" link. */
export function mapsSearchUrl(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// ─── Files ───────────────────────────────────────────────────────────────────

export type FileKind = "pdf" | "image" | "video" | "audio" | "doc" | "sheet" | "slides" | "archive" | "text" | "other";

const EXT_KIND: Record<string, FileKind> = {
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", avif: "image",
  mp4: "video", mov: "video", webm: "video", m4v: "video",
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio",
  doc: "doc", docx: "doc", odt: "doc", rtf: "doc", pages: "doc",
  xls: "sheet", xlsx: "sheet", csv: "sheet", ods: "sheet", numbers: "sheet",
  ppt: "slides", pptx: "slides", odp: "slides", key: "slides",
  zip: "archive", rar: "archive", "7z": "archive", gz: "archive", tar: "archive",
  txt: "text", md: "text", json: "text",
};

/** Rough kind of a file, from its MIME type and/or name. Decides how it previews and which icon it gets. */
export function fileKind(mime: string | null | undefined, name?: string | null): FileKind {
  const m = (mime ?? "").toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.includes("wordprocessing") || m === "application/msword" || m.includes("opendocument.text")) return "doc";
  if (m.includes("spreadsheet") || m === "application/vnd.ms-excel" || m === "text/csv") return "sheet";
  if (m.includes("presentation") || m === "application/vnd.ms-powerpoint") return "slides";
  if (m.includes("zip") || m.includes("compressed") || m.includes("x-tar")) return "archive";
  const ext = (name ?? "").toLowerCase().split(".").pop() ?? "";
  if (ext && EXT_KIND[ext]) return EXT_KIND[ext];
  if (m.startsWith("text/") || m === "application/json") return "text";
  return "other";
}

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  pdf: "PDF",
  image: "Image",
  video: "Video",
  audio: "Audio",
  doc: "Document",
  sheet: "Spreadsheet",
  slides: "Presentation",
  archive: "Archive",
  text: "Text file",
  other: "File",
};

/** 1536 → "1.5 KB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

// ─── HTML ────────────────────────────────────────────────────────────────────

function escapeAttr(v: string) {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeEntities(v: string) {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * The stored placeholder for an embed. Other tools that build rich HTML in
 * code (e.g. an announcement that features an event) use this so their
 * output looks exactly like the editor's.
 */
export function embedHtml(attrs: Partial<EmbedAttrs> & { embed: EmbedKind }): string {
  const parts = [`data-embed="${attrs.embed}"`];
  for (const key of ["id", "src", "title", "mime"] as const) {
    const v = attrs[key];
    if (v) parts.push(`data-${key}="${escapeAttr(String(v))}"`);
  }
  return `<div ${parts.join(" ")}></div>`;
}

/** Reads the attributes of an embed placeholder tag (the part between "<div" and ">"). */
export function parseEmbedAttrs(attrString: string): EmbedAttrs | null {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
  for (let m = re.exec(attrString); m; m = re.exec(attrString)) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? "");
  const embed = attrs["data-embed"];
  if (!isEmbedKind(embed)) return null;
  return {
    embed,
    id: attrs["data-id"] || null,
    src: attrs["data-src"] || null,
    title: attrs["data-title"] || null,
    mime: attrs["data-mime"] || null,
  };
}

export type RichPart = { type: "html"; html: string } | { type: "embed"; attrs: EmbedAttrs };

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const TAG_SOURCE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/.source;
const EMBED_OPEN_RE = /\bdata-embed\s*=/i;
/** True when a run of HTML would render nothing (blank lines left between embeds). */
const isBlankHtml = (html: string) => !html.replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "").trim();

/** A plain-HTML stand-in for an embed that sits inside a list or table, where a live block can't go. */
function nestedEmbedFallback(a: EmbedAttrs | null): string {
  if (!a) return "";
  const title = escapeAttr(a.title || "");
  let href: string | null = null;
  let text = title;
  switch (a.embed) {
    case "video":
      href = safeHttpUrl(a.src);
      text = title || "Watch video";
      break;
    case "document":
      href = safeHttpUrl(a.src);
      text = title || "Open document";
      break;
    case "file":
      href = a.id ? `/api/files/${encodeURIComponent(a.id)}` : null;
      text = "Open attached file";
      break;
    case "event":
      href = a.id ? `/events/${encodeURIComponent(a.id)}` : null;
      text = "View event";
      break;
    case "map":
      href = a.src || a.title ? mapsSearchUrl(a.src || a.title || "") : null;
      text = title || "Open map";
      break;
  }
  if (!href) return "";
  const external = href.startsWith("http");
  return `<a href="${escapeAttr(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
}

/**
 * Splits sanitized rich HTML into plain-HTML runs and top-level embeds, in
 * order. The editor only places embeds at the top level; one found deeper (in
 * a list or table, from pasted or older content) becomes a plain link.
 * Expects sanitizer output (well-formed, attribute values double-quoted).
 */
export function splitRichHtml(html: string): RichPart[] {
  const parts: RichPart[] = [];
  let depth = 0;
  let cursor = 0;
  let out = "";
  const TAG_RE = new RegExp(TAG_SOURCE, "g");
  for (let m = TAG_RE.exec(html); m; m = TAG_RE.exec(html)) {
    const [whole, closing, rawName, attrString] = m;
    const name = rawName.toLowerCase();
    if (closing) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (name === "div" && EMBED_OPEN_RE.test(attrString)) {
      // Find the end of this div (embeds are empty, but skip any content defensively).
      let inner = 1;
      let end = m.index + whole.length;
      const scan = new RegExp(TAG_SOURCE, "g");
      scan.lastIndex = end;
      for (let n = scan.exec(html); n; n = scan.exec(html)) {
        const nName = n[2].toLowerCase();
        if (VOID_TAGS.has(nName) || n[3].trimEnd().endsWith("/")) continue;
        inner += n[1] ? -1 : 1;
        end = n.index + n[0].length;
        if (inner === 0) break;
      }
      if (inner !== 0) end = html.length;
      const attrs = parseEmbedAttrs(attrString);
      out += html.slice(cursor, m.index);
      if (depth === 0 && attrs) {
        if (!isBlankHtml(out)) parts.push({ type: "html", html: out });
        out = "";
        parts.push({ type: "embed", attrs });
      } else {
        out += nestedEmbedFallback(attrs);
      }
      cursor = end;
      TAG_RE.lastIndex = end;
      continue;
    }
    if (!VOID_TAGS.has(name) && !attrString.trimEnd().endsWith("/")) depth++;
  }
  out += html.slice(cursor);
  if (!isBlankHtml(out)) parts.push({ type: "html", html: out });
  return parts;
}
