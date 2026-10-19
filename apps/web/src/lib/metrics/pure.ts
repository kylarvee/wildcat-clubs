import { TZDate } from "@date-fns/tz";
import { DAY_MS, TZ, campusDate, fmtLongDate } from "@/lib/time";
import { STANDING_LABEL } from "@/lib/labels/clubs";
import type { ClubActivity, NetworkEdge, RetentionPeriod, RetentionPoint, RetentionSummary } from "./types";

/**
 * The metric rules as plain functions — no database, no server imports — so
 * every definition in the metrics doc comment is unit-tested here and the
 * queries in index.ts only gather the facts these functions decide on.
 */

// ─── Shared inputs ───────────────────────────────────────────────────────────

/** The parts of a Term the rules need (a Prisma Term satisfies it). */
export type TermLike = { name: string; academicYear: string; startsOn: Date; endsOn: Date; countsForActivity: boolean };

export type ActivityRule = { windowDays: number; recentEvents: number };
export type ClubRule = { minEvents: number; minMembers: number };

function sortTerms<T extends TermLike>(terms: T[]): T[] {
  return [...terms].sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());
}

/** Local calendar parts of an instant, in campus time. */
function campusParts(d: Date) {
  const t = new TZDate(d, TZ);
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), isMidnight: t.getHours() === 0 && t.getMinutes() === 0 && t.getSeconds() === 0 && t.getMilliseconds() === 0 };
}

/** Campus midnight starting the day after (y, m, d). Plain UTC math for the calendar step, so month ends roll over. */
function nextCampusMidnight(y: number, m: number, d: number): Date {
  const u = new Date(Date.UTC(y, m - 1, d + 1));
  return campusDate(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate());
}

/**
 * Last instant of a term. Term end dates are calendar days, so an end stored
 * at campus midnight covers that whole day (finals-day events still count).
 */
export function termEnd(t: Pick<TermLike, "endsOn">): Date {
  const p = campusParts(t.endsOn);
  return p.isMidnight ? new Date(nextCampusMidnight(p.y, p.m, p.d).getTime() - 1) : t.endsOn;
}

// ─── Active student ──────────────────────────────────────────────────────────

/** Someone's attendance in one club, reduced to the two facts the active rule needs. */
export type Standing = {
  /** Start of the latest held club event they attended (at or before `at`). */
  lastAttendedAt: Date | null;
  /** Where their latest attended event sits among the club's held events, newest = 1. */
  latestRank: number | null;
};

/**
 * ACTIVE STUDENT: attended within the last `windowDays`, or attended one of the
 * club's last `recentEvents` held events. Put another way, a student stays
 * active until whichever comes later: `windowDays` after their last check-in,
 * or the moment that event drops out of the club's last N held events. So a
 * club that meets every other month doesn't lose its regulars between
 * meetings, and a weekly club still counts someone who missed two weeks.
 */
export function isActiveStudent(s: Standing, at: Date, rule: ActivityRule): boolean {
  const recent = s.latestRank !== null && s.latestRank >= 1 && s.latestRank <= rule.recentEvents;
  if (recent) return true;
  if (!s.lastAttendedAt) return false;
  const t = s.lastAttendedAt.getTime();
  return t <= at.getTime() && t >= at.getTime() - rule.windowDays * DAY_MS;
}

/**
 * Builds a Standing from a club's held events and the ids of the ones a person
 * attended. Ties on start time break by id, the same order the SQL uses.
 */
export function standingFromHistory(held: { id: string; startsAt: Date }[], attendedIds: Iterable<string>, at: Date): Standing {
  const attended = new Set(attendedIds);
  const ranked = held
    .filter((h) => h.startsAt.getTime() <= at.getTime())
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const idx = ranked.findIndex((h) => attended.has(h.id));
  return idx === -1 ? { lastAttendedAt: null, latestRank: null } : { lastAttendedAt: ranked[idx].startsAt, latestRank: idx + 1 };
}

// ─── Pilot period & active club ──────────────────────────────────────────────

/**
 * PILOT PERIOD end: the end of the first full activity-counting term that
 * starts after the club was created. Created mid-Fall → through Spring;
 * created mid-Spring with a non-counting Summer → through Fall.
 * Null when the academic calendar doesn't have that term yet.
 */
export function pilotPeriodEnd(createdAt: Date, terms: TermLike[]): Date | null {
  const next = sortTerms(terms).find((t) => t.countsForActivity && t.startsOn.getTime() > createdAt.getTime());
  return next ? termEnd(next) : null;
}

export type ClubActivityInput = {
  status: string;
  createdAt: Date;
  heldEventsCurrentTerm: number;
  heldEventsPreviousTerm: number;
  registeredMembers: number;
  activeMembers: number;
  at: Date;
  terms: TermLike[];
  rule: ClubRule;
  currentTermName?: string | null;
  previousTermName?: string | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * ACTIVE CLUB: approved, and either in its pilot period or (≥ minEvents held
 * events in the current term or in the previous activity term — either one
 * on its own — and ≥ minMembers registered members). A pilot club with no
 * terms after its creation on the calendar yet gets the benefit of the doubt.
 */
export function evaluateClubActivity(i: ClubActivityInput): ClubActivity {
  const base = {
    heldEventsCurrentTerm: i.heldEventsCurrentTerm,
    heldEventsPreviousTerm: i.heldEventsPreviousTerm,
    registeredMembers: i.registeredMembers,
    activeMembers: i.activeMembers,
    currentTermName: i.currentTermName ?? null,
    previousTermName: i.previousTermName ?? null,
  };

  if (i.status !== "APPROVED") {
    const why =
      i.status === "RETIRED" ? "This club has been retired." :
      i.status === "REJECTED" ? "This club wasn't approved by WSUSA." :
      "This club hasn't been approved by WSUSA yet.";
    return { ...base, active: false, inPilot: false, pilotEndsAt: null, reasons: [why] };
  }

  const pilotEndsAt = pilotPeriodEnd(i.createdAt, i.terms);
  const inPilot = pilotEndsAt === null || i.at.getTime() <= pilotEndsAt.getTime();
  if (inPilot) {
    const note = pilotEndsAt
      ? `New club: counts as active during its pilot period, through ${fmtLongDate(pilotEndsAt)}.`
      : "New club: counts as active during its pilot period, which runs through its first full term.";
    return { ...base, active: true, inPilot: true, pilotEndsAt, reasons: [note] };
  }

  const reasons: string[] = [];
  const { minEvents, minMembers } = i.rule;
  const eventsOk = i.heldEventsCurrentTerm >= minEvents || i.heldEventsPreviousTerm >= minEvents;
  if (!eventsOk) {
    const cur = i.currentTermName ? `in ${i.currentTermName}` : "this term";
    const prev = i.previousTermName ? `in ${i.previousTermName}` : "last term";
    const need = `needs ${minEvents} in one term`;
    reasons.push(
      i.heldEventsCurrentTerm === 0 && i.heldEventsPreviousTerm === 0
        ? `No events with check-ins ${cur} or ${prev} (${need}).`
        : `Only ${plural(i.heldEventsCurrentTerm, "event")} with check-ins ${cur} and ${i.heldEventsPreviousTerm} ${prev} (${need}).`,
    );
  }
  const membersOk = i.registeredMembers >= minMembers;
  if (!membersOk) {
    reasons.push(
      i.registeredMembers === 0
        ? `No registered members yet (needs ${minMembers}).`
        : `Only ${plural(i.registeredMembers, "registered member")} (needs ${minMembers}).`,
    );
  }
  return { ...base, active: eventsOk && membersOk, inPilot: false, pilotEndsAt, reasons };
}

// ─── At risk ─────────────────────────────────────────────────────────────────

export type AtRiskKind = "inactive" | "pilot" | "slipping";

export type ClubRisk = {
  kind: AtRiskKind;
  /** Badge text: "Inactive", "Pilot period ends Dec 12, 2026", "At the line". */
  tag: string;
  /** Plain-language reasons, one per problem. */
  reasons: string[];
  /** A pilot period that ends with the current term (the most urgent pilots). */
  endsThisTerm: boolean;
};

export type ClubRiskInput = {
  status: string;
  activity: ClubActivity;
  at: Date;
  /** The current term (or the last one, between terms) — the one clubActivity counts as current. */
  term: Pick<TermLike, "startsOn" | "endsOn"> | null;
  rule: ClubRule;
};

const eventsPhrase = (n: number) => `${n === 0 ? "No" : `Only ${n}`} ${n === 1 ? "event" : "events"} with check-ins`;

/**
 * AT RISK — an approved club that's inactive now or will be soon. The one
 * rule behind every "at risk" list (the admin Overview, the assistant's
 * club_health):
 *   inactive — below the active-club bar today (reasons from evaluateClubActivity);
 *   pilot    — in its pilot period but not yet meeting the bar the pilot hands
 *              over to: fewer than minEvents held events this term, or fewer
 *              than minMembers registered members. endsThisTerm when the pilot
 *              ends with the current term;
 *   slipping — active only on the previous term's record, with fewer than
 *              minEvents held this term once half the term has passed; or
 *              sitting exactly at the member minimum.
 * Null when the club is fine, or isn't approved (it has no standing to lose).
 */
export function clubRisk(i: ClubRiskInput): ClubRisk | null {
  if (i.status !== "APPROVED") return null;
  const a = i.activity;
  const { minEvents, minMembers } = i.rule;
  const termName = a.currentTermName ?? "this term";
  if (!a.active) return { kind: "inactive", tag: STANDING_LABEL.inactive, reasons: a.reasons, endsThisTerm: false };

  if (a.inPilot) {
    const reasons: string[] = [];
    if (a.heldEventsCurrentTerm < minEvents) reasons.push(`${eventsPhrase(a.heldEventsCurrentTerm)} in ${termName} (needs ${minEvents} in one term).`);
    if (a.registeredMembers < minMembers) reasons.push(`${a.registeredMembers === 0 ? "No registered members yet" : `Only ${plural(a.registeredMembers, "registered member")}`} (needs ${minMembers}).`);
    if (!reasons.length) return null;
    const endsThisTerm = Boolean(a.pilotEndsAt && i.term && a.pilotEndsAt.getTime() <= termEnd(i.term).getTime());
    return { kind: "pilot", tag: a.pilotEndsAt ? `Pilot period ends ${fmtLongDate(a.pilotEndsAt)}` : STANDING_LABEL.pilot, reasons, endsThisTerm };
  }

  const reasons: string[] = [];
  const pastHalf = i.term ? i.at.getTime() >= i.term.startsOn.getTime() + (i.term.endsOn.getTime() - i.term.startsOn.getTime()) / 2 : false;
  if (pastHalf && a.heldEventsCurrentTerm < minEvents) {
    reasons.push(`${eventsPhrase(a.heldEventsCurrentTerm)} in ${termName} so far; active on ${a.previousTermName ?? "last term"}'s record (needs ${minEvents} in one term).`);
  }
  if (a.registeredMembers === minMembers) reasons.push(`Exactly ${minMembers} registered members, the minimum — one departure makes it inactive.`);
  return reasons.length ? { kind: "slipping", tag: "At the line", reasons, endsThisTerm: false } : null;
}

const RISK_RANK: Record<AtRiskKind, number> = { inactive: 0, pilot: 1, slipping: 2 };

/** At-risk lists read most urgent first: inactive, then pilots (those ending this term first), then slipping; ties by name. */
export function compareRisk(x: ClubRisk & { name: string }, y: ClubRisk & { name: string }): number {
  return RISK_RANK[x.kind] - RISK_RANK[y.kind] || Number(y.endsThisTerm) - Number(x.endsThisTerm) || x.name.localeCompare(y.name);
}

// ─── Periods (campus time) ───────────────────────────────────────────────────

/** One retention period. `end` is exclusive (the next period's start). */
export type PeriodBucket = { key: string; label: string; start: Date; end: Date };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

type CalendarPeriod = Exclude<RetentionPeriod, "academicYear">;

/** Months since year 0 / quarters since year 0 / the year — consecutive periods differ by 1. */
function ordinalOf(period: CalendarPeriod, d: Date): number {
  const { y, m } = campusParts(d);
  return period === "month" ? y * 12 + (m - 1) : period === "quarter" ? y * 4 + Math.floor((m - 1) / 3) : y;
}

function calendarBucket(period: CalendarPeriod, n: number): PeriodBucket {
  if (period === "month") {
    const y = Math.floor(n / 12);
    const m = (n % 12) + 1;
    return { key: `${y}-${pad2(m)}`, label: `${MONTHS[m - 1]} ${y}`, start: campusDate(y, m, 1), end: m === 12 ? campusDate(y + 1, 1, 1) : campusDate(y, m + 1, 1) };
  }
  if (period === "quarter") {
    const y = Math.floor(n / 4);
    const q = n % 4;
    const m = q * 3 + 1;
    return { key: `${y}-Q${q + 1}`, label: `Q${q + 1} ${y}`, start: campusDate(y, m, 1), end: q === 3 ? campusDate(y + 1, 1, 1) : campusDate(y, m + 3, 1) };
  }
  return { key: String(n), label: String(n), start: campusDate(n, 1, 1), end: campusDate(n + 1, 1, 1) };
}

/**
 * Academic years from the Term table ("2025-2026"). Years run back to back:
 * each lasts from its first term's start until the next year's first term,
 * so summer check-ins belong to the year they follow even when summer isn't
 * on the calendar. The last year ends with its last term.
 */
export function academicYearBuckets(terms: TermLike[]): PeriodBucket[] {
  const groups = new Map<string, { start: Date; end: Date }>();
  for (const t of sortTerms(terms)) {
    const g = groups.get(t.academicYear);
    const end = termEnd(t);
    if (!g) groups.set(t.academicYear, { start: t.startsOn, end });
    else if (end > g.end) g.end = end;
  }
  const list = [...groups.entries()].sort((a, b) => a[1].start.getTime() - b[1].start.getTime());
  return list.map(([label, g], i) => ({
    key: label,
    label,
    start: g.start,
    end: i + 1 < list.length ? list[i + 1][1].start : new Date(g.end.getTime() + 1),
  }));
}

/** The `count` periods ending with the one that contains `at`, oldest first. */
export function lastBuckets(period: RetentionPeriod, at: Date, count: number, terms: TermLike[] = []): PeriodBucket[] {
  if (count <= 0) return [];
  if (period === "academicYear") {
    const years = academicYearBuckets(terms);
    let idx = -1;
    years.forEach((b, i) => {
      if (b.start.getTime() <= at.getTime()) idx = i;
    });
    return idx === -1 ? [] : years.slice(Math.max(0, idx - count + 1), idx + 1);
  }
  const last = ordinalOf(period, at);
  return Array.from({ length: count }, (_, i) => calendarBucket(period, last - count + 1 + i));
}

/** Every period from the one containing `from` through the one containing `to`, oldest first. */
export function bucketsBetween(period: RetentionPeriod, from: Date, to: Date, terms: TermLike[] = []): PeriodBucket[] {
  if (to.getTime() < from.getTime()) return [];
  if (period === "academicYear") {
    return academicYearBuckets(terms).filter((b) => b.end.getTime() > from.getTime() && b.start.getTime() <= to.getTime());
  }
  const first = ordinalOf(period, from);
  const last = ordinalOf(period, to);
  // A guard against absurd ranges; 600 months is fifty years of history.
  const n = Math.min(last - first + 1, 600);
  return Array.from({ length: n }, (_, i) => calendarBucket(period, last - n + 1 + i));
}

/** Index of the bucket containing `d`, or -1. */
export function bucketIndexOf(d: Date, buckets: PeriodBucket[]): number {
  const t = d.getTime();
  return buckets.findIndex((b) => b.start.getTime() <= t && t < b.end.getTime());
}

// ─── Retention ───────────────────────────────────────────────────────────────

export function retentionRate(retained: number, previousAttendees: number): number | null {
  return previousAttendees > 0 ? retained / previousAttendees : null;
}

/**
 * RETENTION per period: of the people who attended in the period before, the
 * share who attended in this one — the same rule as the headline figure, so
 * a pair only has a rate when both periods had attendees (a month the club
 * didn't meet is a gap, not 0%). Takes (person, bucket index) check-in facts
 * and returns one point per bucket; the first bucket has no "before" inside
 * the range, so callers fetch one extra bucket and drop the first point.
 * These points draw the charts; the one figure screens quote is
 * latestRetention below.
 */
export function retentionSeries(buckets: PeriodBucket[], attendance: Array<{ userId: string; bucket: number }>, at: Date): RetentionPoint[] {
  const sets = buckets.map(() => new Set<string>());
  for (const a of attendance) if (a.bucket >= 0 && a.bucket < sets.length) sets[a.bucket].add(a.userId);
  return buckets.map((b, i) => {
    const prev = i > 0 ? sets[i - 1] : new Set<string>();
    let retained = 0;
    for (const u of prev) if (sets[i].has(u)) retained++;
    return {
      label: b.label,
      previousLabel: i > 0 ? buckets[i - 1].label : null,
      start: b.start,
      end: new Date(b.end.getTime() - 1),
      attendees: sets[i].size,
      retained,
      previousAttendees: prev.size,
      rate: sets[i].size > 0 ? retentionRate(retained, prev.size) : null,
      inProgress: b.start.getTime() <= at.getTime() && at.getTime() < b.end.getTime(),
    };
  });
}

/** "Sep 2026" → "Sep", "Q3 2026" → "Q3"; academic years ("2025-2026") and years stay whole. */
export function shortPeriodLabel(label: string): string {
  const m = /^([A-Z][a-z]{2}|Q[1-4]) \d{4}$/.exec(label);
  return m ? m[1] : label;
}

/** The year of a month or quarter label ("Sep 2026" → "2026"); null for academic years and years. */
function labelYear(label: string): string | null {
  return /^(?:[A-Z][a-z]{2}|Q[1-4]) (\d{4})$/.exec(label)?.[1] ?? null;
}

/** What retention means, in one line (column headers, footnotes, the assistant). */
export const RETENTION_HINT = "Share of one full month's attendees who came back the next full month (the latest two months in a row with check-ins)";

/** What a screen says when there's no retention figure yet. */
export function noRetentionText(noun: string = "month"): string {
  return `Shows once two full ${noun}s in a row have check-ins`;
}

/** The parts of a retention point the headline rule reads (RetentionPoint and the charts' rows satisfy it). */
export type RetentionPairInput = Pick<RetentionPoint, "label" | "previousLabel" | "attendees" | "retained" | "previousAttendees" | "inProgress">;

/**
 * RETENTION, the one figure every screen quotes: the share of one complete
 * period's attendees who came back the next complete period, for the most
 * recent pair of complete periods that both had attendees. Takes a series as
 * retentionSeries returns it (oldest first, ending with the period that
 * contains `at`). The period still running never counts, so the figure
 * doesn't sag mid-month; a pair where either period had nobody is skipped, so
 * a club that doesn't meet over the summer keeps its spring figure instead of
 * showing 0%. Null when the series has no such pair.
 *
 * label is how every screen shows it: "Sep → Oct: 62% came back". A pair
 * from an earlier year than the period running now names its year ("Oct →
 * Nov 2025"), so last year's October is never read as this one.
 */
export function latestRetention(points: readonly RetentionPairInput[]): RetentionSummary | null {
  const current = points.find((p) => p.inProgress) ?? points[points.length - 1];
  const thisYear = current ? labelYear(current.label) : null;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.inProgress || p.previousLabel === null) continue;
    if (p.previousAttendees > 0 && p.attendees > 0) {
      const rate = p.retained / p.previousAttendees;
      const year = labelYear(p.label);
      const months = `${shortPeriodLabel(p.previousLabel)} → ${shortPeriodLabel(p.label)}${year && thisYear && year !== thisYear ? ` ${year}` : ""}`;
      return { from: p.previousLabel, to: p.label, rate, retained: p.retained, previousAttendees: p.previousAttendees, months, label: `${months}: ${Math.round(rate * 100)}% came back` };
    }
  }
  return null;
}

/**
 * PERIODS ATTENDED (per person; "Months attended" on screens): of the periods
 * since they got involved, how many had ≥1 of their check-ins. It's not
 * retention — that word is for the club figure above. A period still in
 * progress only counts once they've attended in it — it isn't a miss until
 * it's over.
 */
export function periodsAttended(buckets: PeriodBucket[], attendedBuckets: Iterable<number>, at: Date): { periods: number; attendedPeriods: number; rate: number | null } {
  const attended = new Set(attendedBuckets);
  let periods = 0;
  let attendedPeriods = 0;
  buckets.forEach((b, i) => {
    const came = attended.has(i);
    if (came || b.end.getTime() <= at.getTime()) {
      periods++;
      if (came) attendedPeriods++;
    }
  });
  return { periods, attendedPeriods, rate: periods > 0 ? attendedPeriods / periods : null };
}

// ─── Activity score ──────────────────────────────────────────────────────────

/** The ACTIVITY SCORE counts held events in this many days up to now. */
export const ACTIVITY_SCORE_DAYS = 30;

/**
 * What the activity score is called on every screen: the clubs list sort and
 * table column, the card, the assistant. It counts HELD events (started, ≥1
 * check-in) in the last ACTIVITY_SCORE_DAYS, so scheduling dates can't raise it.
 */
export const ACTIVITY_SCORE_LABEL = "Events held lately";
export const ACTIVITY_SCORE_HINT = `Events held in the last ${ACTIVITY_SCORE_DAYS} days (started, with at least one check-in)`;

/** "Held 9 events in the last 30 days" — a search reason, so it gives the count. */
export function heldLatelyText(n: number): string {
  return `Held ${plural(n, "event")} in the last ${ACTIVITY_SCORE_DAYS} days`;
}

/** One of a club's scheduled occurrences (host or approved co-host), reduced to what HELD needs. */
export type OccurrenceFact = { startsAt: Date; hasCheckin: boolean };

/** HELD EVENT: a scheduled occurrence that has started (by `at`) and has ≥1 check-in. The SQL in index.ts (HAS_CHECKIN up to `at`) applies the same rule. */
export function isHeldEvent(o: OccurrenceFact, at: Date): boolean {
  return o.hasCheckin && o.startsAt.getTime() <= at.getTime();
}

/** ACTIVITY SCORE: held events that started in the last ACTIVITY_SCORE_DAYS up to `at` (both ends inclusive). Dates still ahead never count. */
export function activityScore(occurrences: Iterable<OccurrenceFact>, at: Date): number {
  const from = at.getTime() - ACTIVITY_SCORE_DAYS * DAY_MS;
  let n = 0;
  for (const o of occurrences) if (isHeldEvent(o, at) && o.startsAt.getTime() >= from) n++;
  return n;
}

// ─── Attendance rate ─────────────────────────────────────────────────────────

export type MembershipWindow = { status: string; joinedAt: Date | null; endedAt: Date | null };

/**
 * Members at the time of an event: joined at or before it started and not
 * ended by then, in any status except a pending or declined request. (The
 * SQL in index.ts — memberAtSql — applies the same rule.)
 */
export function wasMemberAt(m: MembershipWindow, at: Date): boolean {
  if (m.status === "PENDING" || m.status === "DECLINED" || !m.joinedAt) return false;
  return m.joinedAt.getTime() <= at.getTime() && (!m.endedAt || m.endedAt.getTime() > at.getTime());
}

/**
 * The stretch of time someone has been involved with a club, for "since
 * joining" numbers: from the earlier of joining and their first check-in
 * (guests who later join keep their history) until now — or, for a
 * membership that ended, until it ended or their last check-in, whichever
 * is later. Null when they've neither joined nor attended.
 */
export function involvementWindow(
  m: MembershipWindow | null | undefined,
  attended: { firstAt: Date; lastAt: Date } | null | undefined,
  at: Date,
): { start: Date; end: Date } | null {
  const joined = m && m.status !== "PENDING" && m.status !== "DECLINED" ? m.joinedAt : null;
  const starts = [joined, attended?.firstAt ?? null].filter((d): d is Date => d instanceof Date);
  if (starts.length === 0) return null;
  const start = new Date(Math.min(...starts.map((d) => d.getTime())));
  const endedMembership = m && (m.status === "LEFT" || m.status === "ALUMNI" || m.status === "REMOVED") && m.endedAt ? m.endedAt : null;
  let end = at.getTime();
  if (endedMembership) end = Math.min(end, Math.max(endedMembership.getTime(), attended?.lastAt.getTime() ?? 0));
  return { start, end: new Date(Math.max(end, start.getTime())) };
}

/** memberAttendees ÷ membersAtTime, or null for a club with no members yet. Capped at 100%. */
export function attendanceRate(memberAttendees: number, membersAtTime: number): number | null {
  return membersAtTime > 0 ? Math.min(1, memberAttendees / membersAtTime) : null;
}

/** Splits one event's check-ins into members and guests and computes its rate. */
export function occurrenceCounts(
  attendeeIds: Iterable<string>,
  memberships: Array<MembershipWindow & { userId: string }>,
  startsAt: Date,
): { attendees: number; memberAttendees: number; guests: number; membersAtTime: number; rate: number | null } {
  const members = new Set(memberships.filter((m) => wasMemberAt(m, startsAt)).map((m) => m.userId));
  const attendees = new Set(attendeeIds);
  let memberAttendees = 0;
  for (const id of attendees) if (members.has(id)) memberAttendees++;
  return summarizeOccurrence({ attendees: attendees.size, memberAttendees, membersAtTime: members.size });
}

/** Adds guests and the rate to raw per-event counts. */
export function summarizeOccurrence(c: { attendees: number; memberAttendees: number; membersAtTime: number }) {
  return { ...c, guests: Math.max(0, c.attendees - c.memberAttendees), rate: attendanceRate(c.memberAttendees, c.membersAtTime) };
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

/**
 * REVIEW GATE — only active student accounts write reviews (faculty, staff and
 * alumni can't; domain/reviews refuses them), and only after `required`
 * check-ins. `canReview` is the account half, so screens can leave the
 * "N of M events" progress out for people who can never review.
 */
export function reviewGate(account: { kind: string; status: string } | null, attended: number, required: number): { canReview: boolean; eligible: boolean } {
  const canReview = account?.kind === "STUDENT" && account.status === "ACTIVE";
  return { canReview, eligible: canReview && attended >= required };
}

// ─── Interconnection ─────────────────────────────────────────────────────────

/** Check-ins that share the same participating clubs and the same attendee memberships, counted together. */
export type CheckinGroup = { participants: string[]; memberOf: string[]; count: number };

/**
 * The lines one check-in draws on the network (participating clubs = host +
 * approved co-hosts):
 *  - a guest visit (none of the attendee's clubs participates): every club M
 *    they belong to is linked to every participating club;
 *  - at one of their own clubs' events: only links between that club and the
 *    event's other participating clubs (co-hosting). Going to your own club's
 *    meeting isn't inter-club activity, even if you belong to other clubs.
 * Lines are undirected and count once per check-in.
 */
export function checkinLines(participants: string[], memberOf: string[]): Array<[string, string]> {
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  const parts = new Set(participants);
  const inside = [...new Set(memberOf)].filter((m) => parts.has(m));
  for (const m of inside.length ? inside : new Set(memberOf)) {
    for (const x of new Set(participants)) {
      if (m === x) continue;
      const pair: [string, string] = m < x ? [m, x] : [x, m];
      const key = `${pair[0]}|${pair[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(pair);
      }
    }
  }
  return out;
}

const byWeight = (x: NetworkEdge, y: NetworkEdge) => y.weight - x.weight || x.source.localeCompare(y.source) || x.target.localeCompare(y.target);

/**
 * The definition applied check-in by check-in: sums groups of check-ins into
 * line weights and node sizes (check-ins at each club's events). With
 * `nodeIds`, lines and sizes for other clubs are dropped; `crossClubCheckins`
 * counts every check-in that drew at least one line. The database computes
 * the same numbers in aggregate (see linesFromCounts); tests hold the two
 * together.
 */
export function accumulateNetwork(groups: CheckinGroup[], nodeIds?: ReadonlySet<string>): { edges: NetworkEdge[]; sizes: Map<string, number>; crossClubCheckins: number } {
  const weights = new Map<string, NetworkEdge>();
  const sizes = new Map<string, number>();
  let crossClubCheckins = 0;
  const keep = (id: string) => !nodeIds || nodeIds.has(id);
  for (const g of groups) {
    if (g.count <= 0) continue;
    for (const p of new Set(g.participants)) if (keep(p)) sizes.set(p, (sizes.get(p) ?? 0) + g.count);
    const lines = checkinLines(g.participants, g.memberOf);
    if (lines.length > 0) crossClubCheckins += g.count;
    for (const [a, b] of lines) {
      if (!keep(a) || !keep(b)) continue;
      const key = `${a}|${b}`;
      const e = weights.get(key);
      if (e) e.weight += g.count;
      else weights.set(key, { source: a, target: b, weight: g.count });
    }
  }
  return { edges: [...weights.values()].sort(byWeight), sizes, crossClubCheckins };
}

/** A count for a pair of clubs (direction depends on the use). */
export type PairCount = { a: string; b: string; count: number };

/**
 * Line weights from two aggregates the database can compute without looking
 * at check-ins one by one:
 *   directed — check-ins counted per (member club M → participating club X), M ≠ X
 *   overlaps — check-ins whose attendee belonged to two participating clubs
 *              a and b, which `directed` saw in both directions
 * weight{a,b} = directed(a→b) + directed(b→a) − overlaps{a,b}, which equals
 * summing checkinLines over every check-in.
 */
export function linesFromCounts(directed: PairCount[], overlaps: PairCount[], nodeIds?: ReadonlySet<string>): NetworkEdge[] {
  const weights = new Map<string, NetworkEdge>();
  const add = (x: string, y: string, n: number) => {
    if (x === y || n === 0) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = `${a}|${b}`;
    const e = weights.get(key);
    if (e) e.weight += n;
    else weights.set(key, { source: a, target: b, weight: n });
  };
  for (const d of directed) add(d.a, d.b, d.count);
  for (const o of overlaps) add(o.a, o.b, -o.count);
  return [...weights.values()]
    .filter((e) => e.weight > 0 && (!nodeIds || (nodeIds.has(e.source) && nodeIds.has(e.target))))
    .sort(byWeight);
}

/** The aggregates linesFromCounts expects, computed from check-in groups (mirrors the SQL in index.ts). */
export function countsFromCheckins(groups: CheckinGroup[]): { directed: PairCount[]; overlaps: PairCount[] } {
  const directed = new Map<string, PairCount>();
  const overlaps = new Map<string, PairCount>();
  const bump = (map: Map<string, PairCount>, a: string, b: string, n: number) => {
    const key = `${a}|${b}`;
    const c = map.get(key);
    if (c) c.count += n;
    else map.set(key, { a, b, count: n });
  };
  for (const g of groups) {
    const participants = [...new Set(g.participants)];
    const memberOf = [...new Set(g.memberOf)];
    const inside = memberOf.filter((m) => participants.includes(m)).sort();
    // At one of their own clubs' events, only that club's co-hosts count; otherwise it's a guest visit.
    const from = inside.length ? inside : memberOf;
    for (const m of from) for (const x of participants) if (m !== x) bump(directed, m, x, g.count);
    for (let i = 0; i < inside.length; i++) for (let j = i + 1; j < inside.length; j++) bump(overlaps, inside[i], inside[j], g.count);
  }
  return { directed: [...directed.values()], overlaps: [...overlaps.values()] };
}
