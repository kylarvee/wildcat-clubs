import "server-only";
import { cache } from "react";
import { Prisma, type MembershipStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { currentOrLastTerm, getTerms, previousActivityTerm } from "@/lib/terms";
import { DAY_MS, TZ } from "@/lib/time";
import * as P from "./pure";
import { summarizeService, totalsByTerm } from "./service";
import type {
  ClubActivity,
  ClubListMetrics,
  MemberAttendanceCount,
  MemberClubSummary,
  MemberClubSummaryEntry,
  NetworkData,
  NetworkNode,
  OccurrenceAttendance,
  PlatformSummary,
  RetentionPeriod,
  RetentionPoint,
  RetentionSummary,
  ServiceSummary,
  ServiceTermTotal,
  ServiceTotal,
} from "./types";

/**
 * DERIVED METRICS — read-only views over the data lake. Nothing here writes.
 * Every number a surface shows about activity, retention, attendance,
 * ratings or interconnection comes from these functions, so the clubs list,
 * club pages, dashboards, admin analytics, the network canvas and the mobile
 * app can never disagree.
 *
 * Definitions (thresholds come from system config, see lib/config):
 *
 * ACTIVE STUDENT (per club) — attended one of the club's events in the last
 *   `activity.studentWindowDays` (31) days, OR attended at least one of the
 *   club's last `activity.studentRecentEvents` (2) held events.
 *
 * HELD EVENT — a SCHEDULED occurrence that has started and has ≥1 check-in.
 *   Co-hosted events count for the host and every approved co-host.
 *
 * REGISTERED MEMBERS — ACTIVE memberships of student accounts. Advisors hold
 *   memberships too (for announcements and chat) but are never counted, as
 *   members or as active members.
 *
 * ACTIVE CLUB — status APPROVED and either in its PILOT PERIOD, or
 *   (≥ `activity.clubMinEvents` (2) held events in the current term or the
 *   previous activity term) AND ≥ `activity.clubMinMembers` (8) registered
 *   members.
 *
 * PILOT PERIOD — from approval (or creation if never approved) until the end
 *   of the first full activity-counting term that starts after the club was
 *   created. Created mid-Fall → pilot runs through Spring.
 *
 * ATTENDANCE RATE (event) — student members who checked in ÷ student members
 *   at the time of the event (joinedAt ≤ start, not ended before it). Everyone
 *   else who checked in (non-members, advisors) is counted as a guest.
 *
 * RETENTION — the share of one complete month's attendees who came back the
 *   next complete month, for the most recent pair of complete months (within
 *   the last 12) that both had attendees. The month still running never
 *   counts. Every screen shows it the same way: "Sep → Oct: 62% came back"
 *   (ClubListMetrics.retention; pure.latestRetention). The charts plot the
 *   same comparison for every month, quarter, academic year or year (period
 *   P vs. the one before), and quarter-and-longer figures use the same rule.
 *
 * MONTHS ATTENDED (per person) — of the months since they got involved, how
 *   many had ≥1 of their check-ins (the period in progress counts only once
 *   they've come). Never called retention.
 *
 * ACTIVITY SCORE (clubs list "Events held lately") — HELD events (as below)
 *   that started in the last 30 days, hosted or co-hosted. Scheduling dates
 *   doesn't raise it; holding them does.
 *
 * AT RISK — an approved club that's inactive now; or in its pilot period
 *   without yet meeting the bar it hands over to (events this term, members);
 *   or active only on last term's record with too few events this term past
 *   its halfway point, or exactly at the member minimum (pure.clubRisk). The
 *   admin Overview and the assistant both read clubsAtRisk().
 *
 * INTERCONNECTION — for each check-in at an event whose participating clubs
 *   are P (host + approved co-hosts): a guest visit (none of the attendee's
 *   clubs is in P) adds 1 to edge (M, X) for each of their clubs M and each X
 *   in P; at one of their own clubs' events, only edges between their clubs in
 *   P and the other clubs in P (co-hosting) count.
 *   Node size = check-ins at the club's events. Centrality emerges from the
 *   force layout; nothing is placed by hand.
 *
 * SERVICE HOURS — every check-in at a date of an event whose serviceMinutes
 *   is set earns those minutes, however it was recorded. Totals are summed
 *   from attendance every time (never stored), so removing a check-in or
 *   editing the event's hours changes them at once. A person's hours sit
 *   under the event's host club; a club's total counts every check-in at
 *   events it hosted or co-hosted. The rule is in ./service.ts (pure,
 *   client-safe), which also says hours the one way ("2 service hours").
 *
 * The rules themselves live in ./pure.ts (unit-tested); this file gathers the
 * facts they decide on with batched SQL. Signatures here are a contract.
 *
 * Details settled while building (see pure.ts for each rule):
 * - Event times are occurrence start times, so a leader's late manual add
 *   counts on the day of the event.
 * - Past occurrences of an event that was later cancelled still count when
 *   people checked in, in every number (activity score included: it counts
 *   what was held).
 * - "Members at the time" = joined at or before the start, not ended by then,
 *   any status except a pending or declined request.
 * - "Current term" is the term containing now, or the latest one between
 *   terms; the pilot end is measured from creation, and a club with no full
 *   term after its creation on the calendar yet is treated as in its pilot.
 * - Network lines are undirected; one check-in adds at most 1 to a line.
 *   "Tag all clubs" events only link the clubs that approved a co-host row.
 *   The default (last 365 days) canvas is shared between visitors for a
 *   minute; explicit windows are computed per request.
 * - Database timestamps hold UTC wall-clock time; every comparison goes
 *   through ts() and campus-time buckets convert explicitly.
 */

export type * from "./types";
export {
  isActiveStudent,
  pilotPeriodEnd,
  attendanceRate,
  retentionRate,
  latestRetention,
  noRetentionText,
  RETENTION_HINT,
  checkinLines,
  ACTIVITY_SCORE_DAYS,
  ACTIVITY_SCORE_HINT,
  ACTIVITY_SCORE_LABEL,
  type ActivityRule,
  type AtRiskKind,
  type ClubRisk,
  type Standing,
} from "./pure";
export { earnedMinutes, fmtServiceHours, serviceEventsLabel, serviceHours, serviceHoursLabel, serviceLine } from "./service";

// ─── SQL building blocks ─────────────────────────────────────────────────────

/**
 * A timestamp parameter for comparing with our `timestamp(3)` columns, which
 * hold UTC wall-clock time. A bare Date parameter would be converted in the
 * database session's time zone (America/Denver here) and be off by hours.
 */
const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Ids, or a subquery that returns club ids. */
type ClubScope = string[] | Prisma.Sql;

function inClubs(col: Prisma.Sql, scope?: ClubScope) {
  if (!scope) return Prisma.empty;
  return Array.isArray(scope) ? Prisma.sql`AND ${col} = ANY(${scope}::text[])` : Prisma.sql`AND ${col} IN (${scope})`;
}

/**
 * Rows (occurrence_id, starts_at, club_id): one per club taking part in a
 * scheduled occurrence — the host and every approved co-host. Past dates of
 * an event cancelled later stay in (held events count when people came).
 */
function clubOccurrences(o: { clubs?: ClubScope; from?: Date; to?: Date }): Prisma.Sql {
  const from = o.from ? Prisma.sql`AND o."startsAt" >= ${ts(o.from)}` : Prisma.empty;
  const to = o.to ? Prisma.sql`AND o."startsAt" <= ${ts(o.to)}` : Prisma.empty;
  return Prisma.sql`
    SELECT o.id AS occurrence_id, o."startsAt" AS starts_at, e."clubId" AS club_id
      FROM "EventOccurrence" o JOIN "Event" e ON e.id = o."eventId"
     WHERE o.status = 'SCHEDULED' AND e."clubId" IS NOT NULL ${inClubs(Prisma.sql`e."clubId"`, o.clubs)} ${from} ${to}
    UNION
    SELECT o.id, o."startsAt", c."clubId"
      FROM "EventOccurrence" o JOIN "Event" e ON e.id = o."eventId"
      JOIN "EventCohost" c ON c."eventId" = e.id AND c.status = 'APPROVED'
     WHERE o.status = 'SCHEDULED' ${inClubs(Prisma.sql`c."clubId"`, o.clubs)} ${from} ${to}`;
}

/** Same rule as P.wasMemberAt, for a Membership alias at a timestamp expression. */
function memberAtSql(alias: string, time: Prisma.Sql) {
  const m = Prisma.raw(alias);
  return Prisma.sql`${m}."joinedAt" IS NOT NULL AND ${m}."joinedAt" <= ${time} AND (${m}."endedAt" IS NULL OR ${m}."endedAt" > ${time}) AND ${m}.status NOT IN ('PENDING', 'DECLINED')`;
}

const HAS_CHECKIN = (occ: Prisma.Sql) => Prisma.sql`EXISTS (SELECT 1 FROM "Attendance" x WHERE x."occurrenceId" = ${occ})`;

/** Clubs whose events a person has checked in at (host or approved co-host). */
function clubsAttendedBy(userId: string) {
  return Prisma.sql`
    SELECT e2."clubId" FROM "Attendance" a2
      JOIN "EventOccurrence" o2 ON o2.id = a2."occurrenceId" JOIN "Event" e2 ON e2.id = o2."eventId"
     WHERE a2."userId" = ${userId} AND e2."clubId" IS NOT NULL
    UNION
    SELECT c2."clubId" FROM "Attendance" a2
      JOIN "EventOccurrence" o2 ON o2.id = a2."occurrenceId"
      JOIN "EventCohost" c2 ON c2."eventId" = o2."eventId" AND c2.status = 'APPROVED'
     WHERE a2."userId" = ${userId}`;
}

type StandingRow = { club_id: string; user_id: string; attended: number; first_at: Date; last_at: Date; latest_rank: number };

/**
 * Per (club, person): check-ins at the club's held events up to `at`, first
 * and last of them, and the rank of the latest one among the club's held
 * events (newest = 1). `activeOnly` pre-filters to rows the active rule can
 * pass (the result is then confirmed with P.isActiveStudent), which keeps
 * the all-clubs batch small.
 */
async function standingRows(o: {
  clubs?: ClubScope;
  userId?: string;
  at: Date;
  activeOnly?: P.ActivityRule;
  activeMembersOnly?: boolean;
  studentsOnly?: boolean;
}): Promise<StandingRow[]> {
  // REGISTERED MEMBERS only, so "active members" is a subset of "members" (an advisor's membership doesn't count).
  const member = o.activeMembersOnly
    ? Prisma.sql`JOIN "Membership" m ON m."userId" = a."userId" AND m."clubId" = h.club_id AND m.status = 'ACTIVE'
       JOIN "User" mu ON mu.id = a."userId" AND mu.kind = 'STUDENT'`
    : Prisma.empty;
  const student = o.studentsOnly ? Prisma.sql`JOIN "User" u ON u.id = a."userId" AND u.kind = 'STUDENT' AND u.status = 'ACTIVE'` : Prisma.empty;
  const user = o.userId ? Prisma.sql`AND a."userId" = ${o.userId}` : Prisma.empty;
  const active = o.activeOnly
    ? Prisma.sql`AND (h.rn <= ${o.activeOnly.recentEvents} OR h.starts_at >= ${ts(new Date(o.at.getTime() - o.activeOnly.windowDays * DAY_MS))})`
    : Prisma.empty;
  return db.$queryRaw<StandingRow[]>`
    WITH co AS (${clubOccurrences({ clubs: o.clubs, to: o.at })}),
    held AS (
      SELECT co.club_id, co.occurrence_id, co.starts_at,
             row_number() OVER (PARTITION BY co.club_id ORDER BY co.starts_at DESC, co.occurrence_id DESC) AS rn
        FROM co
       WHERE ${HAS_CHECKIN(Prisma.sql`co.occurrence_id`)}
    )
    SELECT h.club_id, a."userId" AS user_id, count(*)::int AS attended,
           min(h.starts_at) AS first_at, max(h.starts_at) AS last_at, min(h.rn)::int AS latest_rank
      FROM held h
      JOIN "Attendance" a ON a."occurrenceId" = h.occurrence_id
      ${member} ${student}
     WHERE TRUE ${user} ${active}
     GROUP BY h.club_id, a."userId"`;
}

type Attended = { attended: number; firstAt: Date; lastAt: Date; latestRank: number };

const toAttended = (r: StandingRow): Attended => ({ attended: r.attended, firstAt: r.first_at, lastAt: r.last_at, latestRank: r.latest_rank });
const standingOf = (a: Attended | undefined): P.Standing => (a ? { lastAttendedAt: a.lastAt, latestRank: a.latestRank } : { lastAttendedAt: null, latestRank: null });

// ─── Per-request caches ──────────────────────────────────────────────────────

/** One "now" per request, so every number on a page is computed as of the same instant. */
const requestNow = cache(() => new Date());
const nowOr = (at?: Date) => at ?? requestNow();

const idsKey = (ids?: string[] | null) => (ids ? [...new Set(ids)].sort().join(",") : "*");
const idsFromKey = (key: string) => (key === "*" ? undefined : key ? key.split(",") : []);

async function activityRule(): Promise<P.ActivityRule> {
  const c = await getConfig();
  return { windowDays: c["activity.studentWindowDays"], recentEvents: c["activity.studentRecentEvents"] };
}

/** Everyone's standing in one club (club → person rows), for rosters. */
const clubStandings = cache(async (clubId: string, atMs: number): Promise<Map<string, Attended>> => {
  const rows = await standingRows({ clubs: [clubId], at: new Date(atMs) });
  return new Map(rows.map((r) => [r.user_id, toAttended(r)]));
});

/** One person's standing in every club whose events they've attended (club id → standing). */
const userStandings = cache(async (userId: string, atMs: number): Promise<Map<string, Attended>> => {
  const rows = await standingRows({ clubs: clubsAttendedBy(userId), userId, at: new Date(atMs) });
  return new Map(rows.map((r) => [r.club_id, toAttended(r)]));
});

/** club id → ids of people active there. `key` is idsKey(); "*" = every club. */
const activeAttendees = cache(async (key: string, atMs: number, membersOnly: boolean, studentsOnly: boolean): Promise<Map<string, Set<string>>> => {
  const clubs = idsFromKey(key);
  const out = new Map<string, Set<string>>();
  if (clubs && clubs.length === 0) return out;
  const at = new Date(atMs);
  const rule = await activityRule();
  const rows = await standingRows({ clubs, at, activeOnly: rule, activeMembersOnly: membersOnly, studentsOnly });
  for (const r of rows) {
    if (!P.isActiveStudent(standingOf(toAttended(r)), at, rule)) continue;
    const set = out.get(r.club_id) ?? new Set<string>();
    set.add(r.user_id);
    out.set(r.club_id, set);
  }
  return out;
});

async function registeredCounts(clubIds: string[]): Promise<Map<string, number>> {
  if (clubIds.length === 0) return new Map();
  // "Registered students" (spec): advisors hold memberships too, but don't count toward the bar.
  const rows = await db.membership.groupBy({ by: ["clubId"], where: { clubId: { in: clubIds }, status: "ACTIVE", user: { kind: "STUDENT" } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.clubId, r._count._all]));
}

/** REGISTERED MEMBERS of one club now — the "Members" number every screen shows. */
export async function registeredMemberCount(clubId: string): Promise<number> {
  return (await registeredCounts([clubId])).get(clubId) ?? 0;
}

// ─── Active students ─────────────────────────────────────────────────────────

/**
 * Is this person active in this club (per the ACTIVE STUDENT rule)? Looks at
 * attendance only, so it's true for a regular guest too; pair it with the
 * membership when the question is about members.
 */
export async function isMemberActive(userId: string, clubId: string, at?: Date): Promise<boolean> {
  const when = nowOr(at);
  const [standings, rule] = await Promise.all([userStandings(userId, when.getTime()), activityRule()]);
  return P.isActiveStudent(standingOf(standings.get(clubId)), when, rule);
}

/** Ids of REGISTERED MEMBERS (students with an ACTIVE membership) who are active per the definition. */
export async function activeMemberIdsFor(clubId: string, at?: Date): Promise<string[]> {
  const map = await activeAttendees(idsKey([clubId]), nowOr(at).getTime(), true, false);
  return [...(map.get(clubId) ?? [])];
}

// ─── Club activity ───────────────────────────────────────────────────────────

const clubActivityMap = cache(async (key: string, atMs: number): Promise<Map<string, ClubActivity>> => {
  const ids = idsFromKey(key);
  const out = new Map<string, ClubActivity>();
  if (ids && ids.length === 0) return out;
  const at = new Date(atMs);
  const clubs = await db.club.findMany({
    where: ids ? { id: { in: ids } } : { status: "APPROVED" },
    select: { id: true, status: true, createdAt: true },
  });
  if (clubs.length === 0) return out;
  const clubIds = clubs.map((c) => c.id);
  const [terms, cfg] = await Promise.all([getTerms(), getConfig()]);
  const current = currentOrLastTerm(terms, at);
  const previous = current ? previousActivityTerm(terms, current) : null;

  const [held, registered, active] = await Promise.all([
    heldCountsByTerm(clubIds, at, current, previous),
    registeredCounts(clubIds),
    activeAttendees(idsKey(clubIds), atMs, true, false),
  ]);

  const rule = { minEvents: cfg["activity.clubMinEvents"], minMembers: cfg["activity.clubMinMembers"] };
  for (const c of clubs) {
    const h = held.get(c.id);
    out.set(
      c.id,
      P.evaluateClubActivity({
        status: c.status,
        createdAt: c.createdAt,
        heldEventsCurrentTerm: h?.cur ?? 0,
        heldEventsPreviousTerm: h?.prev ?? 0,
        registeredMembers: registered.get(c.id) ?? 0,
        activeMembers: active.get(c.id)?.size ?? 0,
        at,
        terms,
        rule,
        currentTermName: current?.name ?? null,
        previousTermName: previous?.name ?? null,
      }),
    );
  }
  return out;
});

type TermWindow = { startsOn: Date; endsOn: Date } | null;

/** Held events per club in the current term (up to `at`) and in the previous activity term. */
async function heldCountsByTerm(clubIds: string[], at: Date, current: TermWindow, previous: TermWindow): Promise<Map<string, { cur: number; prev: number }>> {
  if (!current || clubIds.length === 0) return new Map();
  const curEnd = new Date(Math.min(P.termEnd(current).getTime(), at.getTime()));
  const prevFilter = previous
    ? Prisma.sql`co.starts_at >= ${ts(previous.startsOn)} AND co.starts_at <= ${ts(P.termEnd(previous))}`
    : Prisma.sql`FALSE`;
  const from = previous && previous.startsOn < current.startsOn ? previous.startsOn : current.startsOn;
  const rows = await db.$queryRaw<{ club_id: string; cur: number; prev: number }[]>`
    WITH co AS (${clubOccurrences({ clubs: clubIds, from, to: at })})
    SELECT co.club_id,
           (count(*) FILTER (WHERE co.starts_at >= ${ts(current.startsOn)} AND co.starts_at <= ${ts(curEnd)}))::int AS cur,
           (count(*) FILTER (WHERE ${prevFilter}))::int AS prev
      FROM co
     WHERE ${HAS_CHECKIN(Prisma.sql`co.occurrence_id`)}
     GROUP BY co.club_id`;
  return new Map(rows.map((r) => [r.club_id, { cur: r.cur, prev: r.prev }]));
}

const EMPTY_ACTIVITY: ClubActivity = { active: false, inPilot: false, pilotEndsAt: null, heldEventsCurrentTerm: 0, heldEventsPreviousTerm: 0, registeredMembers: 0, activeMembers: 0, reasons: [] };

export async function clubActivity(clubId: string, at?: Date): Promise<ClubActivity> {
  const map = await clubActivityMap(idsKey([clubId]), nowOr(at).getTime());
  return map.get(clubId) ?? EMPTY_ACTIVITY;
}

/** Batch version for admin tables (one pass for every club). Omit ids for every approved club. */
export async function clubActivityMany(clubIds?: string[], at?: Date): Promise<Map<string, ClubActivity>> {
  return clubActivityMap(idsKey(clubIds), nowOr(at).getTime());
}

// ─── At risk ─────────────────────────────────────────────────────────────────

export type AtRiskClub = P.ClubRisk & { id: string; name: string; slug: string; activity: ClubActivity };

/**
 * AT RISK clubs (pure.clubRisk), most urgent first: the one list behind the
 * admin Overview's "At risk" card and the assistant's club_health. Omit ids
 * for every approved club; clubs that aren't approved are never listed.
 */
export async function clubsAtRisk(opts: { clubIds?: string[]; at?: Date } = {}): Promise<AtRiskClub[]> {
  const at = nowOr(opts.at);
  if (opts.clubIds && opts.clubIds.length === 0) return [];
  const [activity, cfg, terms, clubs] = await Promise.all([
    clubActivityMap(idsKey(opts.clubIds), at.getTime()),
    getConfig(),
    getTerms(),
    db.club.findMany({ where: { status: "APPROVED", ...(opts.clubIds ? { id: { in: opts.clubIds } } : {}) }, select: { id: true, name: true, slug: true, status: true } }),
  ]);
  const term = currentOrLastTerm(terms, at);
  const rule = { minEvents: cfg["activity.clubMinEvents"], minMembers: cfg["activity.clubMinMembers"] };
  const out: AtRiskClub[] = [];
  for (const c of clubs) {
    const a = activity.get(c.id);
    const risk = a ? P.clubRisk({ status: c.status, activity: a, at, term, rule }) : null;
    if (risk && a) out.push({ id: c.id, name: c.name, slug: c.slug, ...risk, activity: a });
  }
  return out.sort(P.compareRisk);
}

// ─── Retention ───────────────────────────────────────────────────────────────

/** How many points each period shows by default. */
export const DEFAULT_RETENTION_COUNT: Record<RetentionPeriod, number> = { month: 12, quarter: 8, academicYear: 4, year: 4 };

/**
 * Distinct (club, person, bucket index) rows for check-ins at the clubs' held
 * events inside the buckets. Bucketing happens in SQL (width_bucket over the
 * period starts), so only one row per person per club per period comes back.
 */
async function bucketedAttendance(clubs: ClubScope, buckets: P.PeriodBucket[], at: Date, userId?: string): Promise<{ clubId: string; userId: string; bucket: number }[]> {
  if (buckets.length === 0 || (Array.isArray(clubs) && clubs.length === 0)) return [];
  const lastEnd = new Date(buckets[buckets.length - 1].end.getTime() - 1);
  const to = lastEnd < at ? lastEnd : at;
  const starts = buckets.map((b) => b.start.toISOString());
  const user = userId ? Prisma.sql`AND a."userId" = ${userId}` : Prisma.empty;
  const rows = await db.$queryRaw<{ club_id: string; user_id: string; bucket: number }[]>`
    WITH co AS (${clubOccurrences({ clubs, from: buckets[0].start, to })}),
    bounds AS (
      SELECT ARRAY(SELECT b.t AT TIME ZONE 'UTC' FROM unnest(${starts}::timestamptz[]) WITH ORDINALITY AS b(t, i) ORDER BY b.i) AS starts
    )
    SELECT DISTINCT co.club_id, a."userId" AS user_id, (width_bucket(co.starts_at, bounds.starts) - 1)::int AS bucket
      FROM co CROSS JOIN bounds
      JOIN "Attendance" a ON a."occurrenceId" = co.occurrence_id
     WHERE TRUE ${user}`;
  return rows.map((r) => ({ clubId: r.club_id, userId: r.user_id, bucket: r.bucket }));
}

/**
 * Club retention by period, oldest first, ending with the period that
 * contains `at` (marked inProgress). Each point compares with the period
 * before it; rate is null when that period had no attendees. For the one
 * figure to quote, run the series through latestRetention (with the default
 * month count it's exactly ClubListMetrics.retention).
 */
export async function clubRetention(clubId: string, period: RetentionPeriod, opts: { count?: number; at?: Date } = {}): Promise<RetentionPoint[]> {
  const at = nowOr(opts.at);
  const count = Math.max(1, Math.min(Math.floor(opts.count ?? DEFAULT_RETENTION_COUNT[period]), 120));
  const terms = await getTerms();
  // One extra period in front, so the first point has a "before".
  const buckets = P.lastBuckets(period, at, count + 1, terms);
  if (buckets.length === 0) return [];
  const pairs = await bucketedAttendance([clubId], buckets, at);
  const series = P.retentionSeries(buckets, pairs, at);
  return buckets.length > count ? series.slice(1) : series;
}

/**
 * Month RETENTION for many clubs in one query: the clubs list's buckets are
 * exactly clubRetention(id, "month")'s (DEFAULT_RETENTION_COUNT.month points,
 * plus the one in front), run through the same latestRetention.
 */
async function monthRetentionMany(clubIds: string[], at: Date): Promise<Map<string, RetentionSummary | null>> {
  const buckets = P.lastBuckets("month", at, DEFAULT_RETENTION_COUNT.month + 1);
  const rows = await bucketedAttendance(clubIds, buckets, at);
  const byClub = new Map<string, { userId: string; bucket: number }[]>();
  for (const r of rows) {
    const list = byClub.get(r.clubId);
    if (list) list.push(r);
    else byClub.set(r.clubId, [r]);
  }
  const out = new Map<string, RetentionSummary | null>();
  for (const [clubId, pairs] of byClub) out.set(clubId, P.latestRetention(P.retentionSeries(buckets, pairs, at).slice(1)));
  return out;
}

/** MONTHS ATTENDED and the like for one person in one club: of the periods since they got involved, how many had a check-in of theirs. */
export async function memberPeriodsAttended(userId: string, clubId: string, period: RetentionPeriod): Promise<{ periods: number; attendedPeriods: number; rate: number | null }> {
  const at = requestNow();
  const [membership, standings, terms] = await Promise.all([
    db.membership.findUnique({ where: { userId_clubId: { userId, clubId } }, select: { status: true, joinedAt: true, endedAt: true } }),
    userStandings(userId, at.getTime()),
    getTerms(),
  ]);
  const window = P.involvementWindow(membership, standings.get(clubId), at);
  if (!window) return { periods: 0, attendedPeriods: 0, rate: null };
  const buckets = P.bucketsBetween(period, window.start, window.end, terms);
  if (buckets.length === 0) return { periods: 0, attendedPeriods: 0, rate: null };
  const pairs = await bucketedAttendance([clubId], buckets, at, userId);
  return P.periodsAttended(buckets, pairs.map((p) => p.bucket), at);
}

// ─── Attendance ──────────────────────────────────────────────────────────────

/**
 * Per-occurrence attendance for a club's events (hosted or co-hosted),
 * oldest first. By default every occurrence that has started; pass `to` in
 * the future to include upcoming ones. Occurrences nobody checked in at are
 * included with held: false so the tracker can show the gap.
 */
export async function clubAttendanceByOccurrence(clubId: string, opts: { from?: Date; to?: Date } = {}): Promise<OccurrenceAttendance[]> {
  const to = opts.to ?? requestNow();
  // Student members only (REGISTERED MEMBERS): an advisor's membership isn't a seat to fill.
  const memberAt = Prisma.sql`${memberAtSql("m", Prisma.sql`co.starts_at`)} AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = m."userId" AND u.kind = 'STUDENT')`;
  const rows = await db.$queryRaw<
    { occurrence_id: string; starts_at: Date; event_id: string; title: string; attendees: number; member_attendees: number; members_at_time: number }[]
  >`
    WITH co AS (${clubOccurrences({ clubs: [clubId], from: opts.from, to })})
    SELECT co.occurrence_id, co.starts_at, e.id AS event_id, e.title,
           (SELECT count(*) FROM "Attendance" a WHERE a."occurrenceId" = co.occurrence_id)::int AS attendees,
           (SELECT count(*) FROM "Attendance" a
              JOIN "Membership" m ON m."userId" = a."userId" AND m."clubId" = ${clubId}
             WHERE a."occurrenceId" = co.occurrence_id AND ${memberAt})::int AS member_attendees,
           (SELECT count(*) FROM "Membership" m WHERE m."clubId" = ${clubId} AND ${memberAt})::int AS members_at_time
      FROM co
      JOIN "EventOccurrence" o ON o.id = co.occurrence_id
      JOIN "Event" e ON e.id = o."eventId"
     ORDER BY co.starts_at ASC, co.occurrence_id ASC`;
  return rows.map((r) => {
    const s = P.summarizeOccurrence({ attendees: r.attendees, memberAttendees: r.member_attendees, membersAtTime: r.members_at_time });
    return {
      occurrenceId: r.occurrence_id,
      eventId: r.event_id,
      title: r.title,
      startsAt: r.starts_at,
      attendees: s.attendees,
      memberAttendees: s.memberAttendees,
      guests: s.guests,
      membersAtTime: s.membersAtTime,
      rate: s.rate,
      held: r.attendees > 0,
    };
  });
}

/**
 * Mean member ATTENDANCE RATE over each club's held events in a window — the
 * Attendance Tracker's "Avg. attendance" (lib/analytics averageRate over
 * clubAttendanceByOccurrence), for many clubs in one query. Clubs without a
 * held event with members on the roll get null.
 */
export async function clubAverageAttendance(clubIds: string[], opts: { from?: Date; to?: Date } = {}): Promise<Map<string, number | null>> {
  if (clubIds.length === 0) return new Map();
  const to = opts.to ?? requestNow();
  // Per held event: members at the time (the same rule as clubAttendanceByOccurrence: student
  // memberships, memberAtSql) and how many of them checked in, each as one join + count, so a
  // few hundred clubs' terms take a handful of index scans instead of a query per club.
  const memberAt = memberAtSql("sm", Prisma.sql`h.starts_at`);
  const rows = await db.$queryRaw<{ club_id: string; rate: number | null }[]>`
    WITH co AS (${clubOccurrences({ clubs: clubIds, from: opts.from, to })}),
    held AS MATERIALIZED (SELECT co.* FROM co WHERE ${HAS_CHECKIN(Prisma.sql`co.occurrence_id`)}),
    sm AS MATERIALIZED (
      SELECT m."clubId", m."userId", m."joinedAt", m."endedAt", m.status
        FROM "Membership" m
       WHERE m."clubId" = ANY(${clubIds}::text[]) AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = m."userId" AND u.kind = 'STUDENT')
    ),
    roll AS (
      SELECT h.club_id, h.occurrence_id, count(*)::float8 AS n
        FROM held h JOIN sm ON sm."clubId" = h.club_id AND ${memberAt}
       GROUP BY 1, 2
    ),
    came AS (
      SELECT h.club_id, h.occurrence_id, count(*)::float8 AS n
        FROM held h
        JOIN "Attendance" a ON a."occurrenceId" = h.occurrence_id
        JOIN sm ON sm."clubId" = h.club_id AND sm."userId" = a."userId" AND ${memberAt}
       GROUP BY 1, 2
    )
    SELECT roll.club_id, avg(LEAST(1, coalesce(came.n, 0) / roll.n)) AS rate
      FROM roll LEFT JOIN came USING (club_id, occurrence_id)
     GROUP BY roll.club_id`;
  // A held event with nobody on the roll has no rate (attendanceRate), so it has no roll row.
  const out = new Map<string, number | null>(clubIds.map((id) => [id, null]));
  for (const r of rows) out.set(r.club_id, r.rate === null ? null : Number(r.rate));
  return out;
}

/**
 * Batch attendance for roster tables: person → check-ins at the club's held
 * events (within from/to when given), their latest, and whether they're
 * active now. Includes every ACTIVE member (zeros when they haven't come)
 * and everyone who has attended.
 */
export async function clubMemberAttendanceCounts(clubId: string, opts: { from?: Date; to?: Date } = {}): Promise<Map<string, MemberAttendanceCount>> {
  const at = requestNow();
  const ranged = Boolean(opts.from || opts.to);
  const [all, members, rule, inRange] = await Promise.all([
    clubStandings(clubId, at.getTime()),
    db.membership.findMany({ where: { clubId, status: "ACTIVE" }, select: { userId: true } }),
    activityRule(),
    ranged ? rangedAttendance(clubId, opts.from, opts.to && opts.to < at ? opts.to : at) : Promise.resolve(null),
  ]);
  const ids = new Set<string>([...members.map((m) => m.userId), ...all.keys(), ...(inRange?.keys() ?? [])]);
  const out = new Map<string, MemberAttendanceCount>();
  for (const id of ids) {
    const overall = all.get(id);
    const counted = inRange ? inRange.get(id) : overall ? { attended: overall.attended, lastAt: overall.lastAt } : undefined;
    out.set(id, {
      attended: counted?.attended ?? 0,
      lastAttendedAt: counted?.lastAt ?? null,
      active: P.isActiveStudent(standingOf(overall), at, rule),
    });
  }
  return out;
}

/** HELD EVENTS a club ran or co-hosted, up to `to` (e.g. its retirement date). */
export async function clubHeldEventCount(clubId: string, opts: { to?: Date } = {}): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    WITH co AS (${clubOccurrences({ clubs: [clubId], to: opts.to ?? requestNow() })})
    SELECT count(DISTINCT co.occurrence_id)::int AS n FROM co WHERE ${HAS_CHECKIN(Prisma.sql`co.occurrence_id`)}`;
  return rows[0]?.n ?? 0;
}

/** When each club last HELD an event (hosted or co-hosted), up to now: "No events since March". Clubs that never held one are left out. */
export async function lastHeldEvents(clubIds: string[]): Promise<Map<string, Date>> {
  if (clubIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ club_id: string; last_at: Date }[]>`
    WITH co AS (${clubOccurrences({ clubs: clubIds, to: requestNow() })})
    SELECT co.club_id, max(co.starts_at) AS last_at FROM co WHERE ${HAS_CHECKIN(Prisma.sql`co.occurrence_id`)} GROUP BY co.club_id`;
  return new Map(rows.map((r) => [r.club_id, r.last_at]));
}

/** REGISTERED MEMBERS a retired club had when it retired: the student memberships its retirement made alumni. */
export async function membersAtRetirement(clubIds: string[]): Promise<Map<string, number>> {
  if (clubIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ club_id: string; n: number }[]>`
    SELECT m."clubId" AS club_id, count(*)::int AS n
      FROM "Membership" m
      JOIN "Club" c ON c.id = m."clubId" AND c.status = 'RETIRED'
      JOIN "User" u ON u.id = m."userId" AND u.kind = 'STUDENT'
     WHERE m."clubId" = ANY(${clubIds}::text[]) AND m.status = 'ALUMNI' AND m."endedAt" = c."retiredAt"
     GROUP BY m."clubId"`;
  return new Map(rows.map((r) => [r.club_id, r.n]));
}

async function rangedAttendance(clubId: string, from: Date | undefined, to: Date): Promise<Map<string, { attended: number; lastAt: Date }>> {
  const rows = await db.$queryRaw<{ user_id: string; attended: number; last_at: Date }[]>`
    WITH co AS (${clubOccurrences({ clubs: [clubId], from, to })})
    SELECT a."userId" AS user_id, count(*)::int AS attended, max(co.starts_at) AS last_at
      FROM co JOIN "Attendance" a ON a."occurrenceId" = co.occurrence_id
     GROUP BY a."userId"`;
  return new Map(rows.map((r) => [r.user_id, { attended: r.attended, lastAt: r.last_at }]));
}

// ─── A person's clubs ────────────────────────────────────────────────────────

type MembershipRow = { clubId: string; status: MembershipStatus; joinedAt: Date | null; endedAt: Date | null };

/** The account facts the review gate needs (kind, status), once per request. */
const reviewerAccount = cache((userId: string) => db.user.findUnique({ where: { id: userId }, select: { kind: true, status: true } }));

/**
 * Summaries for one person in the given clubs (all of their clubs when
 * `onlyClubId` is null): their ACTIVE memberships plus every club whose
 * events they've attended.
 */
async function summariesFor(userId: string, onlyClubId: string | null, at: Date): Promise<Map<string, { summary: MemberClubSummary; membership: MembershipRow | null }>> {
  const [memberships, standings, cfg, rule, account] = await Promise.all([
    db.membership.findMany({
      where: { userId, ...(onlyClubId ? { clubId: onlyClubId } : {}) },
      select: { clubId: true, status: true, joinedAt: true, endedAt: true },
    }),
    userStandings(userId, at.getTime()),
    getConfig(),
    activityRule(),
    reviewerAccount(userId),
  ]);
  const byClub = new Map(memberships.map((m) => [m.clubId, m]));
  const clubIds = onlyClubId
    ? [onlyClubId]
    : [...new Set([...memberships.filter((m) => m.status === "ACTIVE").map((m) => m.clubId), ...standings.keys()])];

  const windows = new Map<string, { start: Date; end: Date }>();
  for (const id of clubIds) {
    const w = P.involvementWindow(byClub.get(id), standings.get(id), at);
    if (w) windows.set(id, w);
  }
  const held = await heldBetween(windows, at);
  const threshold = cfg["reviews.minAttendance"];

  const out = new Map<string, { summary: MemberClubSummary; membership: MembershipRow | null }>();
  for (const id of clubIds) {
    const s = standings.get(id);
    const attended = s?.attended ?? 0;
    const heldSinceJoined = held.get(id) ?? 0;
    const gate = P.reviewGate(account, attended, threshold);
    out.set(id, {
      membership: byClub.get(id) ?? null,
      summary: {
        attended,
        heldSinceJoined,
        rate: heldSinceJoined > 0 ? Math.min(1, attended / heldSinceJoined) : null,
        lastAttendedAt: s?.lastAt ?? null,
        active: P.isActiveStudent(standingOf(s), at, rule),
        canReview: gate.canReview,
        reviewEligible: gate.eligible,
        reviewThreshold: threshold,
      },
    });
  }
  return out;
}

/** Held events per club inside per-club time windows, in one query. */
async function heldBetween(windows: Map<string, { start: Date; end: Date }>, at: Date): Promise<Map<string, number>> {
  if (windows.size === 0) return new Map();
  const ids = [...windows.keys()];
  const starts = ids.map((id) => windows.get(id)!.start.toISOString());
  const ends = ids.map((id) => windows.get(id)!.end.toISOString());
  const rows = await db.$queryRaw<{ club_id: string; held: number }[]>`
    WITH win AS (
      SELECT w.club_id, (w.s AT TIME ZONE 'UTC') AS s, (w.e AT TIME ZONE 'UTC') AS e
        FROM unnest(${ids}::text[], ${starts}::timestamptz[], ${ends}::timestamptz[]) AS w(club_id, s, e)
    ),
    co AS (${clubOccurrences({ clubs: ids, to: at })})
    SELECT win.club_id, count(*)::int AS held
      FROM win JOIN co ON co.club_id = win.club_id AND co.starts_at >= win.s AND co.starts_at <= win.e
     WHERE ${HAS_CHECKIN(Prisma.sql`co.occurrence_id`)}
     GROUP BY win.club_id`;
  return new Map(rows.map((r) => [r.club_id, r.held]));
}

const memberSummaryCached = cache(async (userId: string, clubId: string, atMs: number) => {
  const map = await summariesFor(userId, clubId, new Date(atMs));
  return map.get(clubId)!.summary;
});

export async function memberClubSummary(userId: string, clubId: string): Promise<MemberClubSummary> {
  return memberSummaryCached(userId, clubId, requestNow().getTime());
}

/**
 * Every club a person is a member of or has attended, with their summary in
 * each. Current members first, then clubs they've visited or left; each
 * group alphabetical.
 */
export const memberClubSummaries = cache(async (userId: string): Promise<MemberClubSummaryEntry[]> => {
  const map = await summariesFor(userId, null, requestNow());
  if (map.size === 0) return [];
  const clubs = await db.club.findMany({
    where: { id: { in: [...map.keys()] } },
    select: { id: true, name: true, slug: true, logoColor: true, logoUrl: true },
  });
  return clubs
    .map((club) => {
      const entry = map.get(club.id)!;
      return { club, summary: entry.summary, membershipStatus: entry.membership?.status ?? null };
    })
    .sort((a, b) => Number(b.membershipStatus === "ACTIVE") - Number(a.membershipStatus === "ACTIVE") || a.club.name.localeCompare(b.club.name));
});

/** Review gate: is this an active student who has attended at least `reviews.minAttendance` of the club's events? */
export async function reviewEligibility(userId: string, clubId: string): Promise<{ eligible: boolean; canReview: boolean; attended: number; required: number }> {
  const [standings, cfg, account] = await Promise.all([userStandings(userId, requestNow().getTime()), getConfig(), reviewerAccount(userId)]);
  const attended = standings.get(clubId)?.attended ?? 0;
  const required = cfg["reviews.minAttendance"];
  return { ...P.reviewGate(account, attended, required), attended, required };
}

// ─── Clubs list ──────────────────────────────────────────────────────────────

const clubListMap = cache(async (key: string, atMs: number): Promise<Map<string, ClubListMetrics>> => {
  const at = new Date(atMs);
  const activity = await clubActivityMap(key, atMs);
  const ids = [...activity.keys()];
  const out = new Map<string, ClubListMetrics>();
  if (ids.length === 0) return out;

  const [reviews, retentionBy, recent] = await Promise.all([
    db.review.groupBy({ by: ["clubId"], where: { clubId: { in: ids }, hiddenAt: null }, _avg: { rating: true }, _count: { _all: true } }),
    monthRetentionMany(ids, at),
    // The ACTIVITY SCORE's facts: every occurrence in its window, and whether anyone checked in.
    db.$queryRaw<{ club_id: string; starts_at: Date; has_checkin: boolean }[]>`
      SELECT co.club_id, co.starts_at, ${HAS_CHECKIN(Prisma.sql`co.occurrence_id`)} AS has_checkin
        FROM (${clubOccurrences({ clubs: ids, from: new Date(atMs - P.ACTIVITY_SCORE_DAYS * DAY_MS), to: at })}) co`,
  ]);
  const reviewBy = new Map(reviews.map((r) => [r.clubId, r]));
  const factsBy = new Map<string, P.OccurrenceFact[]>();
  for (const r of recent) {
    const fact = { startsAt: r.starts_at, hasCheckin: r.has_checkin };
    const list = factsBy.get(r.club_id);
    if (list) list.push(fact);
    else factsBy.set(r.club_id, [fact]);
  }

  for (const [id, a] of activity) {
    const r = reviewBy.get(id);
    const retention = retentionBy.get(id) ?? null;
    out.set(id, {
      clubId: id,
      registeredMembers: a.registeredMembers,
      activeMembers: a.activeMembers,
      retention,
      retentionRate: retention?.rate ?? null,
      avgRating: r?._count._all ? (r._avg.rating ?? null) : null,
      reviewCount: r?._count._all ?? 0,
      activityScore: P.activityScore(factsBy.get(id) ?? [], at),
      isActive: a.active,
      inPilot: a.inPilot,
    });
  }
  return out;
});

const SHARED_LIST_MS = 60_000;
/** Above this many clubs, one shared build of every club's numbers is cheaper than a fresh pass. */
const SHARED_LIST_MIN_IDS = 20;

// The clubs list (and its search ranking), the network and the admin tables
// all read nearly every approved club's numbers, so one build serves every
// visitor for a minute, the same way networkData does.
let sharedList: { expires: number; data: Promise<Map<string, ClubListMetrics>> } | null = null;

function everyClubListMetrics(): Promise<Map<string, ClubListMetrics>> {
  const now = Date.now();
  if (!sharedList || sharedList.expires <= now) {
    const data = clubListMap("*", now);
    sharedList = { expires: now + SHARED_LIST_MS, data };
    data.catch(() => {
      if (sharedList?.data === data) sharedList = null;
    });
  }
  return sharedList.data;
}

/**
 * Batch metrics for the clubs list and admin tables (one pass, no N+1). Omit
 * ids for every approved club. Large requests read the shared build (at most a
 * minute old); small ones use it only when it's already warm. Clubs it doesn't
 * cover (retired ones) are computed fresh.
 */
export async function clubListMetrics(clubIds?: string[]): Promise<Map<string, ClubListMetrics>> {
  const warm = sharedList && sharedList.expires > Date.now();
  if (!clubIds || clubIds.length > SHARED_LIST_MIN_IDS || warm) {
    const all = await everyClubListMetrics();
    if (!clubIds) return all;
    const out = new Map<string, ClubListMetrics>();
    const missing: string[] = [];
    for (const id of clubIds) {
      const m = all.get(id);
      if (m) out.set(id, m);
      else missing.push(id);
    }
    if (missing.length) for (const [id, m] of await clubListMap(idsKey(missing), requestNow().getTime())) out.set(id, m);
    return out;
  }
  return clubListMap(idsKey(clubIds), requestNow().getTime());
}

// ─── Interconnection network ─────────────────────────────────────────────────

type NetworkCounts = { directed: P.PairCount[]; overlaps: P.PairCount[]; sizes: Map<string, number>; crossClubCheckins: number };

/**
 * One row per check-in in the window with its event's participating clubs
 * (host + approved co-hosts) as an array. Built from the base tables rather
 * than CTEs so the planner has real statistics to pick hash joins with.
 */
function checkinsWithClubs(from: Date, to: Date, extra: { select: Prisma.Sql; join: Prisma.Sql }) {
  return Prisma.sql`
    SELECT a.id AS checkin_id, ${extra.select},
           array_remove(ARRAY[e."clubId"] || COALESCE(co.ids, ARRAY[]::text[]), NULL) AS clubs
      FROM "Attendance" a
      JOIN "EventOccurrence" o ON o.id = a."occurrenceId"
      JOIN "Event" e ON e.id = o."eventId"
      ${extra.join}
      LEFT JOIN LATERAL (
        SELECT array_agg(c."clubId") AS ids FROM "EventCohost" c
         WHERE c."eventId" = e.id AND c.status = 'APPROVED' AND c."clubId" IS DISTINCT FROM e."clubId"
      ) co ON TRUE
     WHERE o.status = 'SCHEDULED' AND o."startsAt" >= ${ts(from)} AND o."startsAt" <= ${ts(to)}`;
}

/**
 * Cross-club attendance in a window, aggregated in the database so only a
 * row per pair of clubs comes back however many check-ins there are:
 *   directed  check-ins per (member club M → participating club X), M ≠ X —
 *             guest visits (no club of theirs participates), or co-hosted events
 *             where M is one of the participating clubs
 *   overlap   check-ins by someone in two of the participating clubs
 *   cross     check-ins that drew at least one line (only when asked)
 *   sizes     check-ins at each club's events (hosted or co-hosted)
 * P.linesFromCounts turns directed + overlap into line weights.
 */
async function networkCounts(from: Date, to: Date, withCross = false): Promise<NetworkCounts> {
  const mem = checkinsWithClubs(from, to, {
    select: Prisma.sql`m."clubId" AS m_club`,
    join: Prisma.sql`JOIN "Membership" m ON m."userId" = a."userId" AND ${memberAtSql("m", Prisma.sql`o."startsAt"`)}`,
  });
  // A check-in draws a line when it's a guest visit (none of the attendee's clubs
  // put on the event) or the event is co-hosted. Attending your own club's
  // regular meeting is not inter-club activity, even if you belong to others.
  const cross = withCross
    ? Prisma.sql`UNION ALL
      SELECT 'cross', NULL, NULL, count(*)::int
        FROM (SELECT 1 FROM memf WHERE NOT memf.own OR cardinality(memf.clubs) > 1 GROUP BY memf.checkin_id) t`
    : Prisma.empty;
  const [pairs, sizes] = await Promise.all([
    db.$queryRaw<{ kind: "directed" | "overlap" | "cross"; a: string | null; b: string | null; n: number }[]>`
      WITH mem AS (${mem}),
      memf AS (SELECT mem.*, bool_or(mem.m_club = ANY(mem.clubs)) OVER (PARTITION BY mem.checkin_id) AS own FROM mem)
      SELECT 'directed' AS kind, memf.m_club AS a, x.club AS b, count(*)::int AS n
        FROM memf, unnest(memf.clubs) AS x(club)
       WHERE x.club <> memf.m_club AND (NOT memf.own OR memf.m_club = ANY(memf.clubs))
       GROUP BY 2, 3
      UNION ALL
      SELECT 'overlap', t.ins[i], t.ins[j], count(*)::int
        FROM (
          SELECT array_agg(mem.m_club) AS ins FROM mem
           WHERE cardinality(mem.clubs) > 1 AND mem.m_club = ANY(mem.clubs)
           GROUP BY mem.checkin_id HAVING count(*) > 1
        ) t, generate_subscripts(t.ins, 1) AS i, generate_subscripts(t.ins, 1) AS j
       WHERE i < j
       GROUP BY 2, 3
      ${cross}`,
    db.$queryRaw<{ club_id: string; n: number }[]>`
      SELECT x.club AS club_id, count(*)::int AS n
        FROM (${checkinsWithClubs(from, to, { select: Prisma.sql`a."userId"`, join: Prisma.empty })}) chk, unnest(chk.clubs) AS x(club)
       GROUP BY 1`,
  ]);
  const out: NetworkCounts = { directed: [], overlaps: [], sizes: new Map(sizes.map((r) => [r.club_id, r.n])), crossClubCheckins: 0 };
  for (const r of pairs) {
    if (r.kind === "directed" && r.a && r.b) out.directed.push({ a: r.a, b: r.b, count: r.n });
    else if (r.kind === "overlap" && r.a && r.b) out.overlaps.push({ a: r.a, b: r.b, count: r.n });
    else if (r.kind === "cross") out.crossClubCheckins = r.n;
  }
  return out;
}

async function buildNetwork(since: Date, until: Date): Promise<NetworkData> {
  const clubs = await db.club.findMany({
    where: { status: "APPROVED" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      logoColor: true,
      collegeId: true,
      focusOther: true,
      college: { select: { name: true } },
      department: { select: { name: true } },
      focusMajor: { select: { name: true } },
    },
  });
  if (clubs.length === 0) return { nodes: [], edges: [], since, until };
  const ids = clubs.map((c) => c.id);
  const [counts, members] = await Promise.all([networkCounts(since, until), registeredCounts(ids)]);
  const edges = P.linesFromCounts(counts.directed, counts.overlaps, new Set(ids));
  const sizes = counts.sizes;
  const nodes: NetworkNode[] = clubs.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    type: c.type,
    logoColor: c.logoColor,
    collegeId: c.collegeId,
    collegeName: c.college?.name ?? null,
    departmentName: c.department?.name ?? null,
    majorName: c.focusMajor?.name ?? c.focusOther ?? null,
    size: sizes.get(c.id) ?? 0,
    members: members.get(c.id) ?? 0,
  }));
  return { nodes, edges, since, until };
}

const networkForWindow = cache((sinceMs: number, untilMs: number) => buildNetwork(new Date(sinceMs), new Date(untilMs)));

/** Default network window: the last year, so the canvas shows today's connections. */
export const NETWORK_DEFAULT_DAYS = 365;
/** How long the default canvas is shared between visitors before it's rebuilt. */
const SHARED_NETWORK_MS = 60_000;

// The default canvas is public and the same for everyone, and it's the
// heaviest query here, so one build serves every visitor for a minute.
let sharedNetwork: { expires: number; data: Promise<NetworkData> } | null = null;

/** Every approved club as a node, linked by cross-club attendance in the window (default: the last 365 days). */
export async function networkData(opts: { since?: Date; until?: Date } = {}): Promise<NetworkData> {
  if (!opts.since && !opts.until) {
    const now = Date.now();
    if (!sharedNetwork || sharedNetwork.expires <= now) {
      const data = buildNetwork(new Date(now - NETWORK_DEFAULT_DAYS * DAY_MS), new Date(now));
      sharedNetwork = { expires: now + SHARED_NETWORK_MS, data };
      data.catch(() => {
        if (sharedNetwork?.data === data) sharedNetwork = null;
      });
    }
    return sharedNetwork.data;
  }
  const until = opts.until ?? requestNow();
  const since = opts.since ?? new Date(until.getTime() - NETWORK_DEFAULT_DAYS * DAY_MS);
  return networkForWindow(since.getTime(), until.getTime());
}

// ─── Platform ────────────────────────────────────────────────────────────────

const platformCached = cache(async (atMs: number): Promise<PlatformSummary> => {
  const at = new Date(atMs);
  const terms = await getTerms();
  const term = currentOrLastTerm(terms, at);
  const termStart = term?.startsOn ?? null;
  const termStop = term ? new Date(Math.min(P.termEnd(term).getTime(), atMs)) : null;
  const months = P.lastBuckets("month", at, 12);

  const [statusGroups, activity, students, activeByClub, termCounts, network, monthly] = await Promise.all([
    db.club.groupBy({ by: ["status"], _count: { _all: true } }),
    clubActivityMap("*", atMs),
    db.user.count({ where: { kind: "STUDENT", status: "ACTIVE" } }),
    activeAttendees("*", atMs, false, true),
    termStart && termStop
      ? db.$queryRaw<{ checkins: number; events: number }[]>`
          SELECT count(a.id)::int AS checkins, count(DISTINCT o.id)::int AS events
            FROM "EventOccurrence" o
            JOIN "Event" e ON e.id = o."eventId"
            JOIN "Attendance" a ON a."occurrenceId" = o.id
           WHERE o.status = 'SCHEDULED'
             AND o."startsAt" >= ${ts(termStart)} AND o."startsAt" <= ${ts(termStop)}`
      : Promise.resolve([{ checkins: 0, events: 0 }]),
    termStart && termStop ? networkCounts(termStart, termStop, true) : Promise.resolve(null),
    // Per (campus month, person) first, so unique attendees don't need a sort-heavy count(DISTINCT).
    db.$queryRaw<{ key: string; checkins: number; unique_attendees: number }[]>`
      SELECT to_char(t.month, 'YYYY-MM') AS key, sum(t.n)::int AS checkins, count(*)::int AS unique_attendees
        FROM (
          SELECT date_trunc('month', (o."startsAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}) AS month, a."userId", count(*) AS n
            FROM "Attendance" a
            JOIN "EventOccurrence" o ON o.id = a."occurrenceId"
            JOIN "Event" e ON e.id = o."eventId"
           WHERE o.status = 'SCHEDULED'
             AND o."startsAt" >= ${ts(months[0].start)} AND o."startsAt" <= ${ts(at)}
           GROUP BY 1, 2
        ) t
       GROUP BY t.month`,
  ]);

  const clubsByStatus: Record<string, number> = {};
  for (const g of statusGroups) clubsByStatus[g.status] = g._count._all;

  let activeClubs = 0;
  let pilotClubs = 0;
  let inactiveClubs = 0;
  for (const a of activity.values()) {
    if (a.active) activeClubs++;
    else inactiveClubs++;
    if (a.inPilot) pilotClubs++;
  }

  const activeStudentIds = new Set<string>();
  for (const set of activeByClub.values()) for (const id of set) activeStudentIds.add(id);

  const byMonth = new Map(monthly.map((m) => [m.key, m]));
  return {
    clubsByStatus,
    activeClubs,
    pilotClubs,
    inactiveClubs,
    students,
    activeStudents: activeStudentIds.size,
    checkinsThisTerm: termCounts[0]?.checkins ?? 0,
    eventsThisTerm: termCounts[0]?.events ?? 0,
    crossClubCheckinsThisTerm: network?.crossClubCheckins ?? 0,
    monthlyCheckins: months.map((b) => ({ month: b.label, checkins: byMonth.get(b.key)?.checkins ?? 0, uniqueAttendees: byMonth.get(b.key)?.unique_attendees ?? 0 })),
    termName: term?.name ?? null,
  };
});

/** How long the landing page's platform numbers are shared between visitors before they're rebuilt. */
const SHARED_PLATFORM_MS = 10 * 60_000;

// The landing page shows the same campus-wide numbers to everyone, and they
// barely move minute to minute, so one build serves every visitor for ten
// minutes, the way networkData shares the default canvas.
let sharedPlatform: { expires: number; data: Promise<PlatformSummary> } | null = null;

/**
 * Platform-wide numbers. "This term" is the current term (or the last one,
 * between terms) up to `at`; events = held events. With no `at` (the public
 * landing page) one build is shared between visitors for ten minutes; pass
 * `at` (the admin Overview does) for numbers as of that instant.
 */
export async function platformSummary(at?: Date): Promise<PlatformSummary> {
  if (at) return platformCached(at.getTime());
  const now = Date.now();
  if (!sharedPlatform || sharedPlatform.expires <= now) {
    const data = platformCached(now);
    sharedPlatform = { expires: now + SHARED_PLATFORM_MS, data };
    data.catch(() => {
      if (sharedPlatform?.data === data) sharedPlatform = null;
    });
  }
  return sharedPlatform.data;
}

// ─── Service hours ───────────────────────────────────────────────────────────

/**
 * A person's SERVICE HOURS: every check-in of theirs at an event that counts,
 * summed now, by host club and by term, with each date (the rule is in
 * ./service.ts). The involvement record and its PDF, the verify page,
 * profiles, the assistant and the app all read this.
 */
export const serviceSummary = cache(async (userId: string): Promise<ServiceSummary> => {
  const [rows, terms] = await Promise.all([
    db.attendance.findMany({
      where: { userId, occurrence: { event: { serviceMinutes: { gt: 0 } } } },
      select: {
        id: true,
        occurrence: {
          select: {
            id: true,
            startsAt: true,
            event: {
              select: {
                id: true,
                title: true,
                serviceMinutes: true,
                club: { select: { id: true, name: true, slug: true } },
                cohosts: { where: { status: "APPROVED" }, orderBy: { createdAt: "asc" }, select: { club: { select: { id: true, name: true, slug: true } } } },
              },
            },
          },
        },
      },
    }),
    getTerms(),
  ]);
  return summarizeService(
    rows.map(({ id, occurrence: o }) => ({
      attendanceId: id,
      occurrenceId: o.id,
      eventId: o.event.id,
      title: o.event.title,
      startsAt: o.startsAt,
      serviceMinutes: o.event.serviceMinutes,
      club: o.event.club,
      cohosts: o.event.cohosts.map((c) => c.club),
    })),
    terms,
  );
});

/** Check-ins that earn service hours (date window by event start), with their event, host and minutes. */
function earnedCheckins(o: { from?: Date; to?: Date }) {
  const from = o.from ? Prisma.sql`AND o."startsAt" >= ${ts(o.from)}` : Prisma.empty;
  const to = o.to ? Prisma.sql`AND o."startsAt" <= ${ts(o.to)}` : Prisma.empty;
  return Prisma.sql`
    SELECT a.id AS attendance_id, o.id AS occurrence_id, o."startsAt" AS starts_at, e.id AS event_id, e."clubId" AS host_id, e."serviceMinutes" AS minutes
      FROM "Attendance" a
      JOIN "EventOccurrence" o ON o.id = a."occurrenceId"
      JOIN "Event" e ON e.id = o."eventId"
     WHERE e."serviceMinutes" > 0 ${from} ${to}`;
}

/**
 * Service hours earned at each club's events in a window (by the date's
 * start), hosted or co-hosted, the way held events count for every club
 * that put one on. Every club asked for is in the map (zeros when none).
 * Club analytics' "Service hours (this term)".
 */
export async function clubServiceTotals(clubIds: string[], opts: { from?: Date; to?: Date } = {}): Promise<Map<string, ServiceTotal>> {
  const out = new Map<string, ServiceTotal>(clubIds.map((id) => [id, { minutes: 0, events: 0 }]));
  if (clubIds.length === 0) return out;
  const rows = await db.$queryRaw<{ club_id: string; minutes: number; events: number }[]>`
    WITH earned AS (${earnedCheckins(opts)}),
    credited AS (
      SELECT host_id AS club_id, minutes FROM earned WHERE host_id IS NOT NULL
      UNION ALL
      SELECT c."clubId", earned.minutes
        FROM earned JOIN "EventCohost" c ON c."eventId" = earned.event_id AND c.status = 'APPROVED' AND c."clubId" IS DISTINCT FROM earned.host_id
    )
    SELECT club_id, sum(minutes)::int AS minutes, count(*)::int AS events
      FROM credited
     WHERE club_id = ANY(${clubIds}::text[])
     GROUP BY club_id`;
  for (const r of rows) out.set(r.club_id, { minutes: r.minutes, events: r.events });
  return out;
}

/**
 * Service hours per term, newest first: everyone's, or only at these clubs'
 * events (hosted or co-hosted; an event shared by two of them counts once).
 * Terms follow ./service.ts serviceTermOf, the same as a person's record.
 */
export async function serviceTotalsByTerm(opts: { clubIds?: string[] } = {}): Promise<ServiceTermTotal[]> {
  const clubs = opts.clubIds;
  const inClubs = clubs
    ? Prisma.sql`WHERE earned.host_id = ANY(${clubs}::text[]) OR EXISTS (SELECT 1 FROM "EventCohost" c WHERE c."eventId" = earned.event_id AND c.status = 'APPROVED' AND c."clubId" = ANY(${clubs}::text[]))`
    : Prisma.empty;
  const [rows, terms] = await Promise.all([
    db.$queryRaw<{ starts_at: Date; minutes: number; events: number }[]>`
      WITH earned AS (${earnedCheckins({})})
      SELECT earned.starts_at, sum(earned.minutes)::int AS minutes, count(*)::int AS events
        FROM earned ${inClubs}
       GROUP BY earned.occurrence_id, earned.starts_at`,
    getTerms(),
  ]);
  return totalsByTerm(rows.map((r) => ({ startsAt: r.starts_at, minutes: r.minutes, events: r.events })), terms);
}
