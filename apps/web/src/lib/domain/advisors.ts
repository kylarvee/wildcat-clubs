import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { INSTITUTION, PLATFORM, isStaffEmail } from "@/lib/institution";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, conflict, forbidden, invalid, notFound } from "@/lib/domain/kit";
import { grantRole } from "@/lib/domain/roles";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { emailAddress, notify } from "@/lib/domain/notify";
import { clubLeaderIds, parseForm } from "@/lib/domain/clubs";

/**
 * Advisor invites. Founders (President/VP), advisors and admins invite a
 * faculty or staff member by name + @weber.edu email. The invitee gets an
 * email with a link (always) and, if they already have an account, a task in
 * their inbox. Accepting is the only way to become a club's ADVISOR — it goes
 * through roles.grantRole so the role history records it.
 */

export const inviteHref = (token: string) => `/advisor/invite/${token}`;

const InviteInput = z.object({
  clubId: z.string().trim().min(1),
  name: z.string({ error: "Enter the advisor's name." }).trim().min(2, "Enter the advisor's full name.").max(100, "Keep the name under 100 characters."),
  email: z
    .string({ error: "Enter the advisor's email." })
    .trim()
    .toLowerCase()
    .max(200)
    .refine((v) => z.email().safeParse(v).success, "Enter a valid email address.")
    .refine((v) => isStaffEmail(v), `Advisors must be ${INSTITUTION.shortName} faculty or staff — use their @${INSTITUTION.staffEmailDomain} email (not @${INSTITUTION.studentEmailDomain}).`),
});

async function loadInviteForClubAction(actor: Actor | null, inviteId: string) {
  assertSignedIn(actor);
  const invite = await db.advisorInvite.findUnique({ where: { id: String(inviteId) }, include: { club: { select: { id: true, name: true, slug: true, status: true } } } });
  if (!invite) throw notFound("Invitation");
  const access = await getClubAccess(actor, invite.clubId);
  if (!access?.canInviteAdvisor) throw forbidden("Only the President, Vice President, an advisor or WSUSA can manage advisor invitations.");
  return invite;
}

function inviteEmailBody(input: { name: string; inviterName: string; clubName: string; clubBlurb: string }) {
  const lines = [`Hi ${input.name},`, "", `${input.inviterName} invited you to be the faculty/staff advisor for ${input.clubName}, a student club at ${INSTITUTION.name}.`];
  if (input.clubBlurb) lines.push("", `About the club: ${input.clubBlurb}`);
  lines.push(
    "",
    "What advising means:",
    "• You guide the club's student leaders and help them follow university policy.",
    `• You review the club's budget and funding requests and are a contact for ${INSTITUTION.studentGovernment}.`,
    `• You get full access to the club's tools in ${PLATFORM.name}. You don't vote in club elections.`,
    "• Most advisors meet with club leaders a few times a semester and attend major events when they can.",
    "",
    `Open the link below to read more and accept or decline. If you don't have a ${PLATFORM.name} account yet, sign in with your @${INSTITUTION.staffEmailDomain} Google account and one is created for you.`,
  );
  return lines.join("\n");
}

async function sendInvite(invite: { id: string; token: string; name: string; email: string; clubId: string; inviteeId: string | null }, club: { name: string; shortDescription: string }, inviter: { id: string; name: string }) {
  const href = inviteHref(invite.token);
  await emailAddress(invite.email, `Will you advise ${club.name}?`, inviteEmailBody({ name: invite.name, inviterName: inviter.name, clubName: club.name, clubBlurb: club.shortDescription }), href);
  if (invite.inviteeId) {
    await notify({ userIds: [invite.inviteeId], kind: "advisor.invited", title: `${inviter.name} asked you to advise ${club.name}`, href, email: false });
  }
}

async function ensureInviteTask(invite: { id: string; token: string; clubId: string; inviteeId: string | null }, clubName: string, createdById: string) {
  if (!invite.inviteeId) return;
  const open = await db.task.count({ where: { sourceType: "advisorInvite", sourceId: invite.id, status: "OPEN" } });
  if (open) return;
  await createTask({
    kind: "APPROVAL",
    title: `Accept or decline advising ${clubName}`,
    description: "A student club asked you to be its faculty/staff advisor.",
    assignee: { type: "USER", userId: invite.inviteeId },
    clubId: invite.clubId,
    href: inviteHref(invite.token),
    source: { type: "advisorInvite", id: invite.id },
    createdById,
  });
}

export async function inviteAdvisor(actor: Actor | null, clubId: string, input: { name: string; email: string }) {
  assertSignedIn(actor);
  const v = parseForm(InviteInput, { ...(input ?? {}), clubId });
  const access = await getClubAccess(actor, v.clubId);
  if (!access) throw notFound("Club");
  if (!access.canInviteAdvisor) throw forbidden("Only the President, Vice President, an advisor or WSUSA can invite advisors.");
  const club = await db.club.findUnique({ where: { id: v.clubId }, select: { id: true, name: true, slug: true, status: true, shortDescription: true } });
  if (!club) throw notFound("Club");
  if (club.status === "REJECTED") throw forbidden("This club can't add advisors.");

  const account = await db.user.findFirst({ where: { email: { equals: v.email, mode: "insensitive" } }, select: { id: true, kind: true, status: true } });
  if (account?.status === "DEACTIVATED") throw invalid("That account is deactivated. Invite a different advisor.");
  if (account && account.kind !== "FACULTY_STAFF") throw invalid("That's a student account. Advisors must be faculty or staff.");
  if (account && (await db.roleAssignment.count({ where: { clubId: club.id, userId: account.id, role: "ADVISOR", endedAt: null } }))) {
    throw conflict("They're already an advisor for this club.");
  }
  const pending = await db.advisorInvite.findFirst({ where: { clubId: club.id, status: "PENDING", email: { equals: v.email, mode: "insensitive" } } });
  if (pending) throw conflict("They already have a pending invitation. Use “Resend” to send it again.");

  const invite = await db.advisorInvite.create({ data: { clubId: club.id, name: v.name, email: v.email, invitedById: actor.id, inviteeId: account?.id ?? null } });
  await ensureInviteTask(invite, club.name, actor.id);
  await sendInvite(invite, club, actor);
  await logActivity({ actorId: actor.id, action: "advisor.invited", entityType: "advisorInvite", entityId: invite.id, clubId: club.id, data: { name: v.name, email: v.email } });
  return invite;
}

export async function resendAdvisorInvite(actor: Actor | null, inviteId: string) {
  const invite = await loadInviteForClubAction(actor, inviteId);
  if (invite.status !== "PENDING") throw conflict("This invitation was already answered or cancelled.");
  // Pick up an account created since the first send.
  let inviteeId = invite.inviteeId;
  if (!inviteeId) {
    const account = await db.user.findFirst({ where: { email: { equals: invite.email, mode: "insensitive" }, kind: "FACULTY_STAFF" }, select: { id: true } });
    if (account) inviteeId = (await db.advisorInvite.update({ where: { id: invite.id }, data: { inviteeId: account.id } })).inviteeId;
  }
  const club = await db.club.findUniqueOrThrow({ where: { id: invite.clubId }, select: { name: true, shortDescription: true } });
  await ensureInviteTask({ ...invite, inviteeId }, club.name, actor!.id);
  await sendInvite({ ...invite, inviteeId }, club, actor!);
  await logActivity({ actorId: actor!.id, action: "advisor.invite_resent", entityType: "advisorInvite", entityId: invite.id, clubId: invite.clubId });
}

export async function cancelAdvisorInvite(actor: Actor | null, inviteId: string) {
  const invite = await loadInviteForClubAction(actor, inviteId);
  if (invite.status !== "PENDING") throw conflict("This invitation was already answered or cancelled.");
  await db.advisorInvite.update({ where: { id: invite.id }, data: { status: "CANCELLED", respondedAt: new Date() } });
  await resolveTasks("advisorInvite", invite.id, actor!.id, db, "CANCELLED");
  await logActivity({ actorId: actor!.id, action: "advisor.invite_cancelled", entityType: "advisorInvite", entityId: invite.id, clubId: invite.clubId });
}

/** The invite page: who may answer it and what they see. */
export async function loadInviteForViewer(actor: Actor | null, token: string) {
  const invite = await db.advisorInvite.findUnique({
    where: { token: String(token) },
    include: {
      club: { select: { id: true, name: true, slug: true, status: true, type: true, shortDescription: true, logoUrl: true, logoColor: true, college: { select: { name: true } }, department: { select: { name: true } } } },
      invitedBy: { select: { name: true, email: true } },
    },
  });
  if (!invite) return null;
  const emailMatches = Boolean(actor && actor.email.toLowerCase() === invite.email.toLowerCase());
  return { invite, emailMatches, canAnswer: emailMatches && actor?.kind === "FACULTY_STAFF" && invite.status === "PENDING" };
}

async function loadInviteForAnswer(actor: Actor | null, token: string) {
  assertSignedIn(actor);
  const invite = await db.advisorInvite.findUnique({ where: { token: String(token) }, include: { club: { select: { id: true, name: true, slug: true, status: true } } } });
  if (!invite) throw notFound("Invitation");
  if (actor.email.toLowerCase() !== invite.email.toLowerCase()) throw forbidden(`This invitation was sent to ${invite.email}. Sign in with that account to answer it.`);
  if (actor.kind !== "FACULTY_STAFF") throw forbidden("Only faculty and staff accounts can be advisors.");
  if (invite.status !== "PENDING") throw conflict(invite.status === "CANCELLED" ? "The club cancelled this invitation." : "You've already answered this invitation.");
  if (invite.club.status === "RETIRED" || invite.club.status === "REJECTED") throw conflict("This club is no longer active, so the invitation has closed.");
  return invite;
}

/** Accepting makes the invitee an ADVISOR (system path, assigned by the inviter). */
export async function acceptAdvisorInvite(actor: Actor | null, token: string) {
  const invite = await loadInviteForAnswer(actor, token);
  const already = await db.roleAssignment.count({ where: { clubId: invite.clubId, userId: actor!.id, role: "ADVISOR", endedAt: null } });
  if (!already) await grantRole({ clubId: invite.clubId, userId: actor!.id, role: "ADVISOR", assignedById: invite.invitedById });
  await db.advisorInvite.update({ where: { id: invite.id }, data: { status: "ACCEPTED", respondedAt: new Date(), inviteeId: actor!.id } });
  await resolveTasks("advisorInvite", invite.id, actor!.id);
  await logActivity({ actorId: actor!.id, action: "advisor.accepted", entityType: "advisorInvite", entityId: invite.id, clubId: invite.clubId, isPublic: true });
  await notify({
    userIds: [invite.invitedById, ...(await clubLeaderIds(invite.clubId, ["PRESIDENT", "VP"]))],
    kind: "advisor.accepted",
    title: `${actor!.name} is now ${invite.club.name}'s advisor`,
    body: invite.club.status === "DRAFT" || invite.club.status === "CHANGES_REQUESTED" ? "That's one more item checked off your founding checklist." : undefined,
    href: `/clubs/${invite.club.slug}/manage`,
    exceptUserId: actor!.id,
  });
  return { slug: invite.club.slug };
}

export async function declineAdvisorInvite(actor: Actor | null, token: string) {
  const invite = await loadInviteForAnswer(actor, token);
  await db.advisorInvite.update({ where: { id: invite.id }, data: { status: "DECLINED", respondedAt: new Date(), inviteeId: actor!.id } });
  await resolveTasks("advisorInvite", invite.id, actor!.id);
  await logActivity({ actorId: actor!.id, action: "advisor.declined", entityType: "advisorInvite", entityId: invite.id, clubId: invite.clubId });
  await notify({
    userIds: [invite.invitedById, ...(await clubLeaderIds(invite.clubId, ["PRESIDENT", "VP"]))],
    kind: "advisor.declined",
    title: `${actor!.name} declined to advise ${invite.club.name}`,
    body: "Invite another faculty or staff member from your club workspace.",
    href: `/clubs/${invite.club.slug}/manage`,
    exceptUserId: actor!.id,
  });
}

/**
 * Opens inbox tasks for invites that were sent before the invitee had an
 * account. Safe to call repeatedly (accounts.ts should call it after linking
 * pending invites to a new account).
 */
export async function openAdvisorInviteTasks(userId: string) {
  const invites = await db.advisorInvite.findMany({ where: { inviteeId: userId, status: "PENDING" }, include: { club: { select: { name: true } } } });
  for (const inv of invites) await ensureInviteTask(inv, inv.club.name, inv.invitedById);
}
