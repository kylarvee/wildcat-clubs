import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { isFounder } from "@/lib/authz/founding";
import { COFOUNDER_INVITE, COFOUNDER_PENDING_CAP, cofounderInviteHref, FOUNDING_STATUSES, isFounding } from "@/lib/founding/rules";
import { emailKind, INSTITUTION, PLATFORM } from "@/lib/institution";
import { logActivity } from "@/lib/lake/activity";
import { officeForClub } from "@/lib/offices";
import { assertSignedIn, conflict, forbidden, invalid, notFound, oneLine } from "@/lib/domain/kit";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { emailAddress, notify } from "@/lib/domain/notify";
import { clubLeaderIds, parseForm } from "@/lib/domain/clubs";
import { newInviteToken } from "@/lib/domain/advisors";

/**
 * Co-founders: the founding team, before a club is approved. A founder (its
 * President while it's being founded, or whoever started it: lib/authz
 * founding isFounder) invites a fellow student by name and @mail.weber.edu
 * email. Invitees with an account get a task and a notification; others get
 * an email with the link (the outbox in mock mode), and the task appears once
 * they sign in (lib/auth/accounts). Accepting makes them a member with source
 * FOUNDER, so a founder can seat them on the founding org chart through the
 * Org Chart tool (roles.assignRole). Decline and cancel work like advisor
 * invites, and at most COFOUNDER_PENDING_CAP invitations wait at once. When
 * the club is decided or retires, open invitations close (lib/domain/clubs).
 */

const InviteInput = z.object({
  clubId: z.string().trim().min(1),
  name: z
    .string({ error: "Enter their name." })
    .overwrite(oneLine)
    .trim()
    .min(2, "Enter their full name.")
    .max(100, "Keep the name under 100 characters."),
  email: z
    .string({ error: "Enter their Weber State email." })
    .trim()
    .toLowerCase()
    .max(200)
    .refine((v) => z.email().safeParse(v).success, "Enter a valid email address.")
    .refine((v) => emailKind(v) === "STUDENT", `Co-founders are students. Use their @${INSTITUTION.studentEmailDomain} email.`),
});

type InviteRow = { id: string; token: string; name: string; email: string; clubId: string; inviteeId: string | null };
type ClubRow = { id: string; name: string; slug: string; shortDescription: string };

const founderOnly = "Only the club's founders can invite co-founders: its President while it's being founded, or whoever started it.";

function inviteEmailBody(input: { name: string; inviterName: string; club: ClubRow; office: string }) {
  const lines = [`Hi ${input.name},`, "", `${input.inviterName} invited you to help start ${input.club.name}, a new student club at ${INSTITUTION.name}.`];
  if (input.club.shortDescription) lines.push("", `About the club: ${input.club.shortDescription}`);
  lines.push(
    "",
    `Co-founders are the founding team. Once you accept, a founder can give you a seat on the club's org chart (Vice President, Treasurer and so on) while you get the club ready for ${input.office} to review.`,
    "",
    `Open the link below to accept or decline. Sign in with your @${INSTITUTION.studentEmailDomain} Google account; if you don't have a ${PLATFORM.name} account yet, one is made for you.`,
  );
  return lines.join("\n");
}

const inviteTitle = (inviterName: string, clubName: string) => `${inviterName} invited you to help start ${clubName}`;

async function ensureInviteTask(invite: InviteRow, clubName: string, inviter: { id: string; name: string }) {
  if (!invite.inviteeId) return;
  const open = await db.task.count({ where: { sourceType: COFOUNDER_INVITE, sourceId: invite.id, status: "OPEN" } });
  if (open) return;
  await createTask({
    kind: "APPROVAL",
    title: inviteTitle(inviter.name, clubName),
    description: "Accept to join the founding team. A founder can then give you a seat on the club's org chart before it's approved.",
    assignee: { type: "USER", userId: invite.inviteeId },
    clubId: invite.clubId,
    href: cofounderInviteHref(invite.token),
    source: { type: COFOUNDER_INVITE, id: invite.id },
    createdById: inviter.id,
  });
}

/** An account gets the bell (and its usual channels); an address with no account yet gets the email with the link. */
async function sendInvite(invite: InviteRow, club: ClubRow, inviter: { id: string; name: string }) {
  const href = cofounderInviteHref(invite.token);
  const title = inviteTitle(inviter.name, club.name);
  if (invite.inviteeId) {
    await notify({ userIds: [invite.inviteeId], kind: "cofounder.invited", title, body: "Open the invitation to accept or decline.", href });
    return;
  }
  const office = await officeForClub(club.id);
  await emailAddress(invite.email, title, inviteEmailBody({ name: invite.name, inviterName: inviter.name, club, office: office.name }), href);
}

async function clubForFounder(actor: Actor, clubId: string) {
  const club = await db.club.findUnique({ where: { id: clubId }, select: { id: true, name: true, slug: true, status: true, createdById: true, shortDescription: true } });
  if (!club) throw notFound("Club");
  const access = await getClubAccess(actor, club.id);
  if (!access) throw notFound("Club");
  if (!isFounding(club.status)) {
    throw conflict(club.status === "APPROVED" ? `${club.name} is approved, so students join it from its club page.` : "This club isn't being founded anymore.");
  }
  if (!isFounder(access, club, actor.id)) throw forbidden(founderOnly);
  return club;
}

async function loadInviteForFounder(actor: Actor | null, inviteId: string) {
  assertSignedIn(actor);
  const invite = await db.cofounderInvite.findUnique({ where: { id: String(inviteId) } });
  if (!invite) throw notFound("Invitation");
  const club = await clubForFounder(actor, invite.clubId);
  return { invite, club };
}

export async function inviteCofounder(actor: Actor | null, clubId: string, input: { name: string; email: string }) {
  assertSignedIn(actor);
  const v = parseForm(InviteInput, { ...(input ?? {}), clubId });
  const club = await clubForFounder(actor, v.clubId);
  if (v.email === actor.email.toLowerCase()) throw invalid("That's your own email. Invite a fellow student.");

  const account = await db.user.findFirst({ where: { email: { equals: v.email, mode: "insensitive" } }, select: { id: true, kind: true, status: true } });
  if (account?.status === "DEACTIVATED") throw invalid("That account is deactivated. Invite someone else.");
  if (account?.status === "ALUMNI") throw invalid("They've graduated, so they can't join new clubs.");
  if (account && account.kind !== "STUDENT") throw invalid("That's a faculty or staff account. Co-founders are students; invite faculty and staff as your advisor.");
  if (account && (await db.membership.count({ where: { userId: account.id, clubId: club.id, status: "ACTIVE" } }))) throw conflict(`They're already part of ${club.name}.`);

  // One founder at a time per club, so the duplicate check and the cap hold even for two invites sent at once.
  const invite = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Club" WHERE id = ${club.id} FOR UPDATE`;
    const pending = await tx.cofounderInvite.findMany({ where: { clubId: club.id, status: "PENDING" }, select: { email: true } });
    if (pending.some((p) => p.email.toLowerCase() === v.email)) throw conflict("They already have an invitation waiting. Use Resend to send it again.");
    if (pending.length >= COFOUNDER_PENDING_CAP) throw invalid(`${COFOUNDER_PENDING_CAP} invitations are already waiting. Cancel one, or wait for answers, before inviting more.`);
    return tx.cofounderInvite.create({ data: { clubId: club.id, name: v.name, email: v.email, token: newInviteToken(), invitedById: actor.id, inviteeId: account?.id ?? null } });
  });
  await ensureInviteTask(invite, club.name, actor);
  await sendInvite(invite, club, actor);
  await logActivity({ actorId: actor.id, action: "cofounder.invited", entityType: "cofounderInvite", entityId: invite.id, clubId: club.id, data: { name: v.name } });
  return invite;
}

export async function resendCofounderInvite(actor: Actor | null, inviteId: string) {
  const { invite, club } = await loadInviteForFounder(actor, inviteId);
  if (invite.status !== "PENDING") throw conflict("This invitation was already answered or cancelled.");
  // Pick up an account made since the first send.
  let inviteeId = invite.inviteeId;
  if (!inviteeId) {
    const account = await db.user.findFirst({ where: { email: { equals: invite.email, mode: "insensitive" }, kind: "STUDENT", status: "ACTIVE" }, select: { id: true } });
    if (account) inviteeId = (await db.cofounderInvite.update({ where: { id: invite.id }, data: { inviteeId: account.id } })).inviteeId;
  }
  await ensureInviteTask({ ...invite, inviteeId }, club.name, actor!);
  await sendInvite({ ...invite, inviteeId }, club, actor!);
  await logActivity({ actorId: actor!.id, action: "cofounder.invite_resent", entityType: "cofounderInvite", entityId: invite.id, clubId: invite.clubId });
}

export async function cancelCofounderInvite(actor: Actor | null, inviteId: string) {
  const { invite } = await loadInviteForFounder(actor, inviteId);
  const claimed = await db.cofounderInvite.updateMany({ where: { id: invite.id, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: new Date() } });
  if (claimed.count === 0) throw conflict("This invitation was already answered or cancelled.");
  await resolveTasks(COFOUNDER_INVITE, invite.id, actor!.id, db, "CANCELLED");
  await logActivity({ actorId: actor!.id, action: "cofounder.invite_cancelled", entityType: "cofounderInvite", entityId: invite.id, clubId: invite.clubId });
}

// ─── The invitee's side ──────────────────────────────────────────────────────

/** The invitation page (/cofounder/[token]): what the viewer sees and whether they may answer. */
export async function loadCofounderInviteForViewer(actor: Actor | null, token: string) {
  const invite = await db.cofounderInvite.findUnique({
    where: { token: String(token) },
    include: {
      club: { select: { id: true, name: true, slug: true, status: true, type: true, shortDescription: true, logoUrl: true, logoColor: true, officeId: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });
  if (!invite) return null;
  const emailMatches = Boolean(actor && actor.email.toLowerCase() === invite.email.toLowerCase());
  const open = invite.status === "PENDING" && isFounding(invite.club.status);
  return { invite, emailMatches, open, canAnswer: emailMatches && actor?.kind === "STUDENT" && actor.status === "ACTIVE" && open };
}

async function loadInviteForAnswer(actor: Actor | null, token: string) {
  assertSignedIn(actor);
  const invite = await db.cofounderInvite.findUnique({ where: { token: String(token) }, include: { club: { select: { id: true, name: true, slug: true, status: true } } } });
  if (!invite) throw notFound("Invitation");
  if (actor.email.toLowerCase() !== invite.email.toLowerCase()) throw forbidden("This invitation is for someone else. Sign in with the account it was sent to.");
  if (actor.kind !== "STUDENT") throw forbidden("Only student accounts can be co-founders.");
  if (actor.status !== "ACTIVE") throw forbidden("Alumni accounts can't join new clubs.");
  if (invite.status !== "PENDING") throw conflict(invite.status === "CANCELLED" ? "The founders cancelled this invitation." : "You've already answered this invitation.");
  if (!isFounding(invite.club.status)) {
    throw conflict(invite.club.status === "APPROVED" ? `${invite.club.name} is already approved, so join it from its club page.` : "This club isn't being founded anymore, so the invitation has closed.");
  }
  return invite;
}

/** Answers an invitation only while it's still PENDING, so a double click, a second tab or a cancel at the same moment can't answer it twice. */
async function claimInvite(id: string, status: "ACCEPTED" | "DECLINED", inviteeId: string) {
  const claimed = await db.cofounderInvite.updateMany({ where: { id, status: "PENDING" }, data: { status, respondedAt: new Date(), inviteeId } });
  if (claimed.count === 0) throw conflict("This invitation was already answered or cancelled.");
}

/** The founders who hear about an answer: whoever sent it, and the club's President and Vice Presidents. */
const foundersToTell = async (invite: { invitedById: string; clubId: string }) => [invite.invitedById, ...(await clubLeaderIds(invite.clubId, ["PRESIDENT", "VP"]))];

/**
 * Accepting makes the invitee a member with source FOUNDER (and follows the
 * club's calendar, as members do), so a founder can seat them on the org chart.
 */
export async function acceptCofounderInvite(actor: Actor | null, token: string) {
  const invite = await loadInviteForAnswer(actor, token);
  await claimInvite(invite.id, "ACCEPTED", actor!.id);
  const now = new Date();
  const key = { userId_clubId: { userId: actor!.id, clubId: invite.clubId } };
  try {
    await db.$transaction(async (tx) => {
      const existing = await tx.membership.findUnique({ where: key, select: { status: true } });
      if (existing?.status !== "ACTIVE") {
        await tx.membership.upsert({
          where: key,
          create: { userId: actor!.id, clubId: invite.clubId, status: "ACTIVE", source: "FOUNDER", joinedAt: now },
          update: { status: "ACTIVE", source: "FOUNDER", requestedAt: now, joinedAt: now, endedAt: null },
        });
      }
      await tx.calendarSubscription.upsert({ where: key, create: { userId: actor!.id, clubId: invite.clubId }, update: {} });
    });
  } catch (e) {
    // The membership didn't go through, so the invitation is still open.
    await db.cofounderInvite.update({ where: { id: invite.id }, data: { status: "PENDING", respondedAt: null, inviteeId: invite.inviteeId } });
    throw e;
  }
  await resolveTasks(COFOUNDER_INVITE, invite.id, actor!.id);
  await logActivity({ actorId: actor!.id, action: "cofounder.accepted", entityType: "cofounderInvite", entityId: invite.id, clubId: invite.clubId });
  await notify({
    userIds: await foundersToTell(invite),
    kind: "cofounder.accepted",
    title: `${actor!.name} joined ${invite.club.name}'s founding team`,
    body: "Give them a seat on your org chart, like Vice President or Treasurer.",
    href: `/clubs/${invite.club.slug}/manage/org-chart`,
    exceptUserId: actor!.id,
  });
  return { slug: invite.club.slug };
}

export async function declineCofounderInvite(actor: Actor | null, token: string) {
  const invite = await loadInviteForAnswer(actor, token);
  await claimInvite(invite.id, "DECLINED", actor!.id);
  await resolveTasks(COFOUNDER_INVITE, invite.id, actor!.id);
  await logActivity({ actorId: actor!.id, action: "cofounder.declined", entityType: "cofounderInvite", entityId: invite.id, clubId: invite.clubId });
  await notify({
    userIds: await foundersToTell(invite),
    kind: "cofounder.declined",
    title: `${actor!.name} won't be joining ${invite.club.name}'s founding team`,
    body: "You can invite someone else from your club's Overview.",
    href: `/clubs/${invite.club.slug}/manage`,
    exceptUserId: actor!.id,
  });
}

/**
 * Links co-founder invitations sent before this person had an account, and
 * opens their tasks. Safe to call repeatedly (lib/auth/accounts calls it at
 * every sign-in, beside the advisor invitations).
 */
export async function linkCofounderInvites(userId: string, email: string) {
  if (emailKind(email) !== "STUDENT") return;
  await db.cofounderInvite.updateMany({ where: { email: { equals: email, mode: "insensitive" }, status: "PENDING", inviteeId: null }, data: { inviteeId: userId } });
  const invites = await db.cofounderInvite.findMany({
    where: { inviteeId: userId, status: "PENDING", club: { status: { in: [...FOUNDING_STATUSES] } } },
    include: { club: { select: { name: true } }, invitedBy: { select: { id: true, name: true } } },
  });
  for (const inv of invites) await ensureInviteTask(inv, inv.club.name, inv.invitedBy);
}
