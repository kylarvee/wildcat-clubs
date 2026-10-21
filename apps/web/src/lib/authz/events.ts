import "server-only";
import type { EventReview, Prisma, Visibility } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, isAdmin } from "@/lib/authz";
import { eventVisibilityWhere, LISTED_EVENT_CLUB_STATUSES } from "@/lib/authz/event-visibility";
import { UNDER_REVIEW } from "@/lib/events/review";

export { eventVisibilityWhere, PUBLISHED_EVENT, type EventViewer } from "@/lib/authz/event-visibility";

/**
 * THE event-visibility rule. Calendars, ICS feeds, event pages, rich-text
 * event embeds, the AI assistant and the mobile API all ask here.
 *
 *   PUBLIC      anyone, signed in or not
 *   UNIVERSITY  any signed-in Weber State account
 *   MEMBERS     members and leaders of the host club or an approved co-host club
 *               (a university event marked MEMBERS is treated as UNIVERSITY)
 *   Cancelled events stay visible (crossed out) under the same rule.
 *   Events of clubs that aren't approved (or retired) show only to that club's leaders.
 *   Waiting for review (lib/events/review: PENDING or CHANGES_REQUESTED): only
 *   the host club's leaders and the office that oversees the club (and WSUSA's
 *   admins), and only where a caller asks for them (`underReview`: the Events
 *   Builder's calendar, the event page). Everywhere else lists published events only.
 *   Admins see everything. An office's staff see their own office's clubs' events
 *   the way the club's advisor does (members-only ones too).
 */

export type EventGate = {
  id: string;
  clubId: string | null;
  visibility: Visibility;
  club?: { status: string } | null;
  cohosts?: { clubId: string; status: string }[];
  /** Left out: read from the event. */
  reviewStatus?: EventReview;
};

export type EventAccess = { ok: true } | { ok: false; reason: "signin" | "members" | "hidden" };

/** Clubs whose MEMBERS-only events this person may see: active memberships + current roles. */
export async function viewerEventClubIds(actor: Actor | null): Promise<string[]> {
  if (!actor) return [];
  const [memberships, roles] = await Promise.all([
    db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, select: { clubId: true } }),
    db.roleAssignment.findMany({ where: { userId: actor.id, endedAt: null }, select: { clubId: true } }),
  ]);
  return [...new Set([...memberships, ...roles].map((r) => r.clubId))];
}

/** The rule as a filter (lib/authz/event-visibility), loading the viewer's clubs (and the clubs they lead, when events under review are asked for). */
export async function visibleEventsWhere(actor: Actor | null, opts: { includeMembersOnly?: boolean; underReview?: boolean } = {}): Promise<Prisma.EventWhereInput> {
  const leaderClubIds = opts.underReview && actor ? (await db.roleAssignment.findMany({ where: { userId: actor.id, endedAt: null, role: { not: "MEMBER" } }, select: { clubId: true } })).map((r) => r.clubId) : [];
  return eventVisibilityWhere({ signedIn: Boolean(actor), admin: isAdmin(actor), memberClubIds: await viewerEventClubIds(actor), leaderClubIds, officeIds: actor?.officeIds ?? [] }, opts);
}

/** Whether `actor` may see this event, and if not, what would let them. */
export async function eventAccess(actor: Actor | null, event: EventGate): Promise<EventAccess> {
  if (isAdmin(actor)) return { ok: true };
  const host = actor && event.clubId ? await getClubAccess(actor, event.clubId) : null;
  if (event.clubId) {
    const clubStatus = event.club?.status ?? (await db.club.findUnique({ where: { id: event.clubId }, select: { status: true } }))?.status;
    if (!clubStatus) return { ok: false, reason: "hidden" };
    if (!LISTED_EVENT_CLUB_STATUSES.includes(clubStatus) && !host?.isLeader) return { ok: false, reason: "hidden" };
    // Waiting for review: the club's leaders and its office only (getClubAccess counts the office's staff as leaders there).
    const review = event.reviewStatus ?? (await db.event.findUnique({ where: { id: event.id }, select: { reviewStatus: true } }))?.reviewStatus;
    if (review && UNDER_REVIEW.includes(review) && !host?.isLeader) return { ok: false, reason: "hidden" };
  }
  if (event.visibility === "PUBLIC") return { ok: true };
  if (!actor) return { ok: false, reason: "signin" };
  if (event.visibility === "UNIVERSITY" || !event.clubId) return { ok: true };
  if (host?.isMember || host?.isLeader) return { ok: true };
  const cohosts = event.cohosts ?? (await db.eventCohost.findMany({ where: { eventId: event.id }, select: { clubId: true, status: true } }));
  for (const c of cohosts) {
    if (c.status !== "APPROVED") continue;
    const a = await getClubAccess(actor, c.clubId);
    if (a?.isMember || a?.isLeader) return { ok: true };
  }
  return { ok: false, reason: "members" };
}

export async function canViewEvent(actor: Actor | null, event: EventGate): Promise<boolean> {
  return (await eventAccess(actor, event)).ok;
}
