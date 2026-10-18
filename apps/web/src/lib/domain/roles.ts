import "server-only";
import type { ClubRole, ClubType, RoleEndReason } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { ALL_CAPABILITIES, CAPABILITIES, getClubAccess, ROLE_LABEL, ROLE_RANK, type Capability, type ClubAccess } from "@/lib/authz";
import { clubAdvisors, clubCapabilityHolders } from "@/lib/authz/people";
import { logActivity } from "@/lib/lake/activity";
import { assertClubCap, assertSignedIn, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify } from "@/lib/domain/notify";
import { openRequirementTasks, reopenRequirementTasks } from "@/lib/domain/requirements";
import { resolveTasks } from "@/lib/domain/tasks";
import { canViewFile } from "@/lib/domain/files";
import { sanitizeRichHtml } from "@/lib/rich/sanitize";
import { AMBASSADOR_REQUEST } from "@/lib/ambassadors/rules";
import { COLLEGE_AMBASSADOR_SEAT, isClubRepSeat, seatsFor } from "@/lib/roles/defaults";
import { END_REASON_LABEL } from "@/lib/roles/labels";

/**
 * Role changes — the only way anyone gains or loses a club role. The Org Chart
 * tool, presidential hand-offs, election results, ambassador placements and
 * advisor acceptance all end up in grantRole()/endRoleAssignment(), so the
 * role history stays complete. Assignments are never deleted, only ended.
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
 * Only a college's ambassador program puts people in a club's ambassador
 * seats, but the club's President and VPs (and its advisors) still decide
 * what a placed ambassador may do there, and may end a placement.
 */
function managesPlacedAmbassadors(access: ClubAccess) {
  return access.viaPlatform !== null || access.isAdvisor || (!access.suspended && (access.role === "PRESIDENT" || access.role === "VP"));
}

/**
 * System-level grant (no permission check). Used by founding (founder becomes
 * President), advisor acceptance and applying checked decisions. Ensures an
 * ACTIVE membership, records the assignment and opens requirement tasks.
 *
 * A seat's row is locked for the transaction, so grants to one seat run one at
 * a time. With `checkSeat`, the caller's "already holds it / seat is full"
 * checks are repeated under that lock, so two people assigning at once can't
 * overfill a seat or seat someone twice.
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
  checkSeat?: boolean;
}) {
  const now = new Date();
  let endedUserIds: string[] = [];
  const assignment = await db.$transaction(async (tx) => {
    if (input.positionId) await tx.$queryRaw`SELECT id FROM "Position" WHERE id = ${input.positionId} FOR UPDATE`;
    if (input.endAssignmentIds?.length) {
      const where = { id: { in: input.endAssignmentIds }, clubId: input.clubId, endedAt: null };
      endedUserIds = [...new Set((await tx.roleAssignment.findMany({ where, select: { userId: true } })).map((r) => r.userId))];
      await tx.roleAssignment.updateMany({ where, data: { endedAt: now, endReason: input.endReason ?? "SUCCEEDED" } });
    }
    if (input.positionId && input.checkSeat) {
      const seat = await tx.position.findUniqueOrThrow({ where: { id: input.positionId }, select: { name: true, maxHolders: true } });
      const holders = await tx.roleAssignment.findMany({ where: { positionId: input.positionId, endedAt: null }, select: { userId: true } });
      if (holders.some((h) => h.userId === input.userId)) throw conflict("They already hold this seat.");
      if (holders.length >= seat.maxHolders) throw conflict(`${seat.name} just filled up. Reload the org chart and choose who they replace.`);
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

  // People replaced in the same step stop owing that role's requirements right away.
  for (const id of endedUserIds) if (id !== input.userId) await reopenRequirementTasks(id);
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
    if (position.role === "AMBASSADOR") {
      const club = await db.club.findUnique({ where: { id: v.clubId }, select: { type: true } });
      if (club?.type !== "COLLEGE_AMBASSADORS") throw forbidden("Your college's ambassador program fills this seat. Ask it for an ambassador from your org chart.");
    }
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
    checkSeat: true,
  });
}

/**
 * End a role. Allowed for: the holder themselves (resigning — except the last
 * President, who must name a successor first), anyone who could assign that
 * role, advisors and admins. `note` is kept in the activity log only.
 */
export async function endRoleAssignment(actor: Actor | null, assignmentId: string, reason: RoleEndReason = "RESIGNED", note?: string | null) {
  assertSignedIn(actor);
  const a = await db.roleAssignment.findUnique({
    where: { id: assignmentId },
    include: { position: { select: { name: true } }, club: { select: { name: true, slug: true } } },
  });
  if (!a || a.endedAt) throw notFound("Role");
  const access = await getClubAccess(actor, a.clubId);
  if (!access) throw notFound("Club");
  const self = a.userId === actor.id;
  const full = access.viaPlatform !== null || access.isAdvisor;
  // Same rule as memberships.removeMember: a co-advisor can't end another advisor's role.
  if (a.role === "ADVISOR" && !self && !access.viaPlatform) throw forbidden("Only an admin or the advisor can end an advisor's role.");
  const mayEnd = access.assignableRoles.includes(a.role) || (a.role === "AMBASSADOR" && managesPlacedAmbassadors(access));
  if (!self && !full && !mayEnd) throw forbidden();
  if (a.role === "PRESIDENT" && !full) {
    const others = await db.roleAssignment.count({ where: { clubId: a.clubId, role: "PRESIDENT", endedAt: null, id: { not: a.id } } });
    if (others === 0) throw forbidden("Name the next President before stepping down.");
  }
  const cleanNote = note?.trim().slice(0, 500) || undefined;
  await db.roleAssignment.update({ where: { id: a.id }, data: { endedAt: new Date(), endReason: reason } });
  await logActivity({
    actorId: actor.id,
    action: "role.ended",
    entityType: "roleAssignment",
    entityId: a.id,
    clubId: a.clubId,
    data: { userId: a.userId, role: a.role, reason, ...(cleanNote ? { note: cleanNote } : {}) },
    isPublic: true,
  });
  if (!self) {
    await notify({
      userIds: [a.userId],
      kind: "role.ended",
      title: `Your role as ${a.position?.name ?? ROLE_LABEL[a.role]} of ${a.club.name} ended`,
      body: `${END_REASON_LABEL[reason]}.${cleanNote ? ` ${cleanNote}` : ""} Your time in the role stays in the club's history.`,
      href: `/clubs/${a.club.slug}/history`,
    });
  }
  // Requirements they no longer owe close right away instead of waiting for the job.
  await reopenRequirementTasks(a.userId);
  return a;
}

/** Change what an officer/ambassador may do. */
export async function setRolePermissions(actor: Actor | null, assignmentId: string, permissions: string[]) {
  assertSignedIn(actor);
  const a = await db.roleAssignment.findUnique({ where: { id: assignmentId } });
  if (!a || a.endedAt) throw notFound("Role");
  if (a.role !== "OFFICER" && a.role !== "AMBASSADOR") throw invalid("Only officer and ambassador permissions are customizable.");
  const access = await getClubAccess(actor, a.clubId);
  if (!access) throw notFound("Club");
  if (!access.assignableRoles.includes(a.role) && !(a.role === "AMBASSADOR" && managesPlacedAmbassadors(access))) throw forbidden();
  const perms = cleanPermissions(permissions);
  await db.roleAssignment.update({ where: { id: a.id }, data: { permissions: perms } });
  await logActivity({ actorId: actor.id, action: "role.permissions_set", entityType: "roleAssignment", entityId: a.id, clubId: a.clubId, data: { permissions: perms } });
}

// ─── Presidential hand-off ───────────────────────────────────────────────────

const HandOffInput = z.object({
  successorId: z.string().min(1, "Choose the next President."),
  becomeAlumni: z.boolean().default(false),
  /** Which sitting President hands off. Defaults to the actor's own seat (or the only President). */
  outgoingAssignmentId: z.string().optional().nullable(),
});

/** Whether a user still leads a club (any active role above member), read fresh from the database. */
async function stillLeads(userId: string, clubId: string) {
  const n = await db.roleAssignment.count({ where: { clubId, userId, endedAt: null, role: { not: "MEMBER" } } });
  return n > 0;
}

/**
 * The President names their successor. The successor takes the President
 * seat in the same step the outgoing President's role ends (reason
 * SUCCEEDED), so the club is never without a President. With `becomeAlumni`
 * the outgoing President also leaves every other role in the club and their
 * membership becomes Alumni — their history stays.
 *
 * Who: the sitting President, or an advisor/admin acting for the club.
 */
export async function handOffPresidency(actor: Actor | null, clubId: string, input: unknown) {
  assertSignedIn(actor);
  const v = parse(HandOffInput, input);
  const access = await getClubAccess(actor, clubId);
  if (!access) throw notFound("Club");
  if (!access.assignableRoles.includes("PRESIDENT")) {
    throw forbidden(access.suspended ? "Your leadership permissions are paused until you finish your overdue WSUSA requirement." : "Only the President, an advisor or an administrator can hand off the presidency.");
  }
  const full = access.viaPlatform !== null || access.isAdvisor;
  const club = await db.club.findUnique({ where: { id: clubId }, select: { id: true, name: true, slug: true } });
  if (!club) throw notFound("Club");

  const presidents = await db.roleAssignment.findMany({
    where: { clubId, role: "PRESIDENT", endedAt: null },
    include: { user: { select: { id: true, name: true } } },
  });
  const outgoing = v.outgoingAssignmentId
    ? presidents.find((p) => p.id === v.outgoingAssignmentId)
    : (presidents.find((p) => p.userId === actor.id) ?? (presidents.length === 1 ? presidents[0] : undefined));
  if (!outgoing) {
    throw invalid(presidents.length === 0 ? "No one is President right now. Assign a President from the org chart instead." : "Choose which President is handing off.");
  }
  if (outgoing.userId !== actor.id && !full) throw forbidden("You can only hand off your own presidency.");

  const successor = await db.user.findUnique({ where: { id: v.successorId }, select: { id: true, name: true, kind: true, status: true } });
  if (!successor || successor.status !== "ACTIVE") throw invalid("That person can't take a role.");
  if (successor.kind !== "STUDENT") throw invalid("Club roles are for students. Faculty and staff join as advisors.");
  if (successor.id === outgoing.userId) throw invalid("Choose someone else to take over.");
  if (presidents.some((p) => p.userId === successor.id)) throw conflict(`${successor.name} is already President.`);
  const membership = await db.membership.findUnique({ where: { userId_clubId: { userId: successor.id, clubId } } });
  if (membership?.status !== "ACTIVE") throw invalid("The next President must be an active member of the club.");

  // The President seat: the outgoing President's own seat, or the club's main one.
  const own = outgoing.positionId ? await db.position.findUnique({ where: { id: outgoing.positionId } }) : null;
  const seat =
    own && !own.archivedAt
      ? own
      : await db.position.findFirst({ where: { clubId, role: "PRESIDENT", archivedAt: null }, orderBy: [{ isCore: "desc" }, { sortOrder: "asc" }] });
  if (!seat) throw invalid("This club has no President seat. Start the org chart from the default setup first.");
  const others = await db.roleAssignment.count({ where: { positionId: seat.id, endedAt: null, id: { not: outgoing.id } } });
  if (others >= seat.maxHolders) throw conflict(`${seat.name} is full. Raise its holder limit or end a co-President's role first.`);

  const assignment = await grantRole({
    clubId,
    userId: successor.id,
    role: "PRESIDENT",
    positionId: seat.id,
    assignedById: actor.id,
    endAssignmentIds: [outgoing.id],
    endReason: "SUCCEEDED",
    checkSeat: true,
  });

  if (v.becomeAlumni) {
    const now = new Date();
    await db.$transaction([
      db.roleAssignment.updateMany({ where: { clubId, userId: outgoing.userId, endedAt: null }, data: { endedAt: now, endReason: "RESIGNED" } }),
      db.membership.updateMany({ where: { clubId, userId: outgoing.userId, status: "ACTIVE" }, data: { status: "ALUMNI", endedAt: now } }),
    ]);
    await reopenRequirementTasks(outgoing.userId);
  }

  await logActivity({
    actorId: actor.id,
    action: "role.handoff",
    entityType: "club",
    entityId: clubId,
    clubId,
    data: { fromUserId: outgoing.userId, toUserId: successor.id, becameAlumni: v.becomeAlumni },
    isPublic: true,
  });
  if (outgoing.userId !== actor.id) {
    await notify({
      userIds: [outgoing.userId],
      kind: "role.handoff",
      title: `${successor.name} is now President of ${club.name}`,
      body: v.becomeAlumni ? "You're now an alumni member. Your presidency stays in the club's history." : "Your presidency stays in the club's history.",
      href: `/clubs/${club.slug}/history`,
    });
  }
  await notify({
    userIds: await clubAdvisors(clubId),
    exceptUserId: actor.id,
    kind: "role.handoff",
    title: `${club.name} has a new President`,
    body: `${outgoing.user.name} handed off the presidency to ${successor.name}.`,
    href: `/clubs/${club.slug}/manage/org-chart`,
    email: false,
  });
  return { assignmentId: assignment.id, actorStillLeads: full || (await stillLeads(actor.id, clubId)) };
}

// ─── College ambassador placements ───────────────────────────────────────────

const PlaceInput = z.object({
  orgId: z.string().min(1),
  clubId: z.string().min(1, "Choose a club."),
  userId: z.string().min(1, "Choose an ambassador."),
});

/** The target club's "College Ambassador" seat — restored or created if it's missing. */
async function collegeAmbassadorSeat(clubId: string) {
  const name = COLLEGE_AMBASSADOR_SEAT.name;
  const live = await db.position.findFirst({ where: { clubId, role: "AMBASSADOR", archivedAt: null, name: { equals: name, mode: "insensitive" } } });
  if (live) return live;
  const archived = await db.position.findFirst({ where: { clubId, role: "AMBASSADOR", name: { equals: name, mode: "insensitive" } }, orderBy: { archivedAt: "desc" } });
  if (archived) return db.position.update({ where: { id: archived.id }, data: { archivedAt: null } });
  const last = await db.position.findFirst({ where: { clubId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return db.position.create({
    data: {
      clubId,
      role: "AMBASSADOR",
      name,
      responsibilities: COLLEGE_AMBASSADOR_SEAT.responsibilities,
      defaultPermissions: [],
      maxHolders: COLLEGE_AMBASSADOR_SEAT.maxHolders,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
}

/**
 * A College Ambassadors org places one of its Club Representative
 * Ambassadors into a club in its college. The placement is an AMBASSADOR
 * assignment in the club's "College Ambassador" seat with viaClubId = the
 * org and no capabilities — the club may grant some later.
 */
export async function placeAmbassador(actor: Actor | null, input: unknown) {
  const v = parse(PlaceInput, input);
  await assertClubCap(actor, v.orgId, "roster");
  const org = await db.club.findUnique({ where: { id: v.orgId }, select: { id: true, name: true, slug: true, type: true, collegeId: true } });
  if (!org) throw notFound("Ambassador org");
  if (org.type !== "COLLEGE_AMBASSADORS") throw invalid("Placements are made from a College Ambassadors org.");
  if (!org.collegeId) throw invalid("This ambassador org isn't linked to a college yet. Ask a WSUSA administrator to set its college.");
  const club = await db.club.findUnique({ where: { id: v.clubId }, select: { id: true, name: true, slug: true, type: true, status: true, collegeId: true } });
  if (!club || club.id === org.id) throw notFound("Club");
  if (club.collegeId !== org.collegeId || club.type === "COLLEGE_AMBASSADORS") throw forbidden(`${club.name} isn't one of your college's clubs.`);
  if (club.status !== "APPROVED") throw invalid("Ambassadors can only be placed in active clubs.");

  const person = await db.user.findUnique({ where: { id: v.userId }, select: { id: true, name: true, kind: true, status: true } });
  if (!person || person.status !== "ACTIVE" || person.kind !== "STUDENT") throw invalid("That person can't be placed.");
  const repSeats = await db.roleAssignment.findMany({
    where: { clubId: org.id, userId: person.id, endedAt: null, role: "AMBASSADOR" },
    include: { position: { select: { role: true, name: true } } },
  });
  if (!repSeats.some((r) => r.position && isClubRepSeat(r.position))) {
    throw invalid(`${person.name} needs to hold a Club Representative Ambassador seat in ${org.name} first.`);
  }
  const already = await db.roleAssignment.findFirst({ where: { clubId: club.id, userId: person.id, viaClubId: org.id, endedAt: null } });
  if (already) throw conflict(`${person.name} is already placed in ${club.name}.`);

  const seat = await collegeAmbassadorSeat(club.id);
  const holders = await db.roleAssignment.count({ where: { positionId: seat.id, endedAt: null } });
  // The college's placement shouldn't be blocked by the club's seat limit; grow it by one and note it.
  if (holders >= seat.maxHolders) await db.position.update({ where: { id: seat.id }, data: { maxHolders: holders + 1 } });

  const assignment = await grantRole({
    clubId: club.id,
    userId: person.id,
    role: "AMBASSADOR",
    positionId: seat.id,
    permissions: [],
    viaClubId: org.id,
    assignedById: actor!.id,
  });
  await logActivity({
    actorId: actor!.id,
    action: "ambassador.placed",
    entityType: "roleAssignment",
    entityId: assignment.id,
    clubId: org.id,
    data: { userId: person.id, clubId: club.id, seatGrew: holders >= seat.maxHolders },
  });
  // The placement answers the club's request for an ambassador, if it made one.
  await resolveTasks(AMBASSADOR_REQUEST, club.id, actor!.id);
  await notify({
    userIds: await clubCapabilityHolders(club.id, "orgchart"),
    exceptUserId: actor!.id,
    kind: "ambassador.placed",
    title: `${person.name} is ${club.name}'s new College Ambassador`,
    body: `Placed by ${org.name}. They have no club permissions unless you grant some in the org chart.`,
    href: `/clubs/${club.slug}/manage/org-chart`,
    email: false,
  });
  return assignment;
}

/** The ambassador org ends one of its placements. (The club's own leaders can also end it in their org chart.) */
export async function endPlacement(actor: Actor | null, assignmentId: string) {
  assertSignedIn(actor);
  const a = await db.roleAssignment.findUnique({
    where: { id: assignmentId },
    include: { club: { select: { name: true, slug: true } }, user: { select: { name: true } } },
  });
  if (!a || a.endedAt || !a.viaClubId) throw notFound("Placement");
  await assertClubCap(actor, a.viaClubId, "roster");
  await db.roleAssignment.update({ where: { id: a.id }, data: { endedAt: new Date(), endReason: "TERM_ENDED" } });
  await reopenRequirementTasks(a.userId);
  await logActivity({ actorId: actor.id, action: "role.ended", entityType: "roleAssignment", entityId: a.id, clubId: a.clubId, data: { userId: a.userId, role: a.role, reason: "TERM_ENDED", placement: true }, isPublic: true });
  await logActivity({ actorId: actor.id, action: "ambassador.placement_ended", entityType: "roleAssignment", entityId: a.id, clubId: a.viaClubId, data: { userId: a.userId, clubId: a.clubId } });
  await notify({
    userIds: [a.userId],
    exceptUserId: actor.id,
    kind: "ambassador.placement_ended",
    title: `Your placement with ${a.club.name} ended`,
    body: "Thanks for representing the college. Your time there stays in the club's history.",
    href: `/clubs/${a.club.slug}/history`,
  });
}

// ─── Graduation / account retirement ─────────────────────────────────────────

/**
 * System function (no permission check — callers are trusted jobs and admin
 * tools): ends every active role a person holds, everywhere, and turns their
 * active memberships into Alumni. Pending join requests are withdrawn.
 * Used when someone graduates or their account is retired.
 */
export async function endAllRolesForUser(userId: string, reason: RoleEndReason, byId: string | null) {
  const now = new Date();
  const [user, assignments, pending] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true } }),
    db.roleAssignment.findMany({
      where: { userId, endedAt: null },
      include: { position: { select: { name: true } }, club: { select: { id: true, name: true, slug: true } } },
    }),
    db.membership.findMany({ where: { userId, status: "PENDING" }, select: { id: true } }),
  ]);
  if (!user) throw notFound("Person");

  const [, alumni] = await db.$transaction([
    db.roleAssignment.updateMany({ where: { id: { in: assignments.map((a) => a.id) } }, data: { endedAt: now, endReason: reason } }),
    db.membership.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "ALUMNI", endedAt: now } }),
    db.membership.updateMany({ where: { userId, status: "PENDING" }, data: { status: "LEFT", endedAt: now } }),
  ]);
  for (const m of pending) await resolveTasks("membership", m.id, byId, db, "CANCELLED");

  for (const a of assignments) {
    await logActivity({ actorId: byId, action: "role.ended", entityType: "roleAssignment", entityId: a.id, clubId: a.clubId, data: { userId, role: a.role, reason }, isPublic: true });
    if (a.role === "MEMBER") continue;
    await notify({
      userIds: await clubCapabilityHolders(a.clubId, "orgchart"),
      exceptUserId: userId,
      kind: "role.vacated",
      title: `${a.position?.name ?? ROLE_LABEL[a.role]} is open in ${a.club.name}`,
      body: `${user.name}'s role ended (${END_REASON_LABEL[reason].toLowerCase()}). Fill the seat from the org chart.`,
      href: `/clubs/${a.club.slug}/manage/org-chart`,
      email: false,
    });
  }
  await reopenRequirementTasks(userId);
  return { endedAssignments: assignments.length, alumniMemberships: alumni.count };
}

// ─── Contributions tied to a role (role history) ─────────────────────────────

const ContributionInput = z.object({
  title: z.string().trim().min(2, "Give the contribution a title.").max(120, "Titles can be up to 120 characters."),
  descriptionHtml: z.string().max(100_000).optional().nullable(),
  url: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .refine((u) => !u || /^https?:\/\/[^\s]+\.[^\s]+/i.test(u), "Links need to start with http:// or https://"),
  fileIds: z.array(z.string()).max(20, "Attach up to 20 files.").optional(),
});

/**
 * Who may add to or remove from a role's contributions: the holder (any time,
 * while their account is active — alumni profiles are frozen, as in
 * profiles.ts) or club leaders with `orgchart`.
 */
async function canCurateRole(actor: Actor, assignment: { userId: string; clubId: string }) {
  if (assignment.userId === actor.id && actor.status === "ACTIVE") return true;
  const access = await getClubAccess(actor, assignment.clubId);
  return Boolean(access?.capabilities.has("orgchart"));
}

/**
 * Attach a project or contribution to a role someone held, so the club's
 * role history shows the work, not just the title. Files are linked only if
 * the person adding them can see them.
 */
export async function addRoleContribution(actor: Actor | null, roleAssignmentId: string, input: unknown) {
  assertSignedIn(actor);
  const v = parse(ContributionInput, input);
  const a = await db.roleAssignment.findUnique({
    where: { id: roleAssignmentId },
    include: { club: { select: { name: true, slug: true } }, position: { select: { name: true } } },
  });
  if (!a) throw notFound("Role");
  if (!(await canCurateRole(actor, a))) throw forbidden("Only the person who held this role or the club's org chart editors can add to it.");

  const ids = [...new Set(v.fileIds ?? [])];
  const files = ids.length ? await db.fileItem.findMany({ where: { id: { in: ids }, isFolder: false, trashedAt: null } }) : [];
  const visible: string[] = [];
  for (const f of files) if (await canViewFile(actor, f)) visible.push(f.id);

  const description = sanitizeRichHtml(v.descriptionHtml);
  const project = await db.project.create({
    data: {
      userId: a.userId,
      clubId: a.clubId,
      roleAssignmentId: a.id,
      title: v.title,
      descriptionHtml: description.trim() ? description : null,
      url: v.url || null,
      files: visible.length ? { create: visible.map((fileId) => ({ fileId })) } : undefined,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "project.added",
    entityType: "project",
    entityId: project.id,
    clubId: a.clubId,
    data: { title: project.title, roleAssignmentId: a.id, userId: a.userId },
    isPublic: true,
  });
  if (a.userId !== actor.id) {
    await notify({
      userIds: [a.userId],
      kind: "project.added",
      title: `${actor.name} added "${project.title}" to your ${a.position?.name ?? ROLE_LABEL[a.role]} role`,
      href: `/clubs/${a.club.slug}/history`,
      email: false,
    });
  }
  return { project, skippedFiles: ids.length - visible.length };
}

/**
 * Remove a contribution from a role (the holder or org chart editors).
 * Contributions belong to the holder, so only the holder deletes one; an
 * editor takes it off the role and it stays on the holder's profile.
 */
export async function removeRoleContribution(actor: Actor | null, projectId: string) {
  assertSignedIn(actor);
  const p = await db.project.findUnique({ where: { id: projectId }, include: { roleAssignment: { select: { userId: true, clubId: true } } } });
  if (!p || !p.roleAssignment) throw notFound("Contribution");
  if (!(await canCurateRole(actor, p.roleAssignment))) throw forbidden();
  const owner = p.userId === actor.id;
  if (owner) await db.project.delete({ where: { id: p.id } });
  else await db.project.update({ where: { id: p.id }, data: { roleAssignmentId: null, clubId: null } });
  await logActivity({
    actorId: actor.id,
    action: owner ? "project.removed" : "project.unlinked",
    entityType: "project",
    entityId: p.id,
    clubId: p.roleAssignment.clubId,
    data: { title: p.title, ...(owner ? {} : { userId: p.userId, roleAssignmentId: p.roleAssignmentId }) },
  });
  return { deleted: owner };
}

export { ALL_CAPABILITIES };
