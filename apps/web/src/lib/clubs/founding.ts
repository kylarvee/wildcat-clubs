import "server-only";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { ROLE_LABEL } from "@/lib/authz";
import { canSeeFormingClub } from "@/lib/authz/founding";
import { FOUNDING_STATUSES } from "@/lib/founding/rules";
import { officeById } from "@/lib/offices";

/**
 * Read side of founding (nothing here writes; the write path is lib/domain
 * clubs and cofounders): the founding team, founders' names for forming
 * clubs, and the clubs list's Forming section. A forming club shows only its
 * founders' names, never their contacts.
 */

/**
 * Founders' names per club: whoever started it, then everyone who joined as
 * a founder (membership source FOUNDER), in the order they joined. Active
 * members only.
 */
export async function foundersOf(clubIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!clubIds.length) return out;
  const [clubs, rows] = await Promise.all([
    db.club.findMany({ where: { id: { in: clubIds } }, select: { id: true, createdById: true } }),
    db.membership.findMany({
      where: { clubId: { in: clubIds }, status: "ACTIVE", user: { status: { not: "DEACTIVATED" } } },
      orderBy: [{ joinedAt: "asc" }, { requestedAt: "asc" }],
      select: { clubId: true, userId: true, source: true, user: { select: { name: true } } },
    }),
  ]);
  const creator = new Map(clubs.map((c) => [c.id, c.createdById]));
  for (const id of clubIds) {
    const mine = rows.filter((r) => r.clubId === id && (r.source === "FOUNDER" || r.userId === creator.get(id)));
    mine.sort((a, b) => Number(b.userId === creator.get(id)) - Number(a.userId === creator.get(id)));
    out.set(id, mine.map((r) => r.user.name));
  }
  return out;
}

export type FoundingTeamMember = { userId: string; name: string; avatarUrl: string | null; avatarColor: string; startedIt: boolean; seats: string[] };
export type FoundingTeamInvite = { id: string; name: string; email: string; createdAt: Date; hasAccount: boolean };

/** The founding team for the founders' Overview and the office's review: who's in (and their seats), and invitations still waiting. */
export async function foundingTeam(clubId: string): Promise<{ members: FoundingTeamMember[]; pending: FoundingTeamInvite[] }> {
  const [club, members, pending] = await Promise.all([
    db.club.findUnique({ where: { id: clubId }, select: { createdById: true } }),
    db.membership.findMany({
      where: { clubId, status: "ACTIVE", user: { status: { not: "DEACTIVATED" } } },
      orderBy: [{ joinedAt: "asc" }, { requestedAt: "asc" }],
      select: { userId: true, source: true, user: { select: { name: true, avatarUrl: true, avatarColor: true, kind: true } } },
    }),
    db.cofounderInvite.findMany({ where: { clubId, status: "PENDING" }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, email: true, createdAt: true, inviteeId: true } }),
  ]);
  const team = members.filter((m) => m.user.kind === "STUDENT" && (m.source === "FOUNDER" || m.userId === club?.createdById));
  const seats = team.length
    ? await db.roleAssignment.findMany({ where: { clubId, endedAt: null, userId: { in: team.map((m) => m.userId) }, role: { not: "MEMBER" } }, select: { userId: true, role: true, position: { select: { name: true } } } })
    : [];
  const label = (s: (typeof seats)[number]) => s.position?.name ?? ROLE_LABEL[s.role];
  return {
    members: team
      .map((m) => ({
        userId: m.userId,
        name: m.user.name,
        avatarUrl: m.user.avatarUrl,
        avatarColor: m.user.avatarColor,
        startedIt: m.userId === club?.createdById,
        seats: seats.filter((s) => s.userId === m.userId).map(label),
      }))
      .sort((a, b) => Number(b.startedIt) - Number(a.startedIt)),
    pending: pending.map((p) => ({ id: p.id, name: p.name, email: p.email, createdAt: p.createdAt, hasAccount: Boolean(p.inviteeId) })),
  };
}

export type FormingClub = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  logoUrl: string | null;
  logoColor: string;
  founders: string[];
  /** The office that will decide it ("WSUSA", "Campus Recreation"). */
  office: string;
  following: boolean;
};

/**
 * The clubs list's Forming section: clubs listed as forming (lib/founding/rules
 * isListedForming), newest first, with whether the viewer follows each.
 * Signed-in accounts only; signed-out visitors get nothing.
 */
export async function formingClubs(viewer: Actor | null): Promise<FormingClub[]> {
  if (!viewer || viewer.status === "DEACTIVATED") return [];
  const clubs = await db.club.findMany({
    where: { listedAsForming: true, status: { in: [...FOUNDING_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, slug: true, name: true, shortDescription: true, logoUrl: true, logoColor: true, officeId: true, status: true, listedAsForming: true },
  });
  const visible = clubs.filter((c) => canSeeFormingClub(viewer, c));
  if (!visible.length) return [];
  const ids = visible.map((c) => c.id);
  const [founders, follows, offices] = await Promise.all([
    foundersOf(ids),
    db.calendarSubscription.findMany({ where: { userId: viewer.id, clubId: { in: ids } }, select: { clubId: true } }),
    Promise.all(visible.map((c) => officeById(c.officeId))),
  ]);
  const followed = new Set(follows.map((f) => f.clubId));
  return visible.map((c, i) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    shortDescription: c.shortDescription,
    logoUrl: c.logoUrl,
    logoColor: c.logoColor,
    founders: founders.get(c.id) ?? [],
    office: offices[i].name,
    following: followed.has(c.id),
  }));
}
