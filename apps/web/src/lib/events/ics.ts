import { campusParts } from "@/lib/events/wallclock";
import { TZ } from "@/lib/time";

/**
 * iCalendar (RFC 5545) writer for the subscription feeds and .ics downloads.
 * Hand-written on purpose: the format is small, and we need exact control of
 * the three things calendar apps are picky about — CRLF line endings, folding
 * long lines at 75 octets, and escaping text values.
 *
 * Times are written in UTC ("…Z"); all-day events use campus dates.
 */

export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  status?: "CONFIRMED" | "CANCELLED" | "TENTATIVE";
  /** When the source last changed; also used as DTSTAMP. */
  updatedAt?: Date | null;
  sequence?: number;
  categories?: string[];
  geo?: { lat: number; lng: number } | null;
};

export type IcsCalendar = {
  name: string;
  description?: string | null;
  events: IcsEvent[];
  /** How often subscribers should refresh (minutes). Default 60. */
  refreshMinutes?: number;
  method?: "PUBLISH";
};

export const CRLF = "\r\n";
const PRODID = "-//Wildcat Clubs//Weber State University//EN";

/** Escapes a TEXT value: backslash, semicolon, comma and newlines (RFC 5545 §3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Folds a content line so no physical line exceeds 75 octets (§3.1). Continuation
 * lines start with one space, which counts toward their 75. Never splits a
 * multi-byte UTF-8 character.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (bytes + size > limit) {
      out.push(current);
      current = ch;
      bytes = size;
      limit = 74; // the leading space takes one octet
    } else {
      current += ch;
      bytes += size;
    }
  }
  out.push(current);
  return out.join(CRLF + " ");
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 20261020T010000Z */
export function formatUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** 20261020 — the campus calendar date. */
export function formatDate(d: Date): string {
  const p = campusParts(d);
  return `${p.y}${pad(p.m)}${pad(p.d)}`;
}

/** The day after a campus date, for exclusive all-day DTEND. */
function nextDate(d: Date): string {
  const p = campusParts(d);
  const u = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return `${u.getUTCFullYear()}${pad(u.getUTCMonth() + 1)}${pad(u.getUTCDate())}`;
}

function prop(name: string, value: string) {
  return foldLine(`${name}:${value}`);
}

export function buildVEvent(e: IcsEvent, now: Date = new Date()): string[] {
  const lines = ["BEGIN:VEVENT", prop("UID", e.uid), prop("DTSTAMP", formatUtc(e.updatedAt ?? now))];
  if (e.allDay) {
    lines.push(prop("DTSTART;VALUE=DATE", formatDate(e.start)));
    // All-day ends are exclusive: an event on the 20th ends on the 21st.
    const lastDay = new Date(Math.max(e.start.getTime(), e.end.getTime() - 1));
    lines.push(prop("DTEND;VALUE=DATE", nextDate(lastDay)));
  } else {
    lines.push(prop("DTSTART", formatUtc(e.start)));
    lines.push(prop("DTEND", formatUtc(e.end > e.start ? e.end : new Date(e.start.getTime() + 3_600_000))));
  }
  lines.push(prop("SUMMARY", escapeText(e.summary)));
  if (e.description) lines.push(prop("DESCRIPTION", escapeText(e.description)));
  if (e.location) lines.push(prop("LOCATION", escapeText(e.location)));
  if (e.geo) lines.push(prop("GEO", `${e.geo.lat.toFixed(6)};${e.geo.lng.toFixed(6)}`));
  if (e.url) lines.push(prop("URL", e.url));
  if (e.categories?.length) lines.push(prop("CATEGORIES", e.categories.map(escapeText).join(",")));
  lines.push(prop("STATUS", e.status ?? "CONFIRMED"));
  lines.push(prop("SEQUENCE", String(e.sequence ?? 0)));
  if (e.updatedAt) lines.push(prop("LAST-MODIFIED", formatUtc(e.updatedAt)));
  lines.push("TRANSP:OPAQUE", "END:VEVENT");
  return lines;
}


export function buildCalendar(cal: IcsCalendar, now: Date = new Date()): string {
  const refresh = Math.max(15, cal.refreshMinutes ?? 60);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    prop("PRODID", PRODID),
    "CALSCALE:GREGORIAN",
    `METHOD:${cal.method ?? "PUBLISH"}`,
    prop("X-WR-CALNAME", escapeText(cal.name)),
    prop("NAME", escapeText(cal.name)),
    prop("X-WR-TIMEZONE", TZ),
  ];
  if (cal.description) {
    lines.push(prop("X-WR-CALDESC", escapeText(cal.description)));
    lines.push(prop("DESCRIPTION", escapeText(cal.description)));
  }
  lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${refresh}M`, `X-PUBLISHED-TTL:PT${refresh}M`);
  for (const e of cal.events) lines.push(...buildVEvent(e, now));
  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}

/** Response for a feed or download. `download` adds a filename so browsers save it. */
export function icsResponse(body: string, opts: { filename?: string; download?: boolean; cacheSeconds?: number } = {}) {
  const filename = (opts.filename ?? "calendar.ics").replace(/[^\w.-]+/g, "-");
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `${opts.download ? "attachment" : "inline"}; filename="${filename}"`,
      "cache-control": `private, max-age=${opts.cacheSeconds ?? 300}`,
      "x-content-type-options": "nosniff",
    },
  });
}
