import { format } from "date-fns";
import { inCampusTime } from "@/lib/time";

/**
 * Pure messaging rules and helpers, safe on the client and the server. The
 * domain (lib/domain/messaging) validates with the same limits the composer
 * shows, so the two can't disagree.
 */

export const MESSAGE_MAX_LENGTH = 4000;
export const GROUP_TITLE_MAX_LENGTH = 80;
export const GROUP_MAX_MEMBERS = 100;
/** Messages per page in a thread (first load and each "load earlier"). */
export const MESSAGE_PAGE_SIZE = 40;
/** Messages from one person less than this far apart share one header. */
export const GROUP_GAP_MS = 5 * 60_000;

/** Line endings unified, outer blank space trimmed, runs of blank lines capped at one. */
export function normalizeMessageBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Why a message can't be sent as typed, or null when it's fine. */
export function messageBodyProblem(body: string): string | null {
  if (!body) return "Write a message first.";
  if (body.length > MESSAGE_MAX_LENGTH) return `Messages can be up to ${MESSAGE_MAX_LENGTH.toLocaleString("en-US")} characters. This one has ${body.length.toLocaleString("en-US")}.`;
  return null;
}

// ─── Links ────────────────────────────────────────────────────────────────────

export type TextPart = { type: "text"; text: string } | { type: "link"; text: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
/** Punctuation that usually ends a sentence rather than a URL. */
const TRAILING = /[.,!?;:'"’”)\]}]+$/;

/** Splits plain text into text and link parts. Only http(s) and www. links are linked. */
export function linkifyParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0];
    const start = m.index ?? 0;
    // Keep a closing parenthesis that belongs to the URL, e.g. Wikipedia links.
    let trail = raw.match(TRAILING)?.[0] ?? "";
    if (trail.startsWith(")") && (raw.match(/\(/g)?.length ?? 0) > (raw.slice(0, raw.length - trail.length).match(/\)/g)?.length ?? 0)) trail = trail.slice(1);
    if (trail) raw = raw.slice(0, raw.length - trail.length);
    if (raw.length < 5) continue;
    const href = raw.toLowerCase().startsWith("www.") ? `https://${raw}` : raw;
    try {
      const u = new URL(href);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    } catch {
      continue;
    }
    if (start > last) parts.push({ type: "text", text: text.slice(last, start) });
    parts.push({ type: "link", text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

// ─── Grouping for the thread ─────────────────────────────────────────────────

export type GroupableMessage = { id: string; authorId: string; createdAt: string };

export type SenderGroup<M extends GroupableMessage> = { key: string; authorId: string; startedAt: string; messages: M[] };
export type DayGroup<M extends GroupableMessage> = { day: string; startedAt: string; groups: SenderGroup<M>[] };

/** Campus-time calendar day, e.g. "2026-10-16". */
export function campusDayKey(iso: string | Date): string {
  return format(inCampusTime(iso), "yyyy-MM-dd");
}

/**
 * Groups messages (oldest first) by campus day, then by sender: a new header
 * starts when the author changes or there's a gap of 5 minutes or more.
 */
export function groupMessages<M extends GroupableMessage>(messages: M[]): DayGroup<M>[] {
  const days: DayGroup<M>[] = [];
  for (const m of messages) {
    const day = campusDayKey(m.createdAt);
    let d = days.at(-1);
    if (!d || d.day !== day) {
      d = { day, startedAt: m.createdAt, groups: [] };
      days.push(d);
    }
    const g = d.groups.at(-1);
    const prev = g?.messages.at(-1);
    if (g && prev && g.authorId === m.authorId && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_GAP_MS) {
      g.messages.push(m);
    } else {
      d.groups.push({ key: m.id, authorId: m.authorId, startedAt: m.createdAt, messages: [m] });
    }
  }
  return days;
}

/** "Today", "Yesterday", "Monday, October 12" or "October 12, 2025" — campus time. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const key = campusDayKey(iso);
  if (key === campusDayKey(now)) return "Today";
  if (key === campusDayKey(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  const d = inCampusTime(iso);
  const sameYear = format(d, "yyyy") === format(inCampusTime(now), "yyyy");
  return format(d, sameYear ? "EEEE, MMMM d" : "MMMM d, yyyy");
}

/** Short time for message headers, e.g. "6:42 PM". */
export function timeLabel(iso: string): string {
  return format(inCampusTime(iso), "h:mm a");
}

/** Full date and time for tooltips and screen readers. */
export function fullTimeLabel(iso: string): string {
  return format(inCampusTime(iso), "EEEE, MMMM d, yyyy 'at' h:mm a");
}

/** Compact stamp for the conversation list: time today, weekday this week, else a date. */
export function listStamp(iso: string, now: Date = new Date()): string {
  const key = campusDayKey(iso);
  if (key === campusDayKey(now)) return timeLabel(iso);
  if (key === campusDayKey(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  const age = now.getTime() - Date.parse(iso);
  const d = inCampusTime(iso);
  if (age < 6 * 86_400_000) return format(d, "EEE");
  return format(d, format(d, "yyyy") === format(inCampusTime(now), "yyyy") ? "MMM d" : "M/d/yy");
}

/** One-line preview of a message body for lists and notifications. */
export function previewText(body: string, max = 120): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** First name for compact previews ("Priya: see you there"). */
export function firstName(name: string): string {
  const parts = name.trim().split(/\s+/);
  // Titles read oddly alone ("Dr.: …"), so keep them with the surname.
  if (parts.length > 1 && /^(dr|prof|mr|mrs|ms|mx)\.?$/i.test(parts[0])) return `${parts[0]} ${parts.at(-1)}`;
  return parts[0] || name;
}
