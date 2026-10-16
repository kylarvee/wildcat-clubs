import "server-only";
import { db } from "@/lib/db";
import type { Capability } from "@/lib/authz";

/**
 * Who holds a capability in a club right now (for routing tasks and
 * notifications). Advisors, presidents and VPs hold every capability;
 * officers and ambassadors hold what their seat grants.
 */
export async function clubCapabilityHolders(clubId: string, cap: Capability): Promise<string[]> {
  const rows = await db.roleAssignment.findMany({
    where: { clubId, endedAt: null, user: { status: "ACTIVE" } },
    select: { userId: true, role: true, permissions: true },
  });
  const ids = rows
    .filter((r) => r.role === "ADVISOR" || r.role === "PRESIDENT" || r.role === "VP" || r.permissions.includes(cap))
    .map((r) => r.userId);
  return [...new Set(ids)];
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
  const rows = await db.roleAssignment.findMany({ where: { userId, endedAt: null }, select: { clubId: true, role: true, permissions: true } });
  return [...new Set(rows.filter((r) => r.role === "ADVISOR" || r.role === "PRESIDENT" || r.role === "VP" || r.permissions.includes(cap)).map((r) => r.clubId))];
}
