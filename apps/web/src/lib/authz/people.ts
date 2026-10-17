import "server-only";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, type Capability } from "@/lib/authz";

/**
 * The capabilities a person's own club roles give them in a club right now:
 * getClubAccess's rule, leaving any platform role out. Advisors, presidents
 * and VPs hold every capability, officers and ambassadors what their seat
 * grants; overdue officer requirements pause a student leader's capabilities
 * (advisors never pause); and a club allows only its phase's capabilities
 * (founding: profile, org chart, constitution, files; retired or rejected: none).
 * Task routing, inboxes and notifications all use this, so nobody is asked to
 * do what their access wouldn't let them do.
 */
export async function roleCapabilities(userId: string, clubId: string): Promise<Set<Capability>> {
  // getClubAccess reads only the id and platform role; "USER" leaves admin powers out of it.
  const access = await getClubAccess({ id: userId, platformRole: "USER" } as Actor, clubId);
  return access?.capabilities ?? new Set();
}

/** Who holds a capability in a club right now (for routing tasks and notifications). */
export async function clubCapabilityHolders(clubId: string, cap: Capability): Promise<string[]> {
  const rows = await db.roleAssignment.findMany({
    where: { clubId, endedAt: null, user: { status: "ACTIVE" } },
    select: { userId: true },
    distinct: ["userId"],
  });
  const ids: string[] = [];
  for (const r of rows) if ((await roleCapabilities(r.userId, clubId)).has(cap)) ids.push(r.userId);
  return ids;
}

/** Advisors of a club. */
export async function clubAdvisors(clubId: string): Promise<string[]> {
  const rows = await db.roleAssignment.findMany({ where: { clubId, role: "ADVISOR", endedAt: null }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** Every admin and sysadmin. */
export async function adminIds(): Promise<string[]> {
  const rows = await db.user.findMany({ where: { platformRole: { in: ["ADMIN", "SYSADMIN"] }, status: "ACTIVE" }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Active members of a club (for announcements and the club chat). */
export async function activeMemberIds(clubId: string): Promise<string[]> {
  const rows = await db.membership.findMany({ where: { clubId, status: "ACTIVE" }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** Clubs where the user holds a capability (for task inboxes and leader nav). */
export async function clubsWhereUserHolds(userId: string, cap: Capability): Promise<string[]> {
  return (await capabilitiesByClub(userId)).filter(([, caps]) => caps.has(cap)).map(([clubId]) => clubId);
}

/** Every club where the user holds a role, with the capabilities it gives them (roleCapabilities). */
export async function capabilitiesByClub(userId: string): Promise<[clubId: string, caps: Set<Capability>][]> {
  const rows = await db.roleAssignment.findMany({ where: { userId, endedAt: null }, select: { clubId: true }, distinct: ["clubId"] });
  const out: [string, Set<Capability>][] = [];
  for (const r of rows) out.push([r.clubId, await roleCapabilities(userId, r.clubId)]);
  return out;
}
