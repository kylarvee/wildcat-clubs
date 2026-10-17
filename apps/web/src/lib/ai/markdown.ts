/**
 * A deliberately small Markdown reader for assistant answers. It produces a
 * tree that components/assistant/Markdown.tsx renders as React elements, so no
 * HTML from the model ever reaches the page. Supports what answers actually
 * use: paragraphs, headings, bullet and numbered lists, tables, code, quotes,
 * rules, **bold**, *italic*, `code` and [links](/clubs/chess-club).
 *
 * Unfinished syntax (mid-stream "**bold") simply renders as text.
 * Client-safe: no server imports.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "code"; v: string }
  | { t: "quote"; c: Inline[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" };

/**
 * Links we allow: site paths ("/clubs/x", never "//host"), http(s) and mailto.
 * Anything else (javascript:, data:, relative tricks) renders as plain text.
 */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^\/(?!\/)[^\s]*$/.test(href)) return href;
  if (/^https?:\/\/[^\s/]+[^\s]*$/i.test(href)) return href;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return href;
  return null;
}

/** True when the link leaves Wildcat Clubs (opens in a new tab). */
export function isExternalHref(href: string): boolean {
  return !href.startsWith("/");
}

const isWordChar = (ch: string | undefined) => Boolean(ch && /[A-Za-z0-9]/.test(ch));

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && /[\\`*_[\]()#|>-]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (src.startsWith("**", i) || src.startsWith("__", i)) {
      const marker = src.slice(i, i + 2);
      const end = src.indexOf(marker, i + 2);
      if (end > i + 2 && src[i + 2] !== " ") {
        flush();
        out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] !== " " && src[i + 1] !== ch) {
      // "_" only opens emphasis at a word start, so snake_case stays text.
      const opens = ch === "*" || !isWordChar(src[i - 1]);
      let end = src.indexOf(ch, i + 1);
      while (end > -1 && ch === "_" && isWordChar(src[end + 1])) end = src.indexOf(ch, end + 1);
      if (opens && end > i + 1 && src[end - 1] !== " ") {
        flush();
        out.push({ t: "em", c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const close = findClosingBracket(src, i);
      if (close > -1 && src[close + 1] === "(") {
        const paren = src.indexOf(")", close + 2);
        if (paren > -1) {
          const label = src.slice(i + 1, close);
          const href = safeHref(src.slice(close + 2, paren));
          flush();
          if (href) out.push({ t: "link", href, c: parseInline(label) });
          else out.push(...parseInline(label));
          i = paren + 1;
          continue;
        }
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

function findClosingBracket(src: string, open: number): number {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "\n") return -1;
    if (src[j] === "[") depth++;
    else if (src[j] === "]" && --depth === 0) return j;
  }
  return -1;
}

const BULLET = /^\s*[-*•+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      endPara();
      continue;
    }
    if (FENCE.test(line)) {
      endPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      blocks.push({ t: "code", v: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endPara();
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ t: "h", level, c: parseInline(heading[2].replace(/\s#+\s*$/, "")) });
      continue;
    }
    if (RULE.test(line) && !para.length) {
      blocks.push({ t: "hr" });
      continue;
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      endPara();
      const head = splitRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(splitRow(lines[i++]).map(parseInline));
      i--;
      blocks.push({ t: "table", head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      endPara();
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      i--;
      blocks.push({ t: "quote", c: parseInline(body.join("\n")) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      endPara();
      const ordered = !bullet;
      const items: string[] = [];
      const start = numbered ? Number(numbered[1]) : 1;
      for (; i < lines.length; i++) {
        const l = lines[i];
        const m = ordered ? NUMBERED.exec(l) : BULLET.exec(l);
        if (m) items.push(ordered ? m[2] : m[1]);
        else if (l.trim() && /^\s{2,}/.test(l) && items.length) items[items.length - 1] += "\n" + l.trim();
        else if (l.trim() && (ordered ? BULLET.test(l) : NUMBERED.test(l)) && items.length) items.push(l.replace(ordered ? BULLET : NUMBERED, ordered ? "$1" : "$2"));
        else break;
      }
      i--;
      const parsed = items.map((it) => parseInline(it));
      blocks.push(ordered ? { t: "ol", start, items: parsed } : { t: "ul", items: parsed });
      continue;
    }
    para.push(line);
  }
  endPara();
  return blocks;
}

/** Plain text of an inline tree (for aria labels and copy). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? "\n" : inlineText(n.c))).join("");
}
