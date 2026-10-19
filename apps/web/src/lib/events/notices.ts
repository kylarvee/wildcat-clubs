import type { LocationType, Recurrence, Visibility } from "@prisma/client";
import { shortLocationText } from "@/lib/events/labels";
import { joinWords } from "@/lib/events/summary";
import { campusParts } from "@/lib/events/wallclock";
import { fmtDate } from "@/lib/time";

/**
 * What people hear when an event they follow changes. Pure: lib/domain/
 * event-notices sends these, and the reminders job (lib/jobs/reminders) uses
 * the same audience rule.
 *
 * Who (eventAudience): everyone following the calendar of the host club or an
 * approved co-host. Joining a club follows its calendar, so members hear about
 * its events until they unfollow; a members-only event reaches only those
 * clubs' members and leaders (the lib/authz/events rule). University trainings
 * reach the people whose WSUSA requirement asks them to attend.
 *
 * What: a date (or every upcoming date) cancelled or back on, new times, a new
 * room, place or meeting link, a new end time. Only changes that touch a date
 * in the next 14 days are sent, and a change to a whole repeating series is
 * one summary ("Weekly Build Night moves to Thursdays at 6 PM, starting Oct
 * 22"), never a notice per date. In-app and push; a cancelled date in the next
 * 48 hours is emailed too.
 */

export const NOTICE_WINDOW_DAYS = 14;
export const CANCEL_EMAIL_HOURS = 48;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type EventNoticeKind = "event.changed" | "event.cancelled";

export type EventNotice = {
  kind: EventNoticeKind;
  title: string;
  body: string;
  /** Email as well as in-app and push: only a cancelled date in the next 48 hours. */
  email: boolean;
  /** The date the notice is about (the first one when it covers several), for the link. */
  occurrenceId: string;
};

/** Where a date meets. `text` is what people read ("NB 220", "2555 Harrison Blvd", "Online"); null when not set. */
export type Place = { kind: LocationType; text: string | null; link: string | null };

export type NoticeDate = { id: string; startsAt: Date; endsAt: Date; place: Place };

export type RepeatRule = { recurrence: Recurrence; interval: number; weekdays: number[] };

/** One side of an edit: the upcoming scheduled dates with their places, the repeat rule (null = one-time) and the usual place. */
export type Snapshot = { dates: NoticeDate[]; repeat: RepeatRule | null; place: Place };

/** The event's title and who runs it (the host club, or WSUSA for university events). */
export type NoticeEvent = { title: string; host: string };

type LocationFields = {
  locationType: LocationType;
  building?: { name: string; code?: string | null } | null;
  room?: string | null;
  address?: string | null;
  virtualUrl?: string | null;
};

/** A date's place: the event's location, with that date's own room if it has one. */
export function placeOf(e: LocationFields, roomOverride?: string | null): Place {
  switch (e.locationType) {
    case "CAMPUS":
      return { kind: "CAMPUS", text: shortLocationText({ ...e, roomOverride }), link: null };
    case "ADDRESS":
      return { kind: "ADDRESS", text: e.address?.trim() || null, link: null };
    case "VIRTUAL":
      return { kind: "VIRTUAL", text: "Online", link: e.virtualUrl?.trim() || null };
    default:
      return { kind: "TBD", text: null, link: null };
  }
}

/** Same place for the people going? A new meeting link counts as a change; a first link (a Meet link being made) doesn't. */
export function samePlace(a: Place, b: Place): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "VIRTUAL") return !a.link || !b.link || a.link === b.link;
  return (a.text ?? "") === (b.text ?? "");
}

/** Does this date fall in the next 14 days (from now on)? */
export function inNoticeWindow(at: Date, now: Date): boolean {
  const t = at.getTime();
  return t >= now.getTime() && t <= now.getTime() + NOTICE_WINDOW_DAYS * DAY;
}

const startsWithin = (at: Date, now: Date, hours: number) => at.getTime() >= now.getTime() && at.getTime() <= now.getTime() + hours * HOUR;

// ─── Words ───────────────────────────────────────────────────────────────────

/** "6 PM", "6:30 PM" (campus time). */
export function shortTime(at: Date): string {
  return fmtDate(at, campusParts(at).M === 0 ? "h a" : "h:mm a");
}

const day = (at: Date) => fmtDate(at, "EEE, MMM d");
const monthDay = (at: Date) => fmtDate(at, "MMM d");
const byStart = (a: NoticeDate, b: NoticeDate) => a.startsAt.getTime() - b.startsAt.getTime();
const sortDates = (ds: NoticeDate[]) => [...ds].sort(byStart);

const PLURAL_DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Repeats that read as a pattern ("Thursdays at 6 PM"). Semesterly and yearly ones read as their dates. */
export function isPatterned(r: RepeatRule | null): r is RepeatRule {
  return r !== null && (r.recurrence === "WEEKLY" || r.recurrence === "DAILY" || r.recurrence === "MONTHLY");
}

/**
 * The repeat pattern at the time of one of its dates: "Thursdays at 6 PM",
 * "Tuesdays and Thursdays at 6:30 PM", "every other Monday at 7 PM", "every
 * day at 7 AM", "the 22nd of each month at 6 PM".
 */
export function repeatPhrase(r: RepeatRule, at: Date): string {
  const time = shortTime(at);
  const n = Math.max(1, r.interval);
  const p = campusParts(at);
  switch (r.recurrence) {
    case "DAILY":
      return n === 1 ? `every day at ${time}` : `every ${n} days at ${time}`;
    case "WEEKLY": {
      const days = (r.weekdays.length ? [...new Set(r.weekdays)] : [p.dow]).filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
      if (n === 1) return `${joinWords(days.map((d) => PLURAL_DAYS[d]))} at ${time}`;
      if (n === 2) return `every other ${joinWords(days.map((d) => DAYS[d]))} at ${time}`;
      return `every ${n} weeks on ${joinWords(days.map((d) => PLURAL_DAYS[d]))} at ${time}`;
    }
    case "MONTHLY":
      return `the ${ordinal(p.d)} of ${n === 1 ? "each month" : `every ${n} months`} at ${time}`;
    default:
      return `${day(at)} at ${time}`;
  }
}

const SERIES_WORD: Partial<Record<Recurrence, string>> = { WEEKLY: "Weekly", DAILY: "Daily", MONTHLY: "Monthly" };

/** How a whole series is named: "Weekly Build Night" (unless the title already says so). */
export function seriesName(title: string, r: RepeatRule | null): string {
  const word = r && r.interval === 1 ? SERIES_WORD[r.recurrence] : undefined;
  return word && !title.toLowerCase().startsWith(word.toLowerCase()) ? `${word} ${title}` : title;
}

/** "in NB 220", "at 2555 Harrison Blvd", "online"; null when the place isn't set. */
function wherePhrase(p: Place): string | null {
  switch (p.kind) {
    case "CAMPUS":
      return p.text ? `in ${p.text}` : "on campus";
    case "ADDRESS":
      return p.text ? `at ${p.text}` : "off campus";
    case "VIRTUAL":
      return "online";
    default:
      return null;
  }
}

/** After "moves": "to NB 220", "to 2555 Harrison Blvd", "online". */
function movesTo(p: Place): string {
  switch (p.kind) {
    case "CAMPUS":
      return p.text ? `to ${p.text}` : "to campus";
    case "ADDRESS":
      return p.text ? `to ${p.text}` : "off campus";
    default:
      return "online";
  }
}

/** "Oct 20 and Oct 27", "Oct 20, Oct 21, Oct 22 and 2 more". */
function dateList(dates: NoticeDate[]) {
  const shown = dates.slice(0, 3).map((d) => monthDay(d.startsAt));
  return dates.length > 3 ? `${shown.join(", ")} and ${dates.length - 3} more` : joinWords(shown);
}

/** "at 9 PM", or "Sat, Oct 24 at 2 AM" when it ends on a later day. */
function endsPhrase(d: NoticeDate) {
  const s = campusParts(d.startsAt);
  const e = campusParts(d.endsAt);
  const sameDay = s.y === e.y && s.m === e.m && s.d === e.d;
  return sameDay ? `at ${shortTime(d.endsAt)}` : `${day(d.endsAt)} at ${shortTime(d.endsAt)}`;
}

const sentence = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

// ─── Notices ─────────────────────────────────────────────────────────────────

/**
 * Dates taken off the calendar: one date, every upcoming date (`whole`), or
 * dates an edit dropped (`remaining` dates stay). `deleted`: the event itself
 * was deleted. Null when no such date is in the next 14 days.
 */
export function cancelledNotice(
  e: NoticeEvent,
  o: { dates: NoticeDate[]; repeat: RepeatRule | null; whole: boolean; remaining?: number; note?: string | null; deleted?: boolean; now: Date },
): EventNotice | null {
  const all = sortDates(o.dates);
  const soon = all.filter((d) => inNoticeWindow(d.startsAt, o.now));
  if (!soon.length) return null;
  const first = soon[0];
  const series = o.whole && isPatterned(o.repeat) && all.length > 1;
  const partial = !o.whole && (o.remaining ?? 0) > 0;
  const title = series
    ? `${seriesName(e.title, o.repeat)} is cancelled from ${monthDay(first.startsAt)} on`
    : soon.length === 1
      ? `${e.title} on ${day(first.startsAt)} is cancelled`
      : `${e.title} is cancelled on ${dateList(soon)}`;
  const what = !partial ? (all.length > 1 ? "every upcoming date" : "it") : soon.length === 1 ? "this date" : "these dates";
  const note = o.note?.trim();
  const did = o.deleted ? `${e.host} took ${what} off the calendar.` : note ? `${e.host} cancelled ${what}: ${sentence(note)}` : `${e.host} cancelled ${what}.`;
  return {
    kind: "event.cancelled",
    title,
    body: partial ? `${did} The rest of the schedule stays the same.` : did,
    email: soon.some((d) => startsWithin(d.startsAt, o.now, CANCEL_EMAIL_HOURS)),
    occurrenceId: first.id,
  };
}

/** Cancelled dates back on the calendar (one, or every upcoming one with `whole`). Null when none is in the next 14 days. */
export function restoredNotice(e: NoticeEvent, o: { dates: NoticeDate[]; repeat: RepeatRule | null; whole: boolean; now: Date }): EventNotice | null {
  const all = sortDates(o.dates);
  const soon = all.filter((d) => inNoticeWindow(d.startsAt, o.now));
  if (!soon.length) return null;
  const first = soon[0];
  const series = o.whole && isPatterned(o.repeat) && all.length > 1;
  const title = series
    ? `${seriesName(e.title, o.repeat)} is back on, starting ${monthDay(first.startsAt)}`
    : soon.length === 1
      ? `${e.title} on ${day(first.startsAt)} is back on`
      : `${e.title} is back on for ${dateList(soon)}`;
  return { kind: "event.changed", title, body: `${e.host} put it back on the calendar.`, email: false, occurrenceId: first.id };
}

/** One date's own room changed, or went back to the usual one. Null outside the next 14 days or when nothing changed. */
export function roomNotice(e: NoticeEvent, o: { date: NoticeDate; before: Place; usual: Place; now: Date }): EventNotice | null {
  if (!inNoticeWindow(o.date.startsAt, o.now) || samePlace(o.before, o.date.place)) return null;
  const subject = `${e.title} on ${day(o.date.startsAt)}`;
  const back = samePlace(o.date.place, o.usual);
  const title = back ? `${subject} is back ${wherePhrase(o.usual) ?? "in its usual place"}` : `${subject} moves ${movesTo(o.date.place)}`;
  const was = wherePhrase(o.before);
  return { kind: "event.changed", title, body: `${e.host}: same time, ${shortTime(o.date.startsAt)}${was ? `; it was ${was}` : ""}.`, email: false, occurrenceId: o.date.id };
}

/**
 * What a save in the Events Builder changed for the next 14 days, as one
 * notice, most important first: new times ("moves to"), dates dropped, a new
 * place or meeting link, a new end time. Null when nothing people planned
 * around in the next 14 days changed (new dates on their own aren't news).
 */
export function editNotice(e: NoticeEvent, before: Snapshot, after: Snapshot, now: Date): EventNotice | null {
  const at = (d: NoticeDate) => d.startsAt.getTime();
  const beforeAt = new Map(before.dates.map((d) => [at(d), d]));
  const afterAt = new Map(after.dates.map((d) => [at(d), d]));
  const removed = sortDates(before.dates.filter((d) => !afterAt.has(at(d))));
  const added = sortDates(after.dates.filter((d) => !beforeAt.has(at(d))));
  const kept = sortDates(after.dates.filter((d) => beforeAt.has(at(d))));
  const soon = (ds: NoticeDate[]) => ds.filter((d) => inNoticeWindow(d.startsAt, now));
  // A whole series reads as its pattern; a one-time event (or a semesterly one) as its date.
  const rule = isPatterned(after.repeat) && after.dates.length > 1 ? after.repeat : null;

  // New times: dates left the calendar and others took their place.
  if (removed.length && added.length && (soon(removed).length || soon(added).length)) {
    const to = added[0];
    const from = removed[0];
    const placeMoved = !samePlace(before.place, after.place);
    const newWhere = placeMoved ? wherePhrase(after.place) : null;
    const oldWhere = placeMoved ? wherePhrase(before.place) : null;
    const oldRule = isPatterned(before.repeat) && before.dates.length > 1 ? before.repeat : null;
    const was = oldRule ? repeatPhrase(oldRule, from.startsAt) : `${day(from.startsAt)} at ${shortTime(from.startsAt)}`;
    const title = rule
      ? `${seriesName(e.title, rule)} moves to ${repeatPhrase(rule, to.startsAt)}${newWhere ? ` ${newWhere}` : ""}, starting ${monthDay(to.startsAt)}`
      : `${e.title} moves to ${day(to.startsAt)} at ${shortTime(to.startsAt)}${newWhere ? ` ${newWhere}` : ""}`;
    return { kind: "event.changed", title, body: `${e.host}: it was ${was}${oldWhere ? ` ${oldWhere}` : ""}.`, email: false, occurrenceId: to.id };
  }

  // Dates dropped (the series ends sooner or starts later).
  if (removed.length && !added.length && soon(removed).length) {
    return cancelledNotice(e, { dates: removed, repeat: before.repeat, whole: false, remaining: after.dates.length, now });
  }

  const subjectFor = (d: NoticeDate) => (rule ? seriesName(e.title, rule) : `${e.title} on ${day(d.startsAt)}`);
  const starting = (d: NoticeDate) => (rule ? `, starting ${monthDay(d.startsAt)}` : "");

  // Same times, somewhere else (dates with their own room keep it).
  const placed = soon(kept).filter((d) => !samePlace(beforeAt.get(at(d))!.place, d.place));
  if (placed.length) {
    const first = placed[0];
    const was = beforeAt.get(at(first))!.place;
    const newLink = was.kind === "VIRTUAL" && first.place.kind === "VIRTUAL";
    const title = newLink
      ? `${subjectFor(first)} has a new meeting link${starting(first)}`
      : first.place.kind === "TBD"
        ? `${subjectFor(first)}: place to be decided${starting(first)}`
        : `${subjectFor(first)} moves ${movesTo(first.place)}${starting(first)}`;
    const wasWhere = wherePhrase(was);
    const body = newLink
      ? `${e.host}: same time. Join from the new link on the event page.`
      : `${e.host}: same time${rule ? "" : `, ${shortTime(first.startsAt)}`}${wasWhere ? `; it was ${wasWhere}` : ""}.`;
    return { kind: "event.changed", title, body, email: false, occurrenceId: first.id };
  }

  // Same start, new end.
  const ended = soon(kept).filter((d) => beforeAt.get(at(d))!.endsAt.getTime() !== d.endsAt.getTime());
  if (ended.length) {
    const first = ended[0];
    const was = beforeAt.get(at(first))!;
    return {
      kind: "event.changed",
      title: `${subjectFor(first)} now ends ${endsPhrase(first)}${starting(first)}`,
      body: `${e.host}: same start; it used to end ${endsPhrase(was)}.`,
      email: false,
      occurrenceId: first.id,
    };
  }
  return null;
}

// ─── Audience ────────────────────────────────────────────────────────────────

/**
 * Who hears about an event: its followers (the host's and approved co-hosts'
 * calendars, or for a university training the people it's required of),
 * limited to members and leaders for a members-only event, minus `excludeIds`
 * (whoever made the change, people already told another way, people already
 * checked in). Each person once, in the order given.
 */
export function eventAudience(a: { visibility: Visibility; followerIds: Iterable<string>; memberIds?: Iterable<string>; excludeIds?: Iterable<string> }): string[] {
  const members = a.visibility === "MEMBERS" ? new Set(a.memberIds ?? []) : null;
  const skip = new Set(a.excludeIds ?? []);
  const out: string[] = [];
  for (const id of a.followerIds) {
    if (!id || skip.has(id) || (members && !members.has(id))) continue;
    skip.add(id);
    out.push(id);
  }
  return out;
}
