import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, hasCap } from "@/lib/authz";
import { clubCapabilityHolders } from "@/lib/authz/people";
import { logActivity } from "@/lib/lake/activity";
import { assertCan, assertClubCap, conflict, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify } from "@/lib/domain/notify";
import { grantRole } from "@/lib/domain/roles";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { AMBASSADOR_REQUEST, REQUEST_NOTE_MAX, requestBlocker } from "@/lib/ambassadors/rules";

/**
 * College ambassador programs, from the clubs' side and WSUSA's.
 *
 * WSUSA starts a college's program (clubs.startAmbassadorProgram) and appoints
 * its advisor here: the college's point person, who runs the program's
 * elections and leadership pipeline with its President. Nobody invites an
 * advisor into a program (authz: canInviteAdvisor is off for them).
 *
 * A regular club can't fill its College Ambassador seat itself. Its leaders
 * ask the college's program for one: the request is an APPROVAL task in the
 * program's inbox (sourceType "ambassadorRequest", sourceId = the club) and
 * closes when the program places someone (roles.placeAmbassador), turns the
 * request down, or the club withdraws it.
 */

/** The college's running ambassador program, if it has one. */
export async function ambassadorProgramFor(collegeId: string | null) {
  if (!collegeId) return null;
  return db.club.findFirst({ where: { type: "COLLEGE_AMBASSADORS", collegeId, status: "APPROVED" }, select: { id: true, name: true, slug: true } });
}

function openRequest(clubId: string) {
  return db.task.findFirst({
    where: { sourceType: AMBASSADOR_REQUEST, sourceId: clubId, status: "OPEN" },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
}

export type AmbassadorRequestView = {
  club: { id: string; name: string; slug: string };
  program: { id: string; name: string; slug: string } | null;
  collegeName: string | null;
  placed: { assignmentId: string; name: string; handle: string; avatarUrl: string | null; avatarColor: string; since: Date }[];
  open: { at: Date; note: string | null; byName: string | null } | null;
  /** Why the viewer can't ask right now (null = they can). */
  blocker: string | null;
  /** The viewer may withdraw the open request. */
  canWithdraw: boolean;
};

/** What a club's org chart shows about its College Ambassador. Null for ambassador programs themselves. */
export async function ambassadorRequestView(actor: Actor | null, clubId: string): Promise<AmbassadorRequestView | null> {
  const club = await db.club.findUnique({
    where: { id: clubId },
    select: { id: true, name: true, slug: true, type: true, status: true, collegeId: true, college: { select: { name: true } } },
  });
  if (!club || club.type === "COLLEGE_AMBASSADORS") return null;
  const [program, access, placed, open] = await Promise.all([
    ambassadorProgramFor(club.collegeId),
    getClubAccess(actor, club.id),
    db.roleAssignment.findMany({
      where: { clubId: club.id, role: "AMBASSADOR", endedAt: null },
      orderBy: { startedAt: "asc" },
      include: { user: { select: { name: true, handle: true, avatarUrl: true, avatarColor: true } } },
    }),
    openRequest(club.id),
  ]);
  const canManage = hasCap(access, "orgchart");
  return {
    club: { id: club.id, name: club.name, slug: club.slug },
    program,
    collegeName: club.college?.name ?? null,
    placed: placed.map((a) => ({ assignmentId: a.id, ...a.user, since: a.startedAt })),
    open: open ? { at: open.createdAt, note: open.description ?? null, byName: open.createdBy?.name ?? null } : null,
    blocker: requestBlocker({
      clubType: club.type,
      clubStatus: club.status,
      hasProgram: Boolean(program),
      collegeName: club.college?.name ?? null,
      hasOpenRequest: Boolean(open),
      canManageOrgChart: canManage,
    }),
    canWithdraw: Boolean(open) && canManage,
  };
}

const RequestInput = z.object({
  clubId: z.string().min(1),
  note: z.string().trim().max(REQUEST_NOTE_MAX, `Keep the note under ${REQUEST_NOTE_MAX} characters.`).optional().nullable(),
});

/** A club's leaders ask their college's program to embed an ambassador. */
export async function requestAmbassador(actor: Actor | null, input: unknown) {
  const v = parse(RequestInput, input);
  await assertClubCap(actor, v.clubId, "orgchart");
  const club = await db.club.findUnique({ where: { id: v.clubId }, select: { id: true, name: true, slug: true, type: true, status: true, collegeId: true, college: { select: { name: true } } } });
  if (!club) throw notFound("Club");
  const program = await ambassadorProgramFor(club.collegeId);
  const open = await openRequest(club.id);
  const blocker = requestBlocker({ clubType: club.type, clubStatus: club.status, hasProgram: Boolean(program), collegeName: club.college?.name ?? null, hasOpenRequest: Boolean(open), canManageOrgChart: true });
  if (blocker) throw open ? conflict(`${club.name} already asked. ${program?.name ?? "The program"} will place someone or reply.`) : invalid(blocker);

  const note = v.note?.trim() || null;
  const href = `/clubs/${program!.slug}/manage/ambassadors?requested=1`;
  const task = await createTask({
    kind: "APPROVAL",
    title: `${club.name} asked for a College Ambassador`,
    description: note ?? `Place one of your club representatives in ${club.name}, or let them know you can't right now.`,
    assignee: { type: "CLUB", clubId: program!.id, capability: "roster" },
    href,
    source: { type: AMBASSADOR_REQUEST, id: club.id },
    createdById: actor!.id,
  });
  await logActivity({ actorId: actor!.id, action: "ambassador.requested", entityType: "club", entityId: club.id, clubId: club.id, data: { programId: program!.id, note } });
  await notify({
    userIds: await clubCapabilityHolders(program!.id, "roster"),
    exceptUserId: actor!.id,
    kind: "ambassador.requested",
    title: `${club.name} asked for a College Ambassador`,
    body: note ?? undefined,
    href,
  });
  return task;
}

/** The club takes its request back. */
export async function withdrawAmbassadorRequest(actor: Actor | null, clubId: string) {
  await assertClubCap(actor, String(clubId), "orgchart");
  const open = await openRequest(String(clubId));
  if (!open) throw notFound("Request");
  await resolveTasks(AMBASSADOR_REQUEST, open.sourceId!, actor!.id, db, "CANCELLED");
  await logActivity({ actorId: actor!.id, action: "ambassador.request_withdrawn", entityType: "club", entityId: open.sourceId!, clubId: open.sourceId! });
}

const DeclineInput = z.object({
  orgId: z.string().min(1),
  clubId: z.string().min(1),
  note: z.string().trim().max(REQUEST_NOTE_MAX, `Keep the note under ${REQUEST_NOTE_MAX} characters.`).optional().nullable(),
});

/** The program can't place anyone right now; the club hears why. */
export async function declineAmbassadorRequest(actor: Actor | null, input: unknown) {
  const v = parse(DeclineInput, input);
  await assertClubCap(actor, v.orgId, "roster");
  const [org, club, open] = await Promise.all([
    db.club.findUnique({ where: { id: v.orgId }, select: { id: true, name: true, type: true } }),
    db.club.findUnique({ where: { id: v.clubId }, select: { id: true, name: true, slug: true } }),
    openRequest(v.clubId),
  ]);
  if (!org || org.type !== "COLLEGE_AMBASSADORS") throw notFound("Ambassador program");
  if (!club || !open || open.clubId !== org.id) throw notFound("Request");
  const note = v.note?.trim() || null;
  await resolveTasks(AMBASSADOR_REQUEST, club.id, actor!.id, db, "CANCELLED");
  await logActivity({ actorId: actor!.id, action: "ambassador.request_declined", entityType: "club", entityId: club.id, clubId: org.id, data: { clubId: club.id, note } });
  await notify({
    userIds: await clubCapabilityHolders(club.id, "orgchart"),
    exceptUserId: actor!.id,
    kind: "ambassador.request_declined",
    title: `${org.name} can't place an ambassador in ${club.name} right now`,
    body: note ?? "You can ask again later.",
    href: `/clubs/${club.slug}/manage/org-chart`,
  });
}

const AdvisorInput = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1, "Choose the program's advisor."),
});

/**
 * WSUSA names the faculty or staff member who advises a college's ambassador
 * program. One advisor per program: the previous one's role ends in the same
 * step (reason SUCCEEDED), and any old advisor invitations are cancelled.
 */
export async function setAmbassadorAdvisor(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.clubs");
  const v = parse(AdvisorInput, input);
  const org = await db.club.findUnique({ where: { id: v.orgId }, select: { id: true, name: true, slug: true, type: true, status: true } });
  if (!org || org.type !== "COLLEGE_AMBASSADORS") throw notFound("Ambassador program");
  if (org.status === "RETIRED") throw invalid("This program is retired.");
  const person = await db.user.findUnique({ where: { id: v.userId }, select: { id: true, name: true, kind: true, status: true } });
  if (!person || person.status !== "ACTIVE") throw invalid("That person can't advise a program.");
  if (person.kind !== "FACULTY_STAFF") throw invalid("Advisors are faculty or staff. Choose someone with a @weber.edu staff account.");

  const current = await db.roleAssignment.findMany({ where: { clubId: org.id, role: "ADVISOR", endedAt: null }, include: { user: { select: { id: true, name: true } } } });
  const replaced = current.filter((a) => a.userId !== person.id);
  if (current.some((a) => a.userId === person.id) && replaced.length === 0) throw conflict(`${person.name} already advises ${org.name}.`);

  let assignmentId: string;
  if (current.some((a) => a.userId === person.id)) {
    // Already an advisor alongside others: they stay, the others step down.
    await db.roleAssignment.updateMany({ where: { id: { in: replaced.map((a) => a.id) }, endedAt: null }, data: { endedAt: new Date(), endReason: "SUCCEEDED" } });
    assignmentId = current.find((a) => a.userId === person.id)!.id;
  } else {
    const a = await grantRole({ clubId: org.id, userId: person.id, role: "ADVISOR", assignedById: actor.id, endAssignmentIds: replaced.map((r) => r.id), endReason: "SUCCEEDED" });
    assignmentId = a.id;
  }
  for (const r of replaced) {
    await logActivity({ actorId: actor.id, action: "role.ended", entityType: "roleAssignment", entityId: r.id, clubId: org.id, data: { userId: r.userId, role: "ADVISOR", reason: "SUCCEEDED" }, isPublic: true });
  }

  const invites = await db.advisorInvite.findMany({ where: { clubId: org.id, status: "PENDING" }, select: { id: true } });
  if (invites.length) {
    await db.advisorInvite.updateMany({ where: { id: { in: invites.map((i) => i.id) }, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: new Date() } });
    for (const i of invites) await resolveTasks("advisorInvite", i.id, actor.id, db, "CANCELLED");
  }

  await logActivity({
    actorId: actor.id,
    action: "ambassador.advisor_set",
    entityType: "roleAssignment",
    entityId: assignmentId,
    clubId: org.id,
    data: { userId: person.id, replaced: replaced.map((r) => r.userId) },
  });
  if (replaced.length) {
    await notify({
      userIds: replaced.map((r) => r.userId),
      kind: "role.ended",
      title: `${person.name} now advises ${org.name}`,
      body: "WSUSA named a new advisor for the program. Your time advising it stays in its history. Thank you.",
      href: `/clubs/${org.slug}/history`,
    });
  }
  const leaders = await db.roleAssignment.findMany({ where: { clubId: org.id, endedAt: null, role: { in: ["PRESIDENT", "VP"] } }, select: { userId: true } });
  await notify({
    userIds: leaders.map((l) => l.userId),
    exceptUserId: actor.id,
    kind: "ambassador.advisor_set",
    title: `${person.name} is ${org.name}'s advisor`,
    body: "Your advisor runs the program's elections and leadership pipeline with the President.",
    href: `/clubs/${org.slug}/manage/org-chart`,
  });
  return { assignmentId };
}
