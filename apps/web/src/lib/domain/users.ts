import "server-only";
import type { PlatformRole, Prisma, UserKind, UserStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { isSysadmin } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { campusDate } from "@/lib/time";
import { assertCan, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify } from "@/lib/domain/notify";
import { endAllRolesForUser } from "@/lib/domain/roles";

/**
 * People (admin.users). Admins look people up and change account status:
 * mark a student graduated (alumni), or deactivate / reactivate an account.
 * People are never deleted — their history belongs to the clubs they served.
 * Platform roles (admin, sysadmin) are changed only by sysadmins, in
 * lib/domain/system.ts.
 */

export const USERS_PAGE_SIZE = 50;

export type UserSearch = {
  q?: string | null;
  kind?: UserKind | null;
  role?: PlatformRole | null;
  status?: UserStatus | null;
  page?: number;
};

export async function searchUsers(actor: Actor | null, s: UserSearch) {
  assertCan(actor, "admin.users");
  const q = s.q?.trim().slice(0, 100) ?? "";
  const where: Prisma.UserWhereInput = {
    ...(s.kind ? { kind: s.kind } : {}),
    ...(s.role ? { platformRole: s.role } : {}),
    ...(s.status ? { status: s.status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { handle: { contains: q.replace(/^@/, ""), mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const page = Math.max(1, Math.floor(s.page ?? 1));
  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * USERS_PAGE_SIZE,
      take: USERS_PAGE_SIZE,
      select: {
        id: true, name: true, email: true, handle: true, avatarUrl: true, avatarColor: true, kind: true, platformRole: true, status: true, lastSeenAt: true, createdAt: true,
        _count: { select: { memberships: { where: { status: "ACTIVE" } }, roleAssignments: { where: { endedAt: null, role: { not: "MEMBER" } } } } },
      },
    }),
  ]);
  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)),
    rows: rows.map(({ _count, ...u }) => ({ ...u, clubs: _count.memberships, roles: _count.roleAssignments })),
  };
}

/** Everything the People page shows about one person. Report-related activity is left out on purpose. */
export async function userDetail(actor: Actor | null, userId: string) {
  assertCan(actor, "admin.users");
  const user = await db.user.findUnique({
    where: { id: String(userId ?? "") },
    select: {
      id: true, name: true, email: true, handle: true, pronouns: true, avatarUrl: true, avatarColor: true, kind: true, platformRole: true, status: true,
      headline: true, jobTitle: true, classYear: true, graduatedAt: true, createdAt: true, lastSeenAt: true, hasMobileApp: true,
      department: { select: { name: true } },
      majors: { select: { isMinor: true, major: { select: { name: true } } } },
    },
  });
  if (!user) throw notFound("That person");
  const [memberships, roles, pastRoleCount, pastRoles, checkins, activity] = await Promise.all([
    db.membership.findMany({
      where: { userId: user.id },
      orderBy: [{ status: "asc" }, { joinedAt: "desc" }],
      select: { id: true, status: true, source: true, joinedAt: true, requestedAt: true, endedAt: true, internalTitle: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, logoColor: true, status: true } } },
    }),
    db.roleAssignment.findMany({
      where: { userId: user.id, endedAt: null },
      orderBy: { startedAt: "desc" },
      select: { id: true, role: true, permissions: true, startedAt: true, position: { select: { name: true } }, club: { select: { id: true, name: true, slug: true } }, viaClub: { select: { name: true } } },
    }),
    db.roleAssignment.count({ where: { userId: user.id, endedAt: { not: null }, role: { not: "MEMBER" } } }),
    db.roleAssignment.findMany({
      where: { userId: user.id, endedAt: { not: null }, role: { not: "MEMBER" } },
      orderBy: { endedAt: "desc" },
      take: 8,
      select: { id: true, role: true, startedAt: true, endedAt: true, endReason: true, position: { select: { name: true } }, club: { select: { id: true, name: true, slug: true } } },
    }),
    db.attendance.count({ where: { userId: user.id } }),
    db.activityLog.findMany({
      // Reports stay inside the Reports tool: never list them on a person's page.
      where: { actorId: user.id, NOT: { action: { startsWith: "complaint." } } },
      orderBy: { at: "desc" },
      take: 25,
      select: { id: true, at: true, action: true, entityType: true, club: { select: { name: true, slug: true } } },
    }),
  ]);
  return { user, memberships, roles, pastRoles, pastRoleCount, checkins, activity: activity.map((a) => ({ ...a, id: a.id.toString() })) };
}

/** Admins can change anyone's status except their own; only sysadmins can change another admin's. */
async function loadTarget(actor: Actor, userId: string) {
  const target = await db.user.findUnique({ where: { id: String(userId ?? "") }, select: { id: true, name: true, handle: true, kind: true, status: true, platformRole: true, graduatedAt: true } });
  if (!target) throw notFound("That person");
  if (target.id === actor.id) throw forbidden("You can't change your own account status. Ask another administrator.");
  if (target.platformRole !== "USER" && !isSysadmin(actor)) throw forbidden("Only a system administrator can change another administrator's account.");
  return target;
}

const GraduateInput = z.object({
  graduatedOn: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter the graduation date as YYYY-MM-DD."),
});

/**
 * Marks a student graduated: status ALUMNI, graduatedAt set, and every role
 * they hold ends as GRADUATED (memberships become alumni). Their history,
 * contributions and attendance stay on their profile and in the clubs.
 */
export async function markUserGraduatedByAdmin(actor: Actor | null, userId: string, input: unknown = {}) {
  assertCan(actor, "admin.users");
  const v = parse(GraduateInput, input ?? {});
  const target = await loadTarget(actor, userId);
  if (target.kind !== "STUDENT") throw invalid("Only student accounts graduate. For faculty or staff who left, deactivate the account instead.");
  if (target.status === "ALUMNI") throw conflict(`${target.name} is already an alumnus.`);
  if (target.status === "DEACTIVATED") throw conflict(`${target.name}'s account is deactivated. Reactivate it first.`);

  let graduatedAt = new Date();
  if (v.graduatedOn) {
    const [y, m, d] = v.graduatedOn.split("-").map(Number);
    graduatedAt = campusDate(y, m, d, 12, 0);
    if (Number.isNaN(graduatedAt.getTime())) throw invalid("That graduation date isn't a real date.");
    if (graduatedAt.getTime() > Date.now() + 86_400_000) throw invalid("The graduation date can't be in the future.");
  }

  await db.user.update({ where: { id: target.id }, data: { status: "ALUMNI", graduatedAt } });
  const ended = await endAllRolesForUser(target.id, "GRADUATED", actor.id);
  await logActivity({ actorId: actor.id, action: "user.graduated", entityType: "user", entityId: target.id, data: { by: "admin", endedRoles: ended.endedAssignments } });
  await notify({
    userIds: [target.id],
    kind: "profile.alumni",
    title: "Your profile is now an alumni profile",
    body: "Congratulations, Wildcat! Your club roles, projects and history stay on your profile.",
    href: `/u/${target.handle}`,
    email: false,
  });
  return ended;
}

/** Undo a graduation marked by mistake. Roles that ended don't come back — leaders reassign them. */
export async function markUserCurrentByAdmin(actor: Actor | null, userId: string) {
  assertCan(actor, "admin.users");
  const target = await loadTarget(actor, userId);
  if (target.status !== "ALUMNI") throw conflict(`${target.name} isn't marked as an alumnus.`);
  await db.user.update({ where: { id: target.id }, data: { status: "ACTIVE", graduatedAt: null } });
  await logActivity({ actorId: actor.id, action: "user.alumni_undone", entityType: "user", entityId: target.id });
}

const DeactivateInput = z.object({
  reason: z.string({ error: "Give a short reason." }).trim().min(3, "Give a short reason (for the record).").max(500, "Keep the reason under 500 characters."),
});

/**
 * Deactivates an account: it can't sign in (sessions end now), every role
 * ends as REMOVED, and memberships close. Nothing is deleted, and the
 * account can be reactivated.
 */
export async function deactivateUser(actor: Actor | null, userId: string, input: unknown) {
  assertCan(actor, "admin.users");
  const { reason } = parse(DeactivateInput, input);
  const target = await loadTarget(actor, userId);
  if (target.status === "DEACTIVATED") throw conflict(`${target.name}'s account is already deactivated.`);
  await db.user.update({ where: { id: target.id }, data: { status: "DEACTIVATED" } });
  // Signed out everywhere, web and mobile.
  await db.session.deleteMany({ where: { userId: target.id } });
  const ended = await endAllRolesForUser(target.id, "REMOVED", actor.id);
  await logActivity({ actorId: actor.id, action: "user.deactivated", entityType: "user", entityId: target.id, data: { reason, previousStatus: target.status, endedRoles: ended.endedAssignments } });
  return ended;
}

/** Lets a deactivated account sign in again (as alumni if they had graduated). Roles aren't restored. */
export async function reactivateUser(actor: Actor | null, userId: string) {
  assertCan(actor, "admin.users");
  const target = await loadTarget(actor, userId);
  if (target.status !== "DEACTIVATED") throw conflict(`${target.name}'s account isn't deactivated.`);
  const status: UserStatus = target.graduatedAt ? "ALUMNI" : "ACTIVE";
  await db.user.update({ where: { id: target.id }, data: { status } });
  await logActivity({ actorId: actor.id, action: "user.reactivated", entityType: "user", entityId: target.id, data: { status } });
  return { status };
}
