import "server-only";
import type { CheckInMethod, ClubRole, EventKind, Prisma, Visibility } from "@prisma/client";
import { db } from "@/lib/db";
import type { Config } from "@/lib/config";
import { ROLE_RANK } from "@/lib/authz";
import { clubAttendanceByOccurrence } from "@/lib/metrics";
import { buildMatrix, memberAt, type Matrix } from "@/lib/attendance/matrix";
import { allowsTapCheckIn, checkinWindow, windowState, type WindowState } from "@/lib/attendance/rules";

/**
 * Read helpers for the Attendance Tool and tracker. Nothing here writes or
 * checks permission — callers (domain functions, pages behind
 * loadClubWorkspace, API routes) do that first.
 */

// ─── Occurrences ────────────────────────────────────────────────────────────

const clubRefSelect = { id: true, name: true, slug: true, logoUrl: true, logoColor: true } as const;

export const occurrenceInclude = {
  event: {
    select: {
      id: true,
      title: true,
      kind: true,
      status: true,
      visibility: true,
      allDay: true,
      clubId: true,
      locationType: true,
      room: true,
      address: true,
      building: { select: { name: true, code: true } },
      serviceMinutes: true,
      reviewStatus: true,
      club: { select: { ...clubRefSelect, status: true } },
      cohosts: { where: { status: "APPROVED" }, select: { club: { select: clubRefSelect } } },
    },
  },
} satisfies Prisma.EventOccurrenceInclude;

export type OccurrenceRow = Prisma.EventOccurrenceGetPayload<{ include: typeof occurrenceInclude }>;

export type ClubRef = { id: string; name: string; slug: string; logoUrl: string | null; logoColor: string };

export type OccurrenceSummary = {
  id: string;
  eventId: string;
  code: string;
  title: string;
  kind: EventKind;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  place: string | null;
  visibility: Visibility;
  cancelled: boolean;
  /** Online, so members get the one-tap "Check in" (rules.allowsTapCheckIn); in person needs the QR code or the posted code. */
  allowTapCheckIn: boolean;
  opensAt: Date;
  closesAt: Date;
  windowState: WindowState;
  /** Host club; null for university (admin) events such as officer trainings. */
  club: ClubRef | null;
  cohosts: ClubRef[];
  /** Service hours a check-in here earns, in minutes (Event.serviceMinutes; lib/metrics/service); null when it doesn't count. */
  serviceMinutes: number | null;
};

export type WindowConfig = Pick<Config, "checkin.opensMinutesBefore" | "checkin.closesMinutesAfter">;

export function windowCfg(cfg: WindowConfig) {
  return { opensMinutesBefore: cfg["checkin.opensMinutesBefore"], closesMinutesAfter: cfg["checkin.closesMinutesAfter"] };
}

/** "Lind Lecture Hall, Room 101" · "2400 Washington Blvd" · "Online" · null when not set yet. */
export function placeLabel(e: Pick<OccurrenceRow["event"], "locationType" | "room" | "address" | "building">, roomOverride?: string | null): string | null {
  const room = roomOverride || e.room;
  switch (e.locationType) {
    case "CAMPUS":
      return e.building ? [e.building.name, room].filter(Boolean).join(", ") : room || null;
    case "ADDRESS":
      return [e.address, room].filter(Boolean).join(", ") || null;
    case "VIRTUAL":
      return "Online";
    default:
      return room || null;
  }
}

export function toClubRef(c: ClubRef): ClubRef {
  return { id: c.id, name: c.name, slug: c.slug, logoUrl: c.logoUrl, logoColor: c.logoColor };
}

export function toOccurrenceSummary(o: OccurrenceRow, cfg: WindowConfig, now: Date): OccurrenceSummary {
  const w = checkinWindow(o, windowCfg(cfg));
  return {
    id: o.id,
    eventId: o.event.id,
    code: o.checkinCode,
    title: o.event.title,
    kind: o.event.kind,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    allDay: o.event.allDay,
    place: placeLabel(o.event, o.roomOverride),
    visibility: o.event.visibility,
    cancelled: o.status !== "SCHEDULED" || o.event.status !== "SCHEDULED",
    allowTapCheckIn: allowsTapCheckIn(o.event),
    opensAt: w.opensAt,
    closesAt: w.closesAt,
    windowState: windowState(w, now),
    club: o.event.club ? toClubRef(o.event.club) : null,
    cohosts: o.event.cohosts.map((c) => toClubRef(c.club)),
    serviceMinutes: o.event.serviceMinutes,
  };
}

/** Host + approved co-hosts: the clubs whose members may check in with the code (or one tap). */
export function participatingClubIds(o: Pick<OccurrenceRow, "event">): string[] {
  return [...new Set([o.event.clubId, ...o.event.cohosts.map((c) => c.club.id)].filter((x): x is string => Boolean(x)))];
}

/**
 * Occurrences a club hosts or is an approved co-host of. By default this is
 * the history rule lib/metrics uses (any event, so past meetings of an event
 * cancelled later still count); `live` limits it to events still on.
 */
export function clubOccurrencesWhere(clubId: string, opts: { live?: boolean } = {}): Prisma.EventOccurrenceWhereInput {
  return {
    status: "SCHEDULED",
    event: { ...(opts.live ? { status: "SCHEDULED" as const } : {}), OR: [{ clubId }, { cohosts: { some: { clubId, status: "APPROVED" } } }] },
  };
}

export async function occurrenceById(id: string) {
  return db.eventOccurrence.findUnique({ where: { id }, include: occurrenceInclude });
}

export async function occurrenceByCode(code: string) {
  return db.eventOccurrence.findUnique({ where: { checkinCode: code }, include: occurrenceInclude });
}

/** Clubs where someone counts as a member for a typed code or one tap: active membership or a current role. */
export async function activeClubIdsFor(userId: string): Promise<string[]> {
  const [m, r] = await Promise.all([
    db.membership.findMany({ where: { userId, status: "ACTIVE" }, select: { clubId: true } }),
    db.roleAssignment.findMany({ where: { userId, endedAt: null }, select: { clubId: true } }),
  ]);
  return [...new Set([...m.map((x) => x.clubId), ...r.map((x) => x.clubId)])];
}

// ─── Tracker (club leaders) ─────────────────────────────────────────────────

export type TrackerOccurrence = { id: string; startsAt: Date; endsAt: Date; eventId: string; title: string; kind: EventKind; hostClubId: string | null; hostName: string | null };

export type TrackerPerson = { id: string; name: string; email: string; handle: string; avatarUrl: string | null; avatarColor: string; status: string };

export type ClubMatrix = {
  clubId: string;
  matrix: Matrix<TrackerOccurrence>;
  people: Map<string, TrackerPerson>;
  memberships: Map<string, { status: string; joinedAt: Date | null; endedAt: Date | null }>;
  internalTitles: Map<string, string>;
  roles: Map<string, ClubRole>;
  recorders: Map<string, string>;
  /** Other clubs each guest belongs to ("Member of Robotics Club"). */
  guestClubs: Map<string, { name: string; slug: string }[]>;
  capped: boolean;
};

const MAX_COLUMNS = 400;

/** Everything the tracker table needs for one club and date range (only occurrences that have started). */
export async function loadClubMatrix(clubId: string, range: { from: Date; to: Date }, now = new Date()): Promise<ClubMatrix> {
  const until = range.to < now ? range.to : now;
  const occRows =
    range.from <= until
      ? await db.eventOccurrence.findMany({
          // A cancelled event's past meetings only show when someone actually checked in.
          where: { AND: [clubOccurrencesWhere(clubId), { startsAt: { gte: range.from, lte: until } }, { OR: [{ event: { status: "SCHEDULED" } }, { attendances: { some: {} } }] }] },
          select: { id: true, startsAt: true, endsAt: true, event: { select: { id: true, title: true, kind: true, clubId: true, club: { select: { name: true } } } } },
          orderBy: { startsAt: "asc" },
          take: MAX_COLUMNS + 1,
        })
      : [];
  const capped = occRows.length > MAX_COLUMNS;
  const occurrences: TrackerOccurrence[] = occRows.slice(0, MAX_COLUMNS).map((o) => ({
    id: o.id,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    eventId: o.event.id,
    title: o.event.title,
    kind: o.event.kind,
    hostClubId: o.event.clubId,
    hostName: o.event.club?.name ?? null,
  }));

  const [checkins, memberships, roles, earlier, metricColumns] = await Promise.all([
    occurrences.length
      ? db.attendance.findMany({
          where: { occurrenceId: { in: occurrences.map((o) => o.id) } },
          select: { id: true, occurrenceId: true, userId: true, method: true, checkedInAt: true, recordedById: true, recordedBy: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
    // Students only, like every attendance rate: advisors hold a membership but aren't counted as members here.
    db.membership.findMany({ where: { clubId, user: { kind: "STUDENT" } }, select: { userId: true, status: true, joinedAt: true, endedAt: true, internalTitle: true } }),
    db.roleAssignment.findMany({ where: { clubId, endedAt: null }, select: { userId: true, role: true } }),
    // Who was already coming before the range (their rate counts the whole range).
    db.attendance.findMany({ where: { occurrence: { ...clubOccurrencesWhere(clubId), startsAt: { lt: range.from } } }, distinct: ["userId"], select: { userId: true } }),
    occurrences.length ? clubAttendanceByOccurrence(clubId, { from: range.from, to: until }) : Promise.resolve([]),
  ]);

  const matrix = buildMatrix({
    occurrences,
    checkins,
    memberships,
    involvedBefore: new Set(earlier.map((e) => e.userId)),
    columnStats: new Map(metricColumns.map((c) => [c.occurrenceId, { memberAttendees: c.memberAttendees, guests: c.guests, membersAtTime: c.membersAtTime, rate: c.rate }])),
  });
  const ids = [...new Set([...matrix.members.map((r) => r.userId), ...matrix.guests.map((r) => r.userId)])];
  const guestIds = matrix.guests.map((r) => r.userId);
  const [users, guestMemberships] = await Promise.all([
    ids.length ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, handle: true, avatarUrl: true, avatarColor: true, status: true } }) : Promise.resolve([]),
    guestIds.length
      ? db.membership.findMany({
          where: { userId: { in: guestIds }, status: "ACTIVE", clubId: { not: clubId }, club: { status: "APPROVED" } },
          select: { userId: true, club: { select: { name: true, slug: true } } },
        })
      : Promise.resolve([]),
  ]);

  const roleMap = new Map<string, ClubRole>();
  for (const r of roles) {
    const prev = roleMap.get(r.userId);
    if (!prev || ROLE_RANK[r.role] > ROLE_RANK[prev]) roleMap.set(r.userId, r.role);
  }
  const guestClubs = new Map<string, { name: string; slug: string }[]>();
  for (const g of guestMemberships) guestClubs.set(g.userId, [...(guestClubs.get(g.userId) ?? []), g.club]);

  return {
    clubId,
    matrix,
    people: new Map(users.map((u) => [u.id, u])),
    memberships: new Map(memberships.map((m) => [m.userId, { status: m.status, joinedAt: m.joinedAt, endedAt: m.endedAt }])),
    internalTitles: new Map(memberships.filter((m) => m.internalTitle).map((m) => [m.userId, m.internalTitle!])),
    roles: roleMap,
    recorders: new Map(checkins.filter((c) => c.recordedBy).map((c) => [c.recordedBy!.id, c.recordedBy!.name])),
    guestClubs,
    capped,
  };
}

/**
 * Distinct people who checked in to a club's events in a range without being
 * members at the time. Only student memberships count as members, as in
 * lib/metrics clubAttendanceByOccurrence (an advisor checking in is a guest).
 */
export async function distinctGuestCount(clubId: string, from: Date, to: Date): Promise<number> {
  const [rows, memberships] = await Promise.all([
    db.attendance.findMany({
      where: { occurrence: { ...clubOccurrencesWhere(clubId), startsAt: { gte: from, lte: to } } },
      select: { userId: true, occurrence: { select: { startsAt: true } } },
    }),
    db.membership.findMany({ where: { clubId, user: { kind: "STUDENT" } }, select: { userId: true, status: true, joinedAt: true, endedAt: true } }),
  ]);
  const byUser = new Map(memberships.map((m) => [m.userId, m]));
  return new Set(rows.filter((r) => !memberAt(byUser.get(r.userId), r.occurrence.startsAt)).map((r) => r.userId)).size;
}

export type ClubCheckinList = {
  current: (OccurrenceSummary & { checkedIn: number; hosted: boolean })[];
  recent: (OccurrenceSummary & { checkedIn: number; hosted: boolean })[];
};

/** Live + upcoming (next 14 days) and the most recent past occurrences, for the tracker's check-in panel. */
export async function clubCheckinList(clubId: string, cfg: WindowConfig, now = new Date()): Promise<ClubCheckinList> {
  const w = windowCfg(cfg);
  const closesMs = w.closesMinutesAfter * 60_000;
  const include = { ...occurrenceInclude, _count: { select: { attendances: true } } } satisfies Prisma.EventOccurrenceInclude;
  const [current, recent] = await Promise.all([
    db.eventOccurrence.findMany({
      where: { ...clubOccurrencesWhere(clubId, { live: true }), endsAt: { gte: new Date(now.getTime() - closesMs) }, startsAt: { lte: new Date(now.getTime() + 14 * 86_400_000) } },
      include,
      orderBy: { startsAt: "asc" },
      take: 8,
    }),
    db.eventOccurrence.findMany({
      where: { ...clubOccurrencesWhere(clubId), endsAt: { lt: new Date(now.getTime() - closesMs) } },
      include,
      orderBy: { startsAt: "desc" },
      take: 5,
    }),
  ]);
  const map = (o: (typeof current)[number]) => ({ ...toOccurrenceSummary(o, cfg, now), checkedIn: o._count.attendances, hosted: o.event.clubId === clubId });
  return { current: current.map(map), recent: recent.map(map) };
}

// ─── One occurrence ─────────────────────────────────────────────────────────

export type OccurrenceAttendee = {
  attendanceId: string;
  method: CheckInMethod;
  checkedInAt: Date;
  recordedBy: string | null;
  user: TrackerPerson;
  /** Member of the host club when the event started (vs. a guest). */
  asMember: boolean;
  /** Member of the host club today. */
  memberNow: boolean;
};

export async function loadOccurrenceAttendees(occurrenceId: string, hostClubId: string | null, startsAt: Date) {
  const rows = await db.attendance.findMany({
    where: { occurrenceId },
    orderBy: { checkedInAt: "desc" },
    select: {
      id: true,
      method: true,
      checkedInAt: true,
      recordedBy: { select: { name: true } },
      user: { select: { id: true, name: true, email: true, handle: true, avatarUrl: true, avatarColor: true, status: true } },
    },
  });
  // Student memberships only, so membersAtTime, memberAttendees, guests and rate match the tracker's columns (lib/metrics).
  const memberships = hostClubId
    ? await db.membership.findMany({ where: { clubId: hostClubId, user: { kind: "STUDENT" } }, select: { userId: true, status: true, joinedAt: true, endedAt: true } })
    : [];
  const byUser = new Map(memberships.map((m) => [m.userId, m]));
  const attendees: OccurrenceAttendee[] = rows.map((r) => ({
    attendanceId: r.id,
    method: r.method,
    checkedInAt: r.checkedInAt,
    recordedBy: r.recordedBy?.name ?? null,
    user: r.user,
    asMember: memberAt(byUser.get(r.user.id), startsAt),
    memberNow: byUser.get(r.user.id)?.status === "ACTIVE",
  }));
  const membersAtTime = memberships.filter((m) => memberAt(m, startsAt)).length;
  const memberAttendees = attendees.filter((a) => a.asMember).length;
  return {
    attendees,
    membersAtTime,
    memberAttendees,
    guests: attendees.length - memberAttendees,
    rate: hostClubId && attendees.length > 0 && membersAtTime > 0 ? memberAttendees / membersAtTime : null,
  };
}

// ─── One person ─────────────────────────────────────────────────────────────

const myRowSelect = {
  id: true,
  method: true,
  checkedInAt: true,
  occurrence: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      event: {
        select: {
          id: true,
          title: true,
          kind: true,
          clubId: true,
          allDay: true,
          club: { select: clubRefSelect },
          cohosts: { where: { status: "APPROVED" }, select: { club: { select: clubRefSelect } } },
        },
      },
    },
  },
} satisfies Prisma.AttendanceSelect;

export type MyAttendanceRow = {
  id: string;
  method: CheckInMethod;
  checkedInAt: Date;
  occurrenceId: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  eventId: string;
  title: string;
  kind: EventKind;
  /** Host club; null for university events. */
  club: ClubRef | null;
  /** Host first, then approved co-hosts — the event counts for each. */
  clubs: ClubRef[];
  /** Member of any participating club when it started? Null when no club took part; false = a guest visit. */
  asMember: boolean | null;
  /**
   * Participating clubs they weren't a member of at the time — cross-club
   * activity, the same rule that draws lines on the network map.
   */
  otherClubs: ClubRef[];
};

export type MyMembership = { clubId: string; status: string; joinedAt: Date | null; endedAt: Date | null; club: ClubRef & { status: string } };

export const MY_HISTORY_LIMIT = 1000;

/** A person's whole attendance record (newest first) plus their memberships. */
export async function loadPersonAttendance(userId: string): Promise<{ rows: MyAttendanceRow[]; memberships: MyMembership[]; capped: boolean }> {
  const [rows, memberships] = await Promise.all([
    db.attendance.findMany({ where: { userId }, orderBy: { checkedInAt: "desc" }, take: MY_HISTORY_LIMIT + 1, select: myRowSelect }),
    db.membership.findMany({
      where: { userId },
      select: { clubId: true, status: true, joinedAt: true, endedAt: true, club: { select: { ...clubRefSelect, status: true } } },
    }),
  ]);
  const byClub = new Map(memberships.map((m) => [m.clubId, m]));
  return {
    capped: rows.length > MY_HISTORY_LIMIT,
    memberships,
    rows: rows.slice(0, MY_HISTORY_LIMIT).map((r) => {
      const e = r.occurrence.event;
      const clubs = [...(e.club ? [toClubRef(e.club)] : []), ...e.cohosts.map((c) => toClubRef(c.club))];
      return {
        id: r.id,
        method: r.method,
        checkedInAt: r.checkedInAt,
        occurrenceId: r.occurrence.id,
        startsAt: r.occurrence.startsAt,
        endsAt: r.occurrence.endsAt,
        allDay: e.allDay,
        eventId: e.id,
        title: e.title,
        kind: e.kind,
        club: e.club ? toClubRef(e.club) : null,
        clubs,
        asMember: clubs.length ? clubs.some((c) => memberAt(byClub.get(c.id), r.occurrence.startsAt)) : null,
        otherClubs: clubs.filter((c) => !memberAt(byClub.get(c.id), r.occurrence.startsAt)),
      };
    }),
  };
}

export type MemberHistoryItem = {
  occurrenceId: string;
  startsAt: Date;
  endsAt: Date;
  title: string;
  hostName: string | null;
  attendance: { method: CheckInMethod; checkedInAt: Date } | null;
  /** Whether they were a member when it happened (missed events only count then). */
  asMember: boolean;
};

/**
 * One person's history in one club: every held occurrence since they joined
 * (or first came), attended or missed, newest first.
 */
export async function loadMemberHistory(userId: string, clubId: string, now = new Date()) {
  const [membership, first] = await Promise.all([
    db.membership.findUnique({ where: { userId_clubId: { userId, clubId } }, select: { status: true, joinedAt: true, endedAt: true, requestedAt: true, internalTitle: true, source: true } }),
    db.attendance.findFirst({ where: { userId, occurrence: clubOccurrencesWhere(clubId) }, orderBy: { occurrence: { startsAt: "asc" } }, select: { occurrence: { select: { startsAt: true } } } }),
  ]);
  const starts = [membership?.joinedAt, first?.occurrence.startsAt].filter((d): d is Date => Boolean(d));
  if (starts.length === 0) return { membership, items: [] as MemberHistoryItem[] };
  const since = new Date(Math.min(...starts.map((d) => d.getTime())));
  const occ = await db.eventOccurrence.findMany({
    where: { ...clubOccurrencesWhere(clubId), startsAt: { gte: since, lte: now }, attendances: { some: {} } },
    orderBy: { startsAt: "desc" },
    take: 300,
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      event: { select: { title: true, clubId: true, club: { select: { name: true } } } },
      attendances: { where: { userId }, select: { method: true, checkedInAt: true } },
    },
  });
  const items: MemberHistoryItem[] = occ
    .map((o) => ({
      occurrenceId: o.id,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      title: o.event.title,
      hostName: o.event.clubId === clubId ? null : (o.event.club?.name ?? null),
      attendance: o.attendances[0] ?? null,
      asMember: memberAt(membership, o.startsAt),
    }))
    // Before they joined, only the events they actually came to are part of their story.
    .filter((i) => i.attendance || i.asMember);
  return { membership, items };
}
