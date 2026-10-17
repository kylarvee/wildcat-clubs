import "server-only";
import { cache } from "react";
import { Prisma, type MembershipStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { currentOrLastTerm, getTerms, previousActivityTerm } from "@/lib/terms";
import { DAY_MS, TZ } from "@/lib/time";
import * as P from "./pure";
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
 * ACTIVE CLUB — status APPROVED and either in its PILOT PERIOD, or
 *   (≥ `activity.clubMinEvents` (2) held events in the current term or the
 *   previous activity term) AND ≥ `activity.clubMinMembers` (8) registered
 *   (ACTIVE) members.
 *
 * PILOT PERIOD — from approval (or creation if never approved) until the end
 *   of the first full activity-counting term that starts after the club was
 *   created. Created mid-Fall → pilot runs through Spring.
 *
 * ATTENDANCE RATE (event) — members who checked in ÷ ACTIVE members at the
 *   time of the event (joinedAt ≤ start, not ended before it). Non-member
 *   attendees are counted separately as guests.
 *
 * RETENTION (period P) — of the people who attended ≥1 club event in the
 *   period before P, the share who attended ≥1 in P. Periods: calendar month,
 *   calendar quarter, academic year (from Terms), calendar year.
 *   Individual retention = the share of periods since joining with ≥1 check-in.
 *
 * ACTIVITY SCORE (clubs list "Activity") — scheduled occurrences in the last
 *   30 days plus the next 30 days.
 *
 * INTERCONNECTION — for each check-in at an event whose participating clubs
 *   are P (host + approved co-hosts): a guest visit (none of the attendee's
 *   clubs is in P) adds 1 to edge (M, X) for each of their clubs M and each X
 *   in P; at one of their own clubs' events, only edges between their clubs in
 *   P and the other clubs in P (co-hosting) count.
 *   Node size = check-ins at the club's events. Centrality emerges from the
 *   force layout; nothing is placed by hand.
 *
 * The rules themselves live in ./pure.ts (unit-tested); this file gathers the
 * facts they decide on with batched SQL. Signatures here are a contract.
 *
 * Details settled while building (see pure.ts for each rule):
 * - Event times are occurrence start times, so a leader's late manual add
 *   counts on the day of the event.
 * - Occurrences of draft events never count; past occurrences of an event
 *   that was later cancelled still count when people checked in. Activity
 *   score counts only live (SCHEDULED) events.
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
  checkinLines,
  type ActivityRule,
  type Standing,
} from "./pure";

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
 * scheduled occurrence — the host and every approved co-host. Draft events
 * never count; `liveOnly` also drops cancelled events (for calendar counts).
 */
function clubOccurrences(o: { clubs?: ClubScope; from?: Date; to?: Date; liveOnly?: boolean }): Prisma.Sql {
  const ev = o.liveOnly ? Prisma.sql`e.status = 'SCHEDULED'` : Prisma.sql`e.status <> 'DRAFT'`;
  const from = o.from ? Prisma.sql`AND o."startsAt" >= ${ts(o.from)}` : Prisma.empty;
  const to = o.to ? Prisma.sql`AND o."startsAt" <= ${ts(o.to)}` : Prisma.empty;
  return Prisma.sql`
    SELECT o.id AS occurrence_id, o."startsAt" AS starts_at, e."clubId" AS club_id
      FROM "EventOccurrence" o JOIN "Event" e ON e.id = o."eventId"
     WHERE o.status = 'SCHEDULED' AND ${ev} AND e."clubId" IS NOT NULL ${inClubs(Prisma.sql`e."clubId"`, o.clubs)} ${from} ${to}
    UNION
    SELECT o.id, o."startsAt", c."clubId"
      FROM "EventOccurrence" o JOIN "Event" e ON e.id = o."eventId"
      JOIN "EventCohost" c ON c."eventId" = e.id AND c.status = 'APPROVED'
     WHERE o.status = 'SCHEDULED' AND ${ev} ${inClubs(Prisma.sql`c."clubId"`, o.clubs)} ${from} ${to}`;
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
  const member = o.activeMembersOnly
    ? Prisma.sql`JOIN "Membership" m ON m."userId" = a."userId" AND m."clubId" = h.club_id AND m.status = 'ACTIVE'`
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

/** Ids of ACTIVE-membership users who are active per the definition. */
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

// ─── Retention ───────────────────────────────────────────────────────────────

/** How many points each period shows by default. */
export const DEFAULT_RETENTION_COUNT: Record<RetentionPeriod, number> = { month: 12, quarter: 8, academicYear: 4, year: 4 };

/**
 * Distinct (person, bucket index) pairs for check-ins at a club's held events
 * inside the buckets. Bucketing happens in SQL (width_bucket over the period
 * starts), so only one row per person per period comes back.
 */
async function bucketedAttendance(clubId: string, buckets: P.PeriodBucket[], at: Date, userId?: string): Promise<{ userId: string; bucket: number }[]> {
  if (buckets.length === 0) return [];
  const lastEnd = new Date(buckets[buckets.length - 1].end.getTime() - 1);
  const to = lastEnd < at ? lastEnd : at;
  const starts = buckets.map((b) => b.start.toISOString());
  const user = userId ? Prisma.sql`AND a."userId" = ${userId}` : Prisma.empty;
  const rows = await db.$queryRaw<{ user_id: string; bucket: number }[]>`
    WITH co AS (${clubOccurrences({ clubs: [clubId], from: buckets[0].start, to })}),
    bounds AS (
      SELECT ARRAY(SELECT b.t AT TIME ZONE 'UTC' FROM unnest(${starts}::timestamptz[]) WITH ORDINALITY AS b(t, i) ORDER BY b.i) AS starts
    )
    SELECT DISTINCT a."userId" AS user_id, (width_bucket(co.starts_at, bounds.starts) - 1)::int AS bucket
      FROM co CROSS JOIN bounds
      JOIN "Attendance" a ON a."occurrenceId" = co.occurrence_id
     WHERE TRUE ${user}`;
  return rows.map((r) => ({ userId: r.user_id, bucket: r.bucket }));
}

/**
 * Club retention by period, oldest first, ending with the period that
 * contains `at` (marked inProgress). Each point compares with the period
 * before it; rate is null when that period had no attendees.
 */
export async function clubRetention(clubId: string, period: RetentionPeriod, opts: { count?: number; at?: Date } = {}): Promise<RetentionPoint[]> {
  const at = nowOr(opts.at);
  const count = Math.max(1, Math.min(Math.floor(opts.count ?? DEFAULT_RETENTION_COUNT[period]), 120));
  const terms = await getTerms();
  // One extra period in front, so the first point has a "before".
  const buckets = P.lastBuckets(period, at, count + 1, terms);
  if (buckets.length === 0) return [];
  const pairs = await bucketedAttendance(clubId, buckets, at);
  const series = P.retentionSeries(buckets, pairs, at);
  return buckets.length > count ? series.slice(1) : series;
}

/** Retention for one person in one club (periods since joining with ≥1 check-in ÷ periods since joining). */
export async function memberRetention(userId: string, clubId: string, period: RetentionPeriod): Promise<{ periods: number; attendedPeriods: number; rate: number | null }> {
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
  const pairs = await bucketedAttendance(clubId, buckets, at, userId);
  return P.individualRetention(buckets, pairs.map((p) => p.bucket), at);
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
  const memberAt = memberAtSql("m", Prisma.sql`co.starts_at`);
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

/**
 * Summaries for one person in the given clubs (all of their clubs when
 * `onlyClubId` is null): their ACTIVE memberships plus every club whose
 * events they've attended.
 */
async function summariesFor(userId: string, onlyClubId: string | null, at: Date): Promise<Map<string, { summary: MemberClubSummary; membership: MembershipRow | null }>> {
  const [memberships, standings, cfg, rule] = await Promise.all([
    db.membership.findMany({
      where: { userId, ...(onlyClubId ? { clubId: onlyClubId } : {}) },
      select: { clubId: true, status: true, joinedAt: true, endedAt: true },
    }),
    userStandings(userId, at.getTime()),
    getConfig(),
    activityRule(),
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
    out.set(id, {
      membership: byClub.get(id) ?? null,
      summary: {
        attended,
        heldSinceJoined,
        rate: heldSinceJoined > 0 ? Math.min(1, attended / heldSinceJoined) : null,
        lastAttendedAt: s?.lastAt ?? null,
        active: P.isActiveStudent(standingOf(s), at, rule),
        reviewEligible: attended >= threshold,
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

/** Review gate: has this student attended at least `reviews.minAttendance` of the club's events? */
export async function reviewEligibility(userId: string, clubId: string): Promise<{ eligible: boolean; attended: number; required: number }> {
  const [standings, cfg] = await Promise.all([userStandings(userId, requestNow().getTime()), getConfig()]);
  const attended = standings.get(clubId)?.attended ?? 0;
  const required = cfg["reviews.minAttendance"];
  return { eligible: attended >= required, attended, required };
}

// ─── Clubs list ──────────────────────────────────────────────────────────────

const clubListMap = cache(async (key: string, atMs: number): Promise<Map<string, ClubListMetrics>> => {
  const at = new Date(atMs);
  const activity = await clubActivityMap(key, atMs);
  const ids = [...activity.keys()];
  const out = new Map<string, ClubListMetrics>();
  if (ids.length === 0) return out;

  // Month retention for the list: the last complete month vs. the one before. Clubs
  // rarely meet over summer or breaks, so when that earlier month had nobody, fall
  // back to the current month vs. last month, then to the pair before.
  const buckets = P.lastBuckets("month", at, 4); // [m-3, m-2, m-1, current]
  const [reviews, attendRows, scores] = await Promise.all([
    db.review.groupBy({ by: ["clubId"], where: { clubId: { in: ids }, hiddenAt: null }, _avg: { rating: true }, _count: { _all: true } }),
    db.$queryRaw<{ club_id: string; user_id: string; starts_at: Date }[]>`
      SELECT DISTINCT co.club_id, a."userId" AS user_id, co.starts_at
        FROM (${clubOccurrences({ clubs: ids, from: buckets[0].start, to: at })}) co
        JOIN "Attendance" a ON a."occurrenceId" = co.occurrence_id`,
    db.$queryRaw<{ club_id: string; n: number }[]>`
      SELECT co.club_id, count(*)::int AS n
        FROM (${clubOccurrences({ clubs: ids, from: new Date(atMs - 30 * DAY_MS), to: new Date(atMs + 30 * DAY_MS), liveOnly: true })}) co
       GROUP BY co.club_id`,
  ]);
  const reviewBy = new Map(reviews.map((r) => [r.clubId, r]));
  const attendeesBy = new Map<string, Set<string>[]>();
  for (const row of attendRows) {
    const i = buckets.findIndex((b) => row.starts_at >= b.start && row.starts_at < b.end);
    if (i < 0) continue;
    const sets = attendeesBy.get(row.club_id) ?? buckets.map(() => new Set<string>());
    sets[i].add(row.user_id);
    attendeesBy.set(row.club_id, sets);
  }
  const retentionBy = new Map<string, { previous: number; retained: number }>();
  for (const [clubId, sets] of attendeesBy) {
    // Preference order of [previous, later] month pairs.
    for (const [p, l] of [[1, 2], [2, 3], [0, 1]] as const) {
      if (sets[p].size === 0) continue;
      retentionBy.set(clubId, { previous: sets[p].size, retained: [...sets[p]].filter((u) => sets[l].has(u)).length });
      break;
    }
  }
  const scoreBy = new Map(scores.map((r) => [r.club_id, r.n]));

  for (const [id, a] of activity) {
    const r = reviewBy.get(id);
    const ret = retentionBy.get(id);
    out.set(id, {
      clubId: id,
      registeredMembers: a.registeredMembers,
      activeMembers: a.activeMembers,
      retentionRate: ret ? P.retentionRate(ret.retained, ret.previous) : null,
      avgRating: r?._count._all ? (r._avg.rating ?? null) : null,
      reviewCount: r?._count._all ?? 0,
      activityScore: scoreBy.get(id) ?? 0,
      isActive: a.active,
      inPilot: a.inPilot,
    });
  }
  return out;
});

/** Batch metrics for the clubs list and admin tables (one pass, no N+1). Omit ids for every approved club. */
export async function clubListMetrics(clubIds?: string[]): Promise<Map<string, ClubListMetrics>> {
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
     WHERE o.status = 'SCHEDULED' AND e.status <> 'DRAFT' AND o."startsAt" >= ${ts(from)} AND o."startsAt" <= ${ts(to)}`;
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
           WHERE o.status = 'SCHEDULED' AND e.status <> 'DRAFT'
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
           WHERE o.status = 'SCHEDULED' AND e.status <> 'DRAFT'
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

/**
 * Platform-wide numbers for admin analytics. "This term" is the current term
 * (or the last one, between terms) up to `at`; events = held events.
 */
export async function platformSummary(at?: Date): Promise<PlatformSummary> {
  return platformCached(nowOr(at).getTime());
}
