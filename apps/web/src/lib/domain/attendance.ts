import "server-only";
import { Prisma, type CheckInMethod } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { canViewEvent } from "@/lib/authz/events";
import { periodStartFor } from "@/lib/authz/requirements";
import { getConfig, type Config } from "@/lib/config";
import { logActivity } from "@/lib/lake/activity";
import { DomainError, assertCan, assertClubCap, assertSignedIn, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { joinClub } from "@/lib/domain/memberships";
import { notify } from "@/lib/domain/notify";
import { reopenRequirementTasks, requirementSourceId } from "@/lib/domain/requirements";
import { resolveTasks } from "@/lib/domain/tasks";
import { reviewEligibility } from "@/lib/metrics";
import { checkinPass, checkinPath, checkinToken, isCheckinPass, tokenWindow, verifyCheckinToken, verifyScanProof } from "@/lib/attendance/token";
import { blockMessage, codeNotFoundMessage, decideMethod, normalizeCode, publicShortName, whenLabel, windowMessage, type WindowState } from "@/lib/attendance/rules";
import {
  activeClubIdsFor,
  occurrenceByCode,
  occurrenceById,
  occurrenceInclude,
  participatingClubIds,
  toOccurrenceSummary,
  windowCfg,
  type ClubRef,
  type OccurrenceRow,
  type OccurrenceSummary,
} from "@/lib/attendance/queries";

/**
 * THE ATTENDANCE TOOL — the only way attendance enters the data lake.
 *
 *   QR scan         rotating token on the leader's screen → method QR
 *   Event code      the code alone (typed from the event's screen, or for online
 *                   events the app's "check in?" pop-up) → SELF, for members of
 *                   the host/co-host clubs. In-person codes are only shown at the event.
 *   Manual add      a leader with "attendance" (admins for university events) → MANUAL
 *
 * Checking in also: auto-enrolls students in the host club (open club →
 * member, gated club → join request, via memberships.joinClub), closes
 * officer-training requirement tasks, and logs to the activity stream.
 * Tracker, reviews gate, activity, retention and the network all read the
 * Attendance rows written here.
 */

export type CheckInVia = "web" | "mobile-scan" | "mobile-popup";
export type MembershipOutcome = "MEMBER" | "JOINED" | "REQUESTED" | "NONE";

export type CheckInResult = {
  status: "CHECKED_IN" | "ALREADY";
  attendanceId: string;
  method: CheckInMethod;
  checkedInAt: Date;
  occurrence: OccurrenceSummary;
  club: ClubRef | null;
  membership: MembershipOutcome;
  /** Progress toward leaving a review of the host club (null for university events). */
  reviewProgress: { eligible: boolean; attended: number; required: number } | null;
  /** Officer requirements this check-in fulfilled ("Officer Training — Fall"). */
  requirementsMet: string[];
};

const CheckInInput = z.object({
  code: z.string().trim().min(1, "Enter the check-in code.").max(32),
  token: z.string().trim().max(80).nullish(),
  via: z.enum(["web", "mobile-scan", "mobile-popup"]).default("web"),
});

const codeNotFound = (code: string) => new DomainError("NOT_FOUND", codeNotFoundMessage(code));

function hostClubId(o: OccurrenceRow) {
  return o.event.clubId;
}

async function isActiveMemberOfAny(userId: string, clubIds: string[]) {
  if (clubIds.length === 0) return false;
  const mine = await activeClubIdsFor(userId);
  return clubIds.some((id) => mine.includes(id));
}

/** Running check-in and editing attendance: "attendance" on the host club, or an admin for university events. */
async function assertCanManage(actor: Actor | null, o: Pick<OccurrenceRow, "event">) {
  const clubId = o.event.clubId;
  if (clubId) await assertClubCap(actor, clubId, "attendance");
  else assertCan(actor, "admin.trainings");
  return actor!;
}

/** Can this person run check-in / edit attendance for the occurrence? (No throw — for pages and buttons.) */
export async function canManageOccurrence(actor: Actor | null, o: Pick<OccurrenceRow, "event">): Promise<boolean> {
  try {
    await assertCanManage(actor, o);
    return true;
  } catch (e) {
    if (e instanceof DomainError) return false;
    throw e;
  }
}

async function membershipState(actor: Actor, clubId: string | null): Promise<"MEMBER" | "REQUESTED" | "NONE"> {
  if (!clubId) return "NONE";
  const access = await getClubAccess(actor, clubId);
  if (access?.isMember) return "MEMBER";
  if (access?.isPendingMember) return "REQUESTED";
  return "NONE";
}

/** Progress toward leaving a review, or null for accounts that can't review this club (alumni, faculty and staff). */
async function reviewProgressFor(userId: string, clubId: string | null) {
  if (!clubId) return null;
  const r = await reviewEligibility(userId, clubId);
  return r.canReview ? r : null;
}

/**
 * Closes the REQUIREMENT tasks this training check-in satisfies; returns their names.
 * A check-in from before the requirement's current renewal period doesn't count
 * (lib/authz/requirements), e.g. a leader adding someone to last term's session.
 */
async function resolveTrainingRequirements(userId: string, eventId: string, checkedInAt: Date, completedById: string | null) {
  const reqs = await db.roleRequirement.findMany({ where: { active: true, kind: "TRAINING", trainingEventId: eventId }, select: { id: true, name: true, renewal: true } });
  const now = new Date();
  const met: string[] = [];
  for (const r of reqs) {
    if (checkedInAt < (await periodStartFor(r.renewal, now))) continue;
    await resolveTasks("requirement", requirementSourceId(r.id, userId), completedById);
    met.push(r.name);
  }
  return met;
}

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// ─── Preview (no side effects) ──────────────────────────────────────────────

export type CheckinPreview =
  | {
      found: false;
      message: string;
      /** The code is real, but this viewer may not see the event (yet): log in, or scan the QR at the event. */
      hidden?: boolean;
    }
  | {
      found: true;
      occurrence: OccurrenceSummary;
      signedIn: boolean;
      /** A scan pass to carry through login and onto the button (null without a live scan). */
      pass: string | null;
      scan: "LIVE" | "EXPIRED" | "NONE";
      existing: { method: CheckInMethod; checkedInAt: Date } | null;
      membership: "MEMBER" | "REQUESTED" | "NONE";
      /** True when tapping "Check in" would work right now. */
      ready: boolean;
      /** Why it wouldn't (shown instead of the button). */
      blocker: string | null;
    };

/**
 * What the /c/<code> page shows before anyone taps anything. Pure reads: a
 * live QR token is swapped for a short-lived pass so the scan survives a
 * login round-trip; nothing is written until checkIn().
 */
export async function checkinPreview(actor: Actor | null, rawCode: string, token?: string | null): Promise<CheckinPreview> {
  const norm = normalizeCode(rawCode);
  if (!norm.ok) return { found: false, message: norm.error };
  const occ = await occurrenceByCode(norm.code);
  if (!occ) return { found: false, message: codeNotFoundMessage(norm.code) };

  const cfg = await getConfig();
  const now = new Date();
  const occurrence = toOccurrenceSummary(occ, cfg, now);
  const rotate = cfg["checkin.qrRotateSeconds"];

  let pass: string | null = null;
  let scan: "LIVE" | "EXPIRED" | "NONE" = "NONE";
  if (token) {
    if (isCheckinPass(token)) {
      // Never re-mint from a pass, or reloading would keep a scan alive forever.
      if (verifyScanProof(occ.checkinSecret, token, now.getTime(), rotate)) {
        pass = token;
        scan = "LIVE";
      } else scan = "EXPIRED";
    } else if (verifyCheckinToken(occ.checkinSecret, token, now.getTime(), rotate)) {
      pass = checkinPass(occ.checkinSecret, now.getTime());
      scan = "LIVE";
    } else scan = "EXPIRED";
  }

  const existing = actor
    ? await db.attendance.findUnique({ where: { occurrenceId_userId: { occurrenceId: occ.id, userId: actor.id } }, select: { method: true, checkedInAt: true } })
    : null;
  // A code alone doesn't show the event: unless you scanned the live QR (you're
  // in the room) or are already on the list, its title, time and place follow
  // the event-visibility rule, so members-only details stay with members.
  const gate = { ...occ.event, cohosts: occ.event.cohosts.map((c) => ({ clubId: c.club.id, status: "APPROVED" })) };
  if (scan !== "LIVE" && !existing && !(await canViewEvent(actor, gate))) {
    return {
      found: false,
      hidden: true,
      message: actor
        ? "This event is for its clubs' members. If you're there, scan the QR code on the screen to check in."
        : "This event isn't public. Log in to see it and check in.",
    };
  }

  const base = { found: true as const, occurrence, signedIn: Boolean(actor), pass, scan };
  if (!actor) return { ...base, existing: null, membership: "NONE", ready: false, blocker: null };

  const membership = await membershipState(actor, hostClubId(occ));
  const done = (blocker: string | null) => ({ ...base, existing, membership, ready: blocker === null && !existing, blocker });
  if (existing) return done(null);
  if (occurrence.cancelled) return done("This event was cancelled, so check-in is closed.");
  if (occ.event.club && occ.event.club.status !== "APPROVED") return done("This club isn't running events right now.");
  if (actor.status !== "ACTIVE") return done("Alumni accounts can't check themselves in. Ask a club leader to add you.");
  const wm = windowMessage(occurrence.windowState, occurrence, now);
  if (wm) return done(wm);
  const decision = decideMethod({
    scanValid: scan === "LIVE",
    scanPresented: scan !== "NONE",
    isParticipatingMember: await isActiveMemberOfAny(actor.id, participatingClubIds(occ)),
  });
  return done(decision.ok ? null : blockMessage(decision.reason, rotate));
}

// ─── Check in (QR / self) ───────────────────────────────────────────────────

/**
 * Checks the signed-in person in. Called by the web check-in page, the
 * mobile app (scan or "check in?" pop-up) and the dashboard prompt.
 * Re-checking in is harmless: it returns status "ALREADY".
 */
export async function checkIn(actor: Actor | null, input: unknown): Promise<CheckInResult> {
  assertSignedIn(actor);
  const { code: rawCode, token, via } = parse(CheckInInput, input);
  const norm = normalizeCode(rawCode);
  if (!norm.ok) throw invalid(norm.error);
  const occ = await occurrenceByCode(norm.code);
  if (!occ) throw codeNotFound(norm.code);

  const cfg = await getConfig();
  const now = new Date();
  const occurrence = toOccurrenceSummary(occ, cfg, now);
  const clubId = hostClubId(occ);
  const club = occurrence.club;

  const already = async (row: { id: string; method: CheckInMethod; checkedInAt: Date }): Promise<CheckInResult> => ({
    status: "ALREADY",
    attendanceId: row.id,
    method: row.method,
    checkedInAt: row.checkedInAt,
    occurrence,
    club,
    membership: await membershipState(actor, clubId),
    reviewProgress: await reviewProgressFor(actor.id, clubId),
    requirementsMet: [],
  });

  // Someone already on the list hears "you're checked in", even after the window closes.
  const existing = await db.attendance.findUnique({ where: { occurrenceId_userId: { occurrenceId: occ.id, userId: actor.id } } });
  if (existing) return already(existing);

  if (occurrence.cancelled) throw invalid("This event was cancelled, so check-in is closed.");
  if (occ.event.club && occ.event.club.status !== "APPROVED") throw invalid("This club isn't running events right now.");
  if (actor.status !== "ACTIVE") throw forbidden("Alumni accounts can't check themselves in. Ask a club leader to add you.");
  const wm = windowMessage(occurrence.windowState, occurrence, now);
  if (wm) throw invalid(wm);

  const rotate = cfg["checkin.qrRotateSeconds"];
  const decision = decideMethod({
    scanValid: token ? verifyScanProof(occ.checkinSecret, token, now.getTime(), rotate) : false,
    scanPresented: Boolean(token),
    isParticipatingMember: await isActiveMemberOfAny(actor.id, participatingClubIds(occ)),
  });
  if (!decision.ok) throw forbidden(blockMessage(decision.reason, rotate));

  let attendance;
  try {
    attendance = await db.attendance.create({
      data: { occurrenceId: occ.id, userId: actor.id, clubId, method: decision.method, recordedById: null, checkedInAt: now },
    });
  } catch (e) {
    // A double tap or a second device got there first.
    if (isUniqueViolation(e)) {
      const row = await db.attendance.findUnique({ where: { occurrenceId_userId: { occurrenceId: occ.id, userId: actor.id } } });
      if (row) return already(row);
    }
    throw e;
  }

  // Auto-enroll students at the most basic level. Check-in always counts even if joining can't happen.
  let membership: MembershipOutcome = await membershipState(actor, clubId);
  if (clubId && membership === "NONE" && actor.kind === "STUDENT") {
    try {
      const joined = await joinClub(actor, clubId, "CHECKIN");
      membership = joined.status === "ACTIVE" ? "JOINED" : joined.status === "ALREADY_MEMBER" ? "MEMBER" : "REQUESTED";
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
    }
  }

  const requirementsMet = await resolveTrainingRequirements(actor.id, occ.event.id, attendance.checkedInAt, actor.id);
  await logActivity({
    actorId: actor.id,
    action: "attendance.checkin",
    entityType: "attendance",
    entityId: attendance.id,
    clubId,
    data: { occurrenceId: occ.id, eventId: occ.event.id, title: occ.event.title, method: decision.method, via },
    isPublic: true,
  });

  return {
    status: "CHECKED_IN",
    attendanceId: attendance.id,
    method: attendance.method,
    checkedInAt: attendance.checkedInAt,
    occurrence,
    club,
    membership,
    reviewProgress: await reviewProgressFor(actor.id, clubId),
    requirementsMet,
  };
}

// ─── Manual add / remove (leaders) ──────────────────────────────────────────

const ManualInput = z.object({ occurrenceId: z.string().min(1), userId: z.string().min(1) });

/** A leader records someone who was there (forgot their phone, couldn't scan, arrived late). */
export async function addManual(actor: Actor | null, occurrenceId: string, userId: string) {
  const input = parse(ManualInput, { occurrenceId, userId });
  const occ = await occurrenceById(input.occurrenceId);
  if (!occ) throw notFound("Event");
  const leader = await assertCanManage(actor, occ);

  const cfg = await getConfig();
  const now = new Date();
  const occurrence = toOccurrenceSummary(occ, cfg, now);
  if (occurrence.cancelled) throw invalid("This event was cancelled.");
  if (occurrence.windowState === "NOT_OPEN") throw invalid(`You can add people once check-in opens — ${whenLabel(occurrence.opensAt, now)}.`);

  const person = await db.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, status: true } });
  if (!person || person.status === "DEACTIVATED") throw notFound("Person");

  // Added during the event: now. Added afterwards: the event's start, so stats
  // (which bucket by checkedInAt) put it in the right week, month and term.
  const checkedInAt = occurrence.windowState === "OPEN" ? now : occ.startsAt;
  let attendance;
  try {
    attendance = await db.attendance.create({
      data: { occurrenceId: occ.id, userId: person.id, clubId: hostClubId(occ), method: "MANUAL", recordedById: leader.id, checkedInAt },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`${person.name} is already checked in.`);
    throw e;
  }

  const requirementsMet = await resolveTrainingRequirements(person.id, occ.event.id, checkedInAt, leader.id);
  await logActivity({
    actorId: leader.id,
    action: "attendance.manual_add",
    entityType: "attendance",
    entityId: attendance.id,
    clubId: hostClubId(occ),
    data: { occurrenceId: occ.id, eventId: occ.event.id, userId: person.id, title: occ.event.title },
  });
  await notify({
    userIds: [person.id],
    exceptUserId: leader.id,
    kind: "attendance.added",
    title: `You're checked in to ${occ.event.title}`,
    body: `${leader.name} added you to the attendance${occurrence.club ? ` for ${occurrence.club.name}` : ""}.${requirementsMet.length ? ` This counts toward ${requirementsMet.join(", ")}.` : ""}`,
    href: "/me/attendance",
    email: false,
  });
  return { attendanceId: attendance.id, name: person.name, requirementsMet };
}

/** Removes a check-in (a mistaken scan, the wrong person added). */
export async function removeAttendance(actor: Actor | null, attendanceId: string) {
  const id = parse(z.string().min(1), attendanceId);
  const row = await db.attendance.findUnique({
    where: { id },
    include: { occurrence: { include: occurrenceInclude }, user: { select: { name: true } } },
  });
  if (!row) throw notFound("Check-in");
  const leader = await assertCanManage(actor, row.occurrence);
  await db.attendance.delete({ where: { id: row.id } });
  await logActivity({
    actorId: leader.id,
    action: "attendance.removed",
    entityType: "attendance",
    entityId: row.id,
    clubId: row.clubId,
    data: { occurrenceId: row.occurrenceId, eventId: row.occurrence.event.id, userId: row.userId, method: row.method, title: row.occurrence.event.title },
  });
  // A removed training check-in can un-meet an officer requirement: reopen the task if so.
  await reopenRequirementTasks(row.userId);
  return { name: row.user.name };
}

/** People a leader can add: the host club's members first, then any account by name or email. */
export async function searchCheckinCandidates(actor: Actor | null, occurrenceId: string, query: string) {
  const occ = await occurrenceById(occurrenceId);
  if (!occ) throw notFound("Event");
  await assertCanManage(actor, occ);
  const q = String(query ?? "").trim().slice(0, 80);
  if (q.length < 2) return [];
  const clubId = hostClubId(occ);
  const match: Prisma.UserWhereInput = {
    status: { not: "DEACTIVATED" },
    OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { handle: { contains: q, mode: "insensitive" } }],
  };
  const select = { id: true, name: true, email: true, avatarUrl: true, avatarColor: true, kind: true } as const;
  const [members, others, present] = await Promise.all([
    clubId ? db.user.findMany({ where: { ...match, memberships: { some: { clubId, status: "ACTIVE" } } }, select, orderBy: { name: "asc" }, take: 8 }) : Promise.resolve([]),
    db.user.findMany({ where: match, select, orderBy: { name: "asc" }, take: 12 }),
    db.attendance.findMany({ where: { occurrenceId: occ.id }, select: { userId: true } }),
  ]);
  const here = new Set(present.map((p) => p.userId));
  const memberIds = new Set(members.map((m) => m.id));
  const list = [...members, ...others.filter((o) => !memberIds.has(o.id))].slice(0, 10);
  return list.map((u) => ({ ...u, isMember: memberIds.has(u.id), alreadyIn: here.has(u.id) }));
}

// ─── Live occurrences ───────────────────────────────────────────────────────

export type LiveOccurrence = OccurrenceSummary;

function liveWindowWhere(cfg: Config, now: Date): Prisma.EventOccurrenceWhereInput {
  const w = windowCfg(cfg);
  return {
    status: "SCHEDULED",
    startsAt: { lte: new Date(now.getTime() + w.opensMinutesBefore * 60_000) },
    endsAt: { gte: new Date(now.getTime() - w.closesMinutesAfter * 60_000) },
  };
}

/** Occurrences a person can check themselves into right now (by user id; see liveOccurrencesForUser). */
export async function liveOccurrencesForUserId(userId: string, opts: { clubId?: string } = {}): Promise<LiveOccurrence[]> {
  const clubIds = await activeClubIdsFor(userId);
  const scope = opts.clubId ? clubIds.filter((id) => id === opts.clubId) : clubIds;
  if (scope.length === 0) return [];
  const cfg = await getConfig();
  const now = new Date();
  const rows = await db.eventOccurrence.findMany({
    where: {
      ...liveWindowWhere(cfg, now),
      attendances: { none: { userId } },
      event: {
        status: "SCHEDULED",
        // The one-tap prompt hands over the code, so it's only for online events (rules.allowsTapCheckIn).
        locationType: "VIRTUAL",
        OR: [{ clubId: { in: scope }, club: { status: "APPROVED" } }, { cohosts: { some: { clubId: { in: scope }, status: "APPROVED" } } }],
      },
    },
    include: occurrenceInclude,
    orderBy: { startsAt: "asc" },
    take: 10,
  });
  return rows.map((o) => toOccurrenceSummary(o, cfg, now)).filter((o) => o.windowState === "OPEN");
}

/**
 * Check-ins the signed-in person could make right now: occurrences in their
 * check-in window, at clubs where they're an active member (host or approved
 * co-host), that are online (in person needs the QR code or the code shown
 * there), and that they haven't checked into.
 * Drives the mobile "check in?" pop-up and the web prompt.
 */
export async function liveOccurrencesForUser(actor: Actor | null, opts: { clubId?: string } = {}): Promise<LiveOccurrence[]> {
  assertSignedIn(actor);
  if (actor.status !== "ACTIVE") return [];
  return liveOccurrencesForUserId(actor.id, opts);
}

/** A club's occurrences (hosted or co-hosted) whose check-in window is open now, with head counts. */
export async function liveOccurrencesForClub(clubId: string): Promise<(LiveOccurrence & { checkedIn: number })[]> {
  const cfg = await getConfig();
  const now = new Date();
  const rows = await db.eventOccurrence.findMany({
    where: { ...liveWindowWhere(cfg, now), event: { status: "SCHEDULED", OR: [{ clubId }, { cohosts: { some: { clubId, status: "APPROVED" } } }] } },
    include: { ...occurrenceInclude, _count: { select: { attendances: true } } },
    orderBy: { startsAt: "asc" },
    take: 10,
  });
  return rows.map((o) => ({ ...toOccurrenceSummary(o, cfg, now), checkedIn: o._count.attendances })).filter((o) => o.windowState === "OPEN");
}

// ─── The live QR screen ─────────────────────────────────────────────────────

export type QrToken = {
  token: string;
  code: string;
  url: string;
  rotateSeconds: number;
  expiresInMs: number;
  windowState: WindowState;
  opensAt: Date;
  closesAt: Date;
};

export function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** The QR token to show right now. Requires "attendance" on the host club (admins for university events). */
export async function currentQrToken(actor: Actor | null, occurrenceId: string): Promise<QrToken> {
  const occ = await occurrenceById(parse(z.string().min(1), occurrenceId));
  if (!occ) throw notFound("Event");
  await assertCanManage(actor, occ);
  const cfg = await getConfig();
  const now = Date.now();
  const occurrence = toOccurrenceSummary(occ, cfg, new Date(now));
  if (occurrence.cancelled) throw invalid("This event was cancelled.");
  const rotateSeconds = cfg["checkin.qrRotateSeconds"];
  const w = tokenWindow(now, rotateSeconds);
  const token = checkinToken(occ.checkinSecret, w);
  return {
    token,
    code: occ.checkinCode,
    url: appUrl() + checkinPath(occ.checkinCode, token),
    rotateSeconds,
    expiresInMs: Math.max(0, (w + 1) * rotateSeconds * 1000 - now),
    windowState: occurrence.windowState,
    opensAt: occurrence.opensAt,
    closesAt: occurrence.closesAt,
  };
}

export type CheckinFeed = {
  count: number;
  windowState: WindowState;
  latest: { id: string; name: string; avatarUrl: string | null; avatarColor: string; method: CheckInMethod; checkedInAt: Date }[];
};

/** Live count and the latest arrivals for the QR screen. Names are shortened ("Maya C.") because the room can read them. */
export async function checkinFeed(actor: Actor | null, occurrenceId: string, take = 8): Promise<CheckinFeed> {
  const occ = await occurrenceById(parse(z.string().min(1), occurrenceId));
  if (!occ) throw notFound("Event");
  await assertCanManage(actor, occ);
  const cfg = await getConfig();
  const [count, latest] = await Promise.all([
    db.attendance.count({ where: { occurrenceId: occ.id } }),
    db.attendance.findMany({
      where: { occurrenceId: occ.id },
      orderBy: { checkedInAt: "desc" },
      take: Math.min(Math.max(take, 1), 20),
      select: { id: true, method: true, checkedInAt: true, user: { select: { name: true, avatarUrl: true, avatarColor: true } } },
    }),
  ]);
  return {
    count,
    windowState: toOccurrenceSummary(occ, cfg, new Date()).windowState,
    latest: latest.map((a) => ({ id: a.id, name: publicShortName(a.user.name), avatarUrl: a.user.avatarUrl, avatarColor: a.user.avatarColor, method: a.method, checkedInAt: a.checkedInAt })),
  };
}

/** Everything the live QR screen needs on first paint. */
export async function checkinScreen(actor: Actor | null, occurrenceId: string) {
  const occ = await occurrenceById(occurrenceId);
  if (!occ) throw notFound("Event");
  await assertCanManage(actor, occ);
  const cfg = await getConfig();
  const [token, feed] = await Promise.all([currentQrToken(actor, occurrenceId), checkinFeed(actor, occurrenceId)]);
  return { occurrence: toOccurrenceSummary(occ, cfg, new Date()), token, feed };
}
