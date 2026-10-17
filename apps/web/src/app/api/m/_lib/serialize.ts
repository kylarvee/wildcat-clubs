import "server-only";
import { format } from "date-fns";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { ROLE_LABEL, ROLE_RANK } from "@/lib/authz";
import { viewerClubState } from "@/lib/domain/memberships";
import type { OccurrenceSummary } from "@/lib/attendance/queries";
import type { FeedOccurrence } from "@/lib/events/feed";
import { KIND_LABEL, locationText } from "@/lib/events/labels";
import type { AnnouncementView } from "@/lib/domain/announcements";
import { richToText } from "@/lib/rich/sanitize";
import { fmtRange, inCampusTime } from "@/lib/time";
import type { MemberClubSummary } from "@/lib/metrics/types";
import type { ClubMetricsView } from "@/lib/clubs/queries";
import type { MAnnouncement, MAttendanceSummary, MClubMetrics, MClubRef, MEvent, MOccurrence, MUser, MViewerState } from "../_types";

/**
 * Turns domain and metrics shapes into the mobile contract (../_types).
 * Read-only: nothing here writes. Times are labelled in campus time so the
 * phone shows Weber State time whatever zone it's set to.
 */

const iso = (d: Date) => d.toISOString();

export function toMUser(a: Actor): MUser {
  return { id: a.id, name: a.name, email: a.email, handle: a.handle, kind: a.kind, status: a.status, platformRole: a.platformRole, avatarUrl: a.avatarUrl, avatarColor: a.avatarColor };
}

export function toClubRef(c: { id: string; name: string; slug: string; logoUrl: string | null; logoColor: string }): MClubRef {
  return { id: c.id, name: c.name, slug: c.slug, logoUrl: c.logoUrl, logoColor: c.logoColor };
}

/** "Elena" from "Dr. Elena Alvarez", "Maya" from "Maya Chen". */
export function firstName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const honorific = parts.length > 1 && /^(dr|prof|mr|mrs|ms|mx)\.?$/i.test(parts[0]);
  return (honorific ? parts[1] : parts[0]) ?? "there";
}

// ─── Time labels ─────────────────────────────────────────────────────────────

export function dayKey(d: Date) {
  return format(inCampusTime(d), "yyyy-MM-dd");
}

/** "6:00 – 8:00 PM", "11:30 AM – 1:00 PM", "All day", or a cross-day range. */
export function timeLabel(start: Date, end: Date, allDay: boolean) {
  const s = inCampusTime(start);
  const e = inCampusTime(end);
  if (allDay) return "All day";
  if (dayKey(start) !== dayKey(end)) return `${format(s, "MMM d, h:mm a")} – ${format(e, "MMM d, h:mm a")}`;
  const sameHalf = format(s, "a") === format(e, "a");
  return `${format(s, sameHalf ? "h:mm" : "h:mm a")} – ${format(e, "h:mm a")}`;
}

function dayLabel(d: Date) {
  return format(inCampusTime(d), "EEE, MMM d");
}

// ─── Events ──────────────────────────────────────────────────────────────────

export function toMOccurrence(o: OccurrenceSummary): MOccurrence {
  return {
    id: o.id,
    eventId: o.eventId,
    code: o.code,
    title: o.title,
    kindLabel: KIND_LABEL[o.kind],
    startsAt: iso(o.startsAt),
    endsAt: iso(o.endsAt),
    allDay: o.allDay,
    whenLabel: fmtRange(o.startsAt, o.endsAt, o.allDay),
    place: o.place,
    visibility: o.visibility,
    cancelled: o.cancelled,
    allowSelfCheckIn: o.allowSelfCheckIn,
    opensAt: iso(o.opensAt),
    closesAt: iso(o.closesAt),
    windowState: o.windowState,
    club: o.club ? toClubRef(o.club) : null,
    cohosts: o.cohosts.map(toClubRef),
  };
}

/** A calendar-feed row (lib/events/feed) as a list item. */
export function feedToMEvent(o: FeedOccurrence, now = new Date()): MEvent {
  const e = o.event;
  return {
    occurrenceId: o.id,
    eventId: e.id,
    title: e.title,
    kindLabel: KIND_LABEL[e.kind],
    startsAt: iso(o.startsAt),
    endsAt: iso(o.endsAt),
    allDay: e.allDay,
    dayKey: dayKey(o.startsAt),
    dayLabel: dayLabel(o.startsAt),
    timeLabel: timeLabel(o.startsAt, o.endsAt, e.allDay),
    location: locationText({ ...e, roomOverride: o.roomOverride }),
    isVirtual: e.locationType === "VIRTUAL",
    cancelled: o.status === "CANCELLED" || e.status === "CANCELLED",
    note: o.note,
    visibility: e.visibility,
    // The feed's club select has no logoUrl; colored initials are enough in a list.
    club: e.club ? { id: e.club.id, name: e.club.name, slug: e.club.slug, logoUrl: null, logoColor: e.club.logoColor } : null,
    cohostNames: e.cohosts.map((c) => c.club.name),
    happeningNow: o.startsAt <= now && now <= o.endsAt,
  };
}

// ─── Clubs ───────────────────────────────────────────────────────────────────

export function toMetrics(m: ClubMetricsView, hasMetrics: boolean): MClubMetrics {
  return {
    registeredMembers: m.registeredMembers,
    activeMembers: m.activeMembers,
    retentionRate: m.retentionRate,
    avgRating: m.avgRating,
    reviewCount: m.reviewCount,
    isActive: m.isActive,
    inPilot: m.inPilot,
    hasMetrics,
  };
}

export function toAttendanceSummary(s: MemberClubSummary): MAttendanceSummary {
  return {
    attended: s.attended,
    heldSinceJoined: s.heldSinceJoined,
    rate: s.rate,
    lastAttendedAt: s.lastAttendedAt ? iso(s.lastAttendedAt) : null,
    active: s.active,
    reviewEligible: s.reviewEligible,
    reviewThreshold: s.reviewThreshold,
  };
}

/** Seat names for someone's current roles, highest rank first, keyed by club. */
export async function currentSeats(userId: string, clubIds?: string[]) {
  const rows = await db.roleAssignment.findMany({
    where: { userId, endedAt: null, ...(clubIds ? { clubId: { in: clubIds } } : {}) },
    select: { clubId: true, role: true, startedAt: true, position: { select: { name: true } } },
  });
  const byClub = new Map<string, { role: (typeof rows)[number]["role"]; title: string; since: Date }>();
  for (const r of [...rows].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])) {
    if (!byClub.has(r.clubId)) byClub.set(r.clubId, { role: r.role, title: r.position?.name ?? ROLE_LABEL[r.role], since: r.startedAt });
  }
  return byClub;
}

/** The register / subscribe state for one club, with the seat name when they hold one. */
export async function viewerState(actor: Actor | null, clubId: string): Promise<MViewerState> {
  const s = await viewerClubState(actor, clubId);
  if (!s.signedIn || !actor) return { signedIn: false, isMember: false, isPending: false, isLeader: false, role: null, roleLabel: null, subscribed: false };
  const seat = s.role && s.role !== "MEMBER" ? (await currentSeats(actor.id, [clubId])).get(clubId) : undefined;
  return {
    signedIn: true,
    isMember: s.isMember,
    isPending: s.isPending,
    isLeader: s.isLeader,
    role: s.role,
    roleLabel: seat?.title ?? (s.role ? ROLE_LABEL[s.role] : null),
    subscribed: s.subscribed,
  };
}

// ─── Announcements ───────────────────────────────────────────────────────────

export function toMAnnouncement(a: AnnouncementView): MAnnouncement {
  return {
    id: a.id,
    title: a.title,
    bodyText: richToText(a.bodyHtml, 280),
    pinned: a.pinned,
    createdAt: iso(a.createdAt),
    authorName: a.author.name,
    club: a.club ? toClubRef(a.club) : null,
  };
}
