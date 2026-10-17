import "server-only";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { assertSignedIn, invalid } from "@/lib/domain/kit";
import { appUrl, liveOccurrencesForUser } from "@/lib/domain/attendance";
import { announcementFeed } from "@/lib/domain/announcements";
import { unreadNotificationCount } from "@/lib/domain/notifications";
import { countOpenTasks } from "@/lib/domain/tasks";
import { feedOccurrences, viewerContext } from "@/lib/events/feed";
import { clubMetricsFor, viewerClubStates } from "@/lib/clubs/queries";
import { memberClubSummaries, memberClubSummary } from "@/lib/metrics";
import { loadPersonAttendance } from "@/lib/attendance/queries";
import { METHOD_LABEL } from "@/lib/attendance/rules";
import { richToText } from "@/lib/rich/sanitize";
import { campusDate, DAY_MS, fmtDate, inCampusTime } from "@/lib/time";
import { CLUB_SCOPE_LABEL, CLUB_TYPE_LABEL, JOIN_POLICY_LABEL } from "@/components/clubs/labels";
import {
  currentSeats,
  feedToMEvent,
  firstName,
  toAttendanceSummary,
  toClubRef,
  toMAnnouncement,
  toMetrics,
  toMOccurrence,
  toMUser,
  viewerState,
} from "./serialize";
import { loadClubForViewer } from "./club";
import type { MAttendance, MCalendar, MClubDetail, MHome, MMe, MMyClub } from "../_types";

/**
 * The read models behind the signed-in mobile screens. Route handlers resolve
 * the caller and hand over; keeping the reads here (not in route.ts) lets
 * them be exercised directly. Read-only: every write goes through lib/domain.
 */

// ─── Me ──────────────────────────────────────────────────────────────────────

export async function meView(actor: Actor | null): Promise<MMe> {
  assertSignedIn(actor);
  const [unread, tasks, seats] = await Promise.all([unreadNotificationCount(actor), countOpenTasks(actor), currentSeats(actor.id)]);
  const clubs = seats.size
    ? await db.club.findMany({
        where: { id: { in: [...seats.keys()] }, status: { notIn: ["RETIRED", "REJECTED"] } },
        select: { id: true, name: true, slug: true, logoUrl: true, logoColor: true },
        orderBy: { name: "asc" },
      })
    : [];
  return {
    user: toMUser(actor),
    unreadNotifications: unread,
    openTasks: tasks,
    roles: clubs.map((c) => {
      const s = seats.get(c.id)!;
      return { club: toClubRef(c), role: s.role, title: s.title, since: s.since.toISOString() };
    }),
    webUrl: appUrl(),
  };
}

// ─── Home ────────────────────────────────────────────────────────────────────

const UPCOMING_DAYS = 14;
const UPCOMING_LIMIT = 8;

export async function homeView(actor: Actor | null): Promise<MHome> {
  assertSignedIn(actor);
  const now = new Date();
  const ctx = await viewerContext(actor);
  const [live, states, seats, feed, announcements] = await Promise.all([
    liveOccurrencesForUser(actor),
    viewerClubStates(actor.id),
    currentSeats(actor.id),
    feedOccurrences(ctx, { scope: "me" }, { start: now, end: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS) }, { take: 60 }),
    announcementFeed(actor.id, 5),
  ]);

  // "My clubs": active member, pending request, or a current role — in approved clubs.
  const ids = [...states].filter(([, s]) => s.member || s.pending || s.leader).map(([id]) => id);
  const clubs = ids.length
    ? await db.club.findMany({ where: { id: { in: ids }, status: "APPROVED" }, select: { id: true, name: true, slug: true, logoUrl: true, logoColor: true }, orderBy: { name: "asc" } })
    : [];
  const myClubs: MMyClub[] = clubs.map((c) => {
    const s = states.get(c.id)!;
    const seat = seats.get(c.id);
    return {
      club: toClubRef(c),
      role: seat?.role ?? (s.member ? "MEMBER" : null),
      roleLabel: seat?.title ?? (s.member ? "Member" : s.pending ? "Request pending" : null),
      pending: s.pending,
      subscribed: s.subscribed,
    };
  });

  return {
    firstName: firstName(actor.name),
    live: live.map(toMOccurrence),
    clubs: myClubs,
    upcoming: feed
      .map((o) => feedToMEvent(o, now))
      .filter((e) => !e.cancelled)
      .slice(0, UPCOMING_LIMIT),
    announcements: announcements.map(toMAnnouncement),
  };
}

// ─── Club page ───────────────────────────────────────────────────────────────

const CLUB_UPCOMING_LIMIT = 6;

export async function clubDetailView(actor: Actor | null, slug: string): Promise<MClubDetail> {
  const { club, access } = await loadClubForViewer(actor, slug);
  const now = new Date();
  const listed = club.status === "APPROVED" || club.status === "RETIRED";

  const [metrics, viewer, feed, summary, live] = await Promise.all([
    clubMetricsFor(club.id),
    viewerState(actor, club.id),
    listed
      ? viewerContext(actor).then((ctx) => feedOccurrences(ctx, { scope: "club", clubId: club.id }, { start: now, end: new Date(now.getTime() + 120 * DAY_MS) }, { take: 30 }))
      : Promise.resolve([]),
    actor ? memberClubSummary(actor.id, club.id) : Promise.resolve(null),
    actor && club.status === "APPROVED" ? liveOccurrencesForUser(actor, { clubId: club.id }) : Promise.resolve([]),
  ]);

  // Like the web's attendance card: only for people connected to the club.
  const connected = Boolean(access?.isMember || access?.isPendingMember || (summary && summary.attended > 0));
  const { hasMetrics, ...m } = metrics;

  return {
    club: {
      id: club.id,
      name: club.name,
      slug: club.slug,
      logoUrl: club.logoUrl,
      logoColor: club.logoColor,
      status: club.status,
      shortDescription: club.shortDescription,
      about: richToText(club.descriptionHtml ?? "", 2000),
      typeLabel: CLUB_TYPE_LABEL[club.type],
      placement: club.scope === "COLLEGE" && club.college ? club.college.name : CLUB_SCOPE_LABEL[club.scope],
      focus: club.focusMajor?.name ?? club.focusOther ?? null,
      joinPolicy: club.joinPolicy,
      joinPolicyLabel: JOIN_POLICY_LABEL[club.joinPolicy],
      contactEmail: club.contactEmail,
      webPath: `/clubs/${club.slug}`,
    },
    metrics: toMetrics(m, hasMetrics),
    viewer,
    upcoming: feed
      .map((o) => feedToMEvent(o, now))
      .filter((e) => !e.cancelled)
      .slice(0, CLUB_UPCOMING_LIMIT),
    attendance: summary && connected ? toAttendanceSummary(summary) : null,
    live: live.map(toMOccurrence),
  };
}

// ─── Calendar ────────────────────────────────────────────────────────────────

const DEFAULT_DAYS = 42;
const MAX_DAYS = 400;

/** Midnight today on campus. */
function startOfCampusToday(now: Date) {
  const t = inCampusTime(now);
  return campusDate(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

export async function calendarView(actor: Actor | null, range: { from?: string | null; to?: string | null }): Promise<MCalendar> {
  assertSignedIn(actor);
  const now = new Date();
  const from = range.from ? new Date(range.from) : startOfCampusToday(now);
  const to = range.to ? new Date(range.to) : new Date(from.getTime() + DEFAULT_DAYS * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw invalid("That date range doesn't work. Pull to refresh and try again.");
  if (to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) throw invalid("Ask for about a year at a time at most.");
  const ctx = await viewerContext(actor);
  const rows = await feedOccurrences(ctx, { scope: "me" }, { start: from, end: to }, { take: 1000 });
  return { from: from.toISOString(), to: to.toISOString(), events: rows.map((o) => feedToMEvent(o, now)) };
}

// ─── Attendance ──────────────────────────────────────────────────────────────

const HISTORY = 100;

export async function attendanceView(actor: Actor | null): Promise<MAttendance> {
  assertSignedIn(actor);
  const [summaries, person] = await Promise.all([memberClubSummaries(actor.id), loadPersonAttendance(actor.id)]);
  return {
    totalCheckins: person.rows.length,
    clubs: summaries.map((s) => ({ club: toClubRef(s.club), membershipStatus: s.membershipStatus, summary: toAttendanceSummary(s.summary) })),
    history: person.rows.slice(0, HISTORY).map((r) => ({
      id: r.id,
      occurrenceId: r.occurrenceId,
      eventId: r.eventId,
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      dateLabel: r.allDay ? fmtDate(r.startsAt, "EEE, MMM d, yyyy") : fmtDate(r.startsAt, "EEE, MMM d, yyyy · h:mm a"),
      method: r.method,
      methodLabel: METHOD_LABEL[r.method],
      clubs: r.clubs.map(toClubRef),
      asMember: r.asMember,
    })),
    more: person.capped || person.rows.length > HISTORY,
  };
}
