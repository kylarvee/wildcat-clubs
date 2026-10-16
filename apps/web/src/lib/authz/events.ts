import "server-only";
import type { EventStatus, Prisma, Visibility } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, isAdmin } from "@/lib/authz";

/**
 * THE event-visibility rule. Calendars, ICS feeds, event pages, rich-text
 * event embeds, the AI assistant and the mobile API all ask here.
 *
 *   PUBLIC      anyone, signed in or not
 *   UNIVERSITY  any signed-in Weber State account
 *   MEMBERS     members and leaders of the host club or an approved co-host club
 *               (a university event marked MEMBERS is treated as UNIVERSITY)
 *   Drafts (a club's idea list) show only to the host club's event planners.
 *   Events of clubs that aren't approved (or retired) show only to that club's leaders.
 *   Admins see everything.
 */

export type EventGate = {
  id: string;
  clubId: string | null;
  visibility: Visibility;
  status: EventStatus;
  club?: { status: string } | null;
  cohosts?: { clubId: string; status: string }[];
};

export type EventAccess = { ok: true } | { ok: false; reason: "signin" | "members" | "hidden" };

const LISTED_CLUB_STATUSES = ["APPROVED", "RETIRED"] as const;

/** Clubs whose MEMBERS-only events this person may see: active memberships + current roles. */
export async function viewerEventClubIds(actor: Actor | null): Promise<string[]> {
  if (!actor) return [];
  const [memberships, roles] = await Promise.all([
    db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, select: { clubId: true } }),
    db.roleAssignment.findMany({ where: { userId: actor.id, endedAt: null }, select: { clubId: true } }),
  ]);
  return [...new Set([...memberships, ...roles].map((r) => r.clubId))];
}

/**
 * Prisma filter for the non-draft events a viewer may see.
 * `membersOnly: false` leaves MEMBERS events out entirely (public listings).
 */
export function eventVisibilityWhere(
  viewer: { signedIn: boolean; admin: boolean; memberClubIds: string[] },
  opts: { includeMembersOnly?: boolean } = {},
): Prisma.EventWhereInput {
  const notDraft: Prisma.EventWhereInput = { status: { not: "DRAFT" } };
  if (viewer.admin) return notDraft;
  const listedClub: Prisma.EventWhereInput = { OR: [{ clubId: null }, { club: { status: { in: [...LISTED_CLUB_STATUSES] } } }] };
  if (!viewer.signedIn) return { AND: [notDraft, listedClub, { visibility: "PUBLIC" }] };
  const open: Prisma.EventWhereInput[] = [{ visibility: { in: ["PUBLIC", "UNIVERSITY"] } }, { visibility: "MEMBERS", clubId: null }];
  const members: Prisma.EventWhereInput[] =
    opts.includeMembersOnly === false
      ? []
      : [
          { visibility: "MEMBERS", clubId: { in: viewer.memberClubIds } },
          { visibility: "MEMBERS", cohosts: { some: { status: "APPROVED", clubId: { in: viewer.memberClubIds } } } },
        ];
  return { AND: [notDraft, listedClub, { OR: [...open, ...members] }] };
}

/** The same filter, loading the viewer's clubs. */
export async function visibleEventsWhere(actor: Actor | null, opts: { includeMembersOnly?: boolean } = {}): Promise<Prisma.EventWhereInput> {
  return eventVisibilityWhere({ signedIn: Boolean(actor), admin: isAdmin(actor), memberClubIds: await viewerEventClubIds(actor) }, opts);
}

/** Whether `actor` may see this event, and if not, what would let them. */
export async function eventAccess(actor: Actor | null, event: EventGate): Promise<EventAccess> {
  if (isAdmin(actor)) return { ok: true };
  const host = actor && event.clubId ? await getClubAccess(actor, event.clubId) : null;
  if (event.status === "DRAFT") return host?.capabilities.has("events") ? { ok: true } : { ok: false, reason: "hidden" };
  if (event.clubId) {
    const clubStatus = event.club?.status ?? (await db.club.findUnique({ where: { id: event.clubId }, select: { status: true } }))?.status;
    if (!clubStatus) return { ok: false, reason: "hidden" };
    if (!(LISTED_CLUB_STATUSES as readonly string[]).includes(clubStatus) && !host?.isLeader) return { ok: false, reason: "hidden" };
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
