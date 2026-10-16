import "server-only";
import type { ClubRole, ClubType, RoleEndReason } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { ALL_CAPABILITIES, CAPABILITIES, getClubAccess, ROLE_LABEL, ROLE_RANK, type Capability } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify } from "@/lib/domain/notify";
import { openRequirementTasks } from "@/lib/domain/requirements";
import { seatsFor } from "@/lib/roles/defaults";

/**
 * Role changes — the only way anyone gains or loses a club role. The Org Chart
 * tool, presidential hand-offs, election results and advisor acceptance all
 * end up in grantRole()/endRoleAssignment(), so the role history stays complete.
 */

export async function createDefaultPositions(clubId: string, type: ClubType, tx: Tx = db) {
  const seats = seatsFor(type);
  await tx.position.createMany({
    data: seats.map((s, i) => ({
      clubId,
      role: s.role,
      name: s.name,
      responsibilities: s.responsibilities,
      defaultPermissions: s.defaultPermissions,
      maxHolders: s.maxHolders,
      isCore: Boolean(s.isCore),
      sortOrder: i,
    })),
  });
}

function cleanPermissions(perms: string[] | undefined | null): Capability[] {
  return [...new Set((perms ?? []).filter((p): p is Capability => p in CAPABILITIES))];
}

/**
 * System-level grant (no permission check). Used by founding (founder becomes
 * President), advisor acceptance and applying checked decisions. Ensures an
 * ACTIVE membership, records the assignment and opens requirement tasks.
 */
export async function grantRole(input: {
  clubId: string;
  userId: string;
  role: ClubRole;
  positionId?: string | null;
  permissions?: string[];
  viaClubId?: string | null;
  assignedById: string | null;
  endAssignmentIds?: string[];
  endReason?: RoleEndReason;
}) {
  const now = new Date();
  const assignment = await db.$transaction(async (tx) => {
    if (input.endAssignmentIds?.length) {
      await tx.roleAssignment.updateMany({
        where: { id: { in: input.endAssignmentIds }, clubId: input.clubId, endedAt: null },
        data: { endedAt: now, endReason: input.endReason ?? "SUCCEEDED" },
      });
    }
    await tx.membership.upsert({
      where: { userId_clubId: { userId: input.userId, clubId: input.clubId } },
      create: { userId: input.userId, clubId: input.clubId, status: "ACTIVE", source: input.role === "ADVISOR" ? "ADVISOR" : "REGISTER", joinedAt: now },
      update: { status: "ACTIVE", endedAt: null },
    });
    await tx.calendarSubscription.upsert({
      where: { userId_clubId: { userId: input.userId, clubId: input.clubId } },
      create: { userId: input.userId, clubId: input.clubId },
      update: {},
    });
    const a = await tx.roleAssignment.create({
      data: {
        clubId: input.clubId,
        userId: input.userId,
        role: input.role,
        positionId: input.positionId ?? null,
        permissions: input.role === "OFFICER" || input.role === "AMBASSADOR" ? cleanPermissions(input.permissions) : [],
        viaClubId: input.viaClubId ?? null,
        assignedById: input.assignedById,
        startedAt: now,
      },
      include: { position: { select: { name: true } }, club: { select: { name: true, slug: true, approvedAt: true } } },
    });
    await logActivity(
      {
        actorId: input.assignedById,
        action: "role.assigned",
        entityType: "roleAssignment",
        entityId: a.id,
        clubId: input.clubId,
        data: { userId: input.userId, role: input.role, position: a.position?.name ?? null },
        isPublic: true,
      },
      tx,
    );
    return a;
  });

  if (input.role !== "ADVISOR" && ROLE_RANK[input.role] >= 1) {
    await openRequirementTasks(input.userId, input.role, { clubId: input.clubId, assignmentStartedAt: now, clubApprovedAt: assignment.club.approvedAt });
  }
  if (input.assignedById && input.assignedById !== input.userId) {
    await notify({
      userIds: [input.userId],
      kind: "role.assigned",
      title: `You're now ${assignment.position?.name ?? ROLE_LABEL[input.role]} of ${assignment.club.name}`,
      href: `/clubs/${assignment.club.slug}`,
    });
  }
  return assignment;
}

const AssignInput = z.object({
  clubId: z.string(),
  userId: z.string(),
  positionId: z.string(),
  permissions: z.array(z.string()).optional(),
  /** Assignments to end in the same step (e.g. the outgoing holder of a full seat). */
  replaceAssignmentIds: z.array(z.string()).optional(),
});

/** Org Chart: put someone in a seat. Enforces "only roles below yours" (President may also name a President). */
export async function assignRole(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const v = parse(AssignInput, input);
  const access = await getClubAccess(actor, v.clubId);
  if (!access) throw notFound("Club");
  const position = await db.position.findUnique({ where: { id: v.positionId } });
  if (!position || position.clubId !== v.clubId || position.archivedAt) throw notFound("Seat");
  if (!access.assignableRoles.includes(position.role)) {
    throw forbidden(`You can't assign the ${ROLE_LABEL[position.role]} role.`);
  }
  const target = await db.user.findUnique({ where: { id: v.userId }, select: { id: true, kind: true, status: true } });
  if (!target || target.status !== "ACTIVE") throw invalid("That person can't take a role.");
  if (target.kind !== "STUDENT") throw invalid("Club roles are for students. Faculty and staff join as advisors.");
  const membership = await db.membership.findUnique({ where: { userId_clubId: { userId: v.userId, clubId: v.clubId } } });
  if (membership?.status !== "ACTIVE") throw invalid("Only active members can be given a role.");

  const holders = await db.roleAssignment.findMany({ where: { positionId: position.id, endedAt: null } });
  if (holders.some((h) => h.userId === v.userId)) throw conflict("They already hold this seat.");
  const ending = (v.replaceAssignmentIds ?? []).filter((id) => holders.some((h) => h.id === id));
  if (holders.length - ending.length >= position.maxHolders) {
    throw conflict(`${position.name} is full. Choose who they replace.`);
  }
  // Replacing someone is ending their role, which needs the same rank rule.
  for (const id of ending) {
    const h = holders.find((x) => x.id === id)!;
    if (!access.assignableRoles.includes(h.role)) throw forbidden();
  }

  return grantRole({
    clubId: v.clubId,
    userId: v.userId,
    role: position.role,
    positionId: position.id,
    permissions: v.permissions ?? position.defaultPermissions,
    assignedById: actor.id,
    endAssignmentIds: ending,
    endReason: "SUCCEEDED",
  });
}

/**
 * End a role. Allowed for: the holder themselves (resigning — except the last
 * President, who must name a successor first), anyone who could assign that
 * role, advisors and admins.
 */
export async function endRoleAssignment(actor: Actor | null, assignmentId: string, reason: RoleEndReason = "RESIGNED") {
  assertSignedIn(actor);
  const a = await db.roleAssignment.findUnique({ where: { id: assignmentId } });
  if (!a || a.endedAt) throw notFound("Role");
  const access = await getClubAccess(actor, a.clubId);
  if (!access) throw notFound("Club");
  const self = a.userId === actor.id;
  const full = access.viaPlatform !== null || access.isAdvisor;
  if (a.role === "ADVISOR" && !full) throw forbidden("Only an admin or the advisor can end an advisor's role.");
  if (!self && !full && !access.assignableRoles.includes(a.role)) throw forbidden();
  if (a.role === "PRESIDENT" && !full) {
    const others = await db.roleAssignment.count({ where: { clubId: a.clubId, role: "PRESIDENT", endedAt: null, id: { not: a.id } } });
    if (others === 0) throw forbidden("Name the next President before stepping down.");
  }
  await db.roleAssignment.update({ where: { id: a.id }, data: { endedAt: new Date(), endReason: reason } });
  await logActivity({ actorId: actor.id, action: "role.ended", entityType: "roleAssignment", entityId: a.id, clubId: a.clubId, data: { userId: a.userId, role: a.role, reason }, isPublic: true });
  return a;
}

/** Change what an officer/ambassador may do. */
export async function setRolePermissions(actor: Actor | null, assignmentId: string, permissions: string[]) {
  assertSignedIn(actor);
  const a = await db.roleAssignment.findUnique({ where: { id: assignmentId } });
  if (!a || a.endedAt) throw notFound("Role");
  if (a.role !== "OFFICER" && a.role !== "AMBASSADOR") throw invalid("Only officer and ambassador permissions are customizable.");
  const access = await getClubAccess(actor, a.clubId);
  if (!access?.assignableRoles.includes(a.role)) throw forbidden();
  const perms = cleanPermissions(permissions);
  await db.roleAssignment.update({ where: { id: a.id }, data: { permissions: perms } });
  await logActivity({ actorId: actor.id, action: "role.permissions_set", entityType: "roleAssignment", entityId: a.id, clubId: a.clubId, data: { permissions: perms } });
}

export { ALL_CAPABILITIES };
