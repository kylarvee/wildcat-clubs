import type { ClubCategory, EventKind } from "@prisma/client";
import { CLUB_CATEGORIES } from "@/lib/labels/clubs";
import { EVENT_KINDS } from "@/lib/events/labels";
import { addDaysToDateInput, campusParts, fromInputs, toDateInput } from "@/lib/events/wallclock";
import { INSTITUTION } from "@/lib/institution";
import { DAY_MS, fmtDate } from "@/lib/time";

/**
 * The Events page lives in the URL (/events?when=weekend&food=1…), so every
 * view is a link someone can share or bookmark. The page, its filter bar and
 * the month view's feed (GET /api/calendar) all parse it here. Pure and
 * client-safe; every date is a campus date (lib/time).
 */

export const EVENT_SCOPES = ["mine", "all"] as const;
export type EventScope = (typeof EVENT_SCOPES)[number];
export const SCOPE_LABEL: Record<EventScope, string> = { mine: "Mine", all: `All of ${INSTITUTION.shortName}` };

export const EVENT_VIEWS = ["list", "month"] as const;
export type EventView = (typeof EVENT_VIEWS)[number];
export const EVENT_VIEW_LABEL: Record<EventView, string> = { list: "List", month: "Month" };

export const DATE_SHORTCUTS = ["today", "tomorrow", "weekend", "week"] as const;
export type DateShortcut = (typeof DATE_SHORTCUTS)[number];
export const DATE_SHORTCUT_LABEL: Record<DateShortcut, string> = { today: "Today", tomorrow: "Tomorrow", weekend: "This weekend", week: "Next 7 days" };

/** Cards per step of "Show more". */
export const LIST_STEP = 30;
const MAX_SHOW = 600;
/** How far ahead "everything coming up" reaches. */
export const UPCOMING_DAYS = 400;

export type EventBrowseParams = {
  /** Null: the viewer's default (Mine when signed in and following clubs, else All). */
  scope: EventScope | null;
  view: EventView;
  when: DateShortcut | null;
  /** A campus date from the date picker ("2026-10-24"); a date replaces the shortcut. */
  date: string | null;
  q: string;
  type: EventKind | null;
  /** The host club's category. */
  category: ClubCategory | null;
  food: boolean;
  stuff: boolean;
  /** Counts toward service hours. */
  service: boolean;
  /** Online or hybrid. */
  online: boolean;
  /** Hosted or co-hosted by clubs the viewer follows. */
  following: boolean;
  /** How many cards the list shows. */
  show: number;
};

type Raw = Record<string, string | string[] | undefined> | URLSearchParams;

function get(raw: Raw, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

function oneOf<T extends string>(value: string | undefined, options: readonly T[]): T | null {
  return value && (options as readonly string[]).includes(value) ? (value as T) : null;
}

/** "2026-10-24" when it's a real calendar date, else null. */
export function validDate(value: string | null | undefined): string | null {
  if (!value || !/^(19|20)\d\d-\d\d-\d\d$/.test(value)) return null;
  const d = fromInputs(value);
  return d && toDateInput(d) === value ? value : null;
}

export function parseEventParams(raw: Raw): EventBrowseParams {
  const date = validDate(get(raw, "date"));
  const shown = Number(get(raw, "show"));
  const flag = (key: string) => get(raw, key) === "1";
  return {
    scope: oneOf(get(raw, "scope"), EVENT_SCOPES),
    view: oneOf(get(raw, "view"), EVENT_VIEWS) ?? "list",
    when: date ? null : oneOf(get(raw, "when"), DATE_SHORTCUTS),
    date,
    q: (get(raw, "q") ?? "").trim().slice(0, 100),
    type: oneOf(get(raw, "type"), EVENT_KINDS),
    category: oneOf(get(raw, "category"), CLUB_CATEGORIES),
    food: flag("food"),
    stuff: flag("stuff"),
    service: flag("service"),
    online: flag("online"),
    following: flag("following"),
    show: Number.isFinite(shown) && shown > LIST_STEP ? Math.min(Math.ceil(shown / LIST_STEP) * LIST_STEP, MAX_SHOW) : LIST_STEP,
  };
}

export type EventFilters = Pick<EventBrowseParams, "q" | "type" | "category" | "food" | "stuff" | "service" | "online" | "following">;

/** The filters (not dates, view or paging) as query parameters: the month view's feed takes the same ones. */
export function filterSearchParams(p: EventFilters, into = new URLSearchParams()): URLSearchParams {
  if (p.q) into.set("q", p.q);
  if (p.type) into.set("type", p.type);
  if (p.category) into.set("category", p.category);
  for (const key of ["food", "stuff", "service", "online", "following"] as const) if (p[key]) into.set(key, "1");
  return into;
}

/** An /events link, defaults left out. A new date clears the shortcut (and back), and any change starts the list over. */
export function eventsHref(p: EventBrowseParams, patch: Partial<EventBrowseParams> = {}): string {
  const n = { ...p, ...patch };
  if (patch.date) n.when = null;
  if (patch.when) n.date = null;
  if (patch.show === undefined && Object.keys(patch).length) n.show = LIST_STEP;
  const s = new URLSearchParams();
  if (n.scope) s.set("scope", n.scope);
  if (n.view !== "list") s.set("view", n.view);
  if (n.date) s.set("date", n.date);
  else if (n.when) s.set("when", n.when);
  filterSearchParams(n, s);
  if (n.show > LIST_STEP) s.set("show", String(n.show));
  const qs = s.toString();
  return qs ? `/events?${qs}` : "/events";
}

/** Everything "Clear all" resets (scope and view stay). */
export const CLEARED: Partial<EventBrowseParams> = { when: null, date: null, q: "", type: null, category: null, food: false, stuff: false, service: false, online: false, following: false };

export function hasFilters(p: EventBrowseParams) {
  return Boolean(p.when || p.date || p.q || p.type || p.category || p.food || p.stuff || p.service || p.online || p.following);
}

// ─── Scope ───────────────────────────────────────────────────────────────────

/** Mine when you're signed in and follow a club; otherwise All of Weber State. Signed out it's always All. */
export function resolveScope(p: Pick<EventBrowseParams, "scope">, viewer: { signedIn: boolean; followsClubs: boolean }): EventScope {
  if (!viewer.signedIn) return "all";
  return p.scope ?? (viewer.followsClubs ? "mine" : "all");
}

// ─── Dates (campus time) ─────────────────────────────────────────────────────

export type DateRange = { start: Date; end: Date };

const midnight = (date: string) => fromInputs(date, "00:00")!;

/**
 * Today, Tomorrow, Next 7 days (today and the six days after), and This
 * weekend: Friday 5 PM through Sunday, the coming one or the one under way.
 */
export function shortcutRange(when: DateShortcut, now: Date): DateRange {
  const today = toDateInput(now);
  switch (when) {
    case "today":
      return { start: midnight(today), end: midnight(addDaysToDateInput(today, 1)) };
    case "tomorrow":
      return { start: midnight(addDaysToDateInput(today, 1)), end: midnight(addDaysToDateInput(today, 2)) };
    case "week":
      return { start: midnight(today), end: midnight(addDaysToDateInput(today, 7)) };
    case "weekend": {
      const dow = campusParts(now).dow;
      const friday = addDaysToDateInput(today, dow === 6 ? -1 : dow === 0 ? -2 : 5 - dow);
      return { start: fromInputs(friday, "17:00")!, end: midnight(addDaysToDateInput(friday, 3)) };
    }
  }
}

export function dayRange(date: string): DateRange {
  return { start: midnight(date), end: midnight(addDaysToDateInput(date, 1)) };
}

/** The dates the filters ask for; null means everything coming up. */
export function dateRange(p: Pick<EventBrowseParams, "when" | "date">, now: Date): DateRange | null {
  if (p.date) return dayRange(p.date);
  if (p.when) return shortcutRange(p.when, now);
  return null;
}

/**
 * The stretch the list shows (occurrences overlapping it). What already ended
 * drops off, so "Today" at 3 PM starts with what's on now; a day that's all
 * in the past (picked from the date picker) shows everything it had.
 */
export function listWindow(range: DateRange | null, now: Date): DateRange {
  if (!range) return { start: now, end: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS) };
  if (range.end <= now) return range;
  return { start: range.start > now ? range.start : now, end: range.end };
}

const sameYear = (d: Date, now: Date) => campusParts(d).y === campusParts(now).y;
const dayText = (d: Date, now: Date, weekday = "EEE") => fmtDate(d, sameYear(d, now) ? `${weekday}, MMM d` : `${weekday}, MMM d, yyyy`);

/** "Today · Tue, Oct 20", "This weekend · Fri, Oct 23 – Sun, Oct 25", "Sat, Oct 24". Null without a date filter. */
export function rangeLabel(p: Pick<EventBrowseParams, "when" | "date">, now: Date): string | null {
  const r = dateRange(p, now);
  if (!r) return null;
  const last = new Date(r.end.getTime() - 1);
  const span = toDateInput(r.start) === toDateInput(last) ? dayText(r.start, now) : `${dayText(r.start, now)} – ${dayText(last, now)}`;
  return p.date || !p.when ? span : `${DATE_SHORTCUT_LABEL[p.when]} · ${span}`;
}

/** A day heading in the list: "Today", "Tomorrow", "Friday, Oct 23". */
export function dayHeading(dayKey: string, now: Date): string {
  const today = toDateInput(now);
  if (dayKey === today) return "Today";
  if (dayKey === addDaysToDateInput(today, 1)) return "Tomorrow";
  return dayText(midnight(dayKey), now, "EEEE");
}
