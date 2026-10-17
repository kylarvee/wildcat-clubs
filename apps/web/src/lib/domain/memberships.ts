import "server-only";
import { randomUUID } from "node:crypto";
import type { MembershipSource } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, ROLE_RANK } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { assertClubCap, assertSignedIn, conflict, forbidden, invalid, notFound } from "@/lib/domain/kit";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { notify, notifyClubCapability } from "@/lib/domain/notify";
import { reopenRequirementTasks } from "@/lib/domain/requirements";

/**
 * Membership and calendar subscriptions. Register buttons (web + mobile),
 * QR check-in auto-enrollment and roster tools all come through here, so the
 * club's join gate is applied the same way everywhere.
 */

export type JoinResult = { status: "ACTIVE" | "PENDING" | "ALREADY_MEMBER" | "ALREADY_PENDING"; membershipId: string };

export async function joinClub(actor: Actor | null, clubId: string, source: MembershipSource = "REGISTER"): Promise<JoinResult> {
  assertSignedIn(actor);
  if (actor.status !== "ACTIVE") throw forbidden("Alumni accounts can't join new clubs.");
  const club = await db.club.findUnique({ where: { id: clubId }, select: { id: true, name: true, slug: true, status: true, joinPolicy: true } });
  if (!club) throw notFound("Club");
  if (club.status !== "APPROVED") throw invalid("This club isn't open for members right now.");

  const existing = await db.membership.findUnique({ where: { userId_clubId: { userId: actor.id, clubId } } });
  if (existing?.status === "ACTIVE") return { status: "ALREADY_MEMBER", membershipId: existing.id };
  if (existing?.status === "PENDING") return { status: "ALREADY_PENDING", membershipId: existing.id };

  // Removed or declined members always go through approval, even in open clubs.
  const gated = club.joinPolicy === "APPROVAL" || existing?.status === "REMOVED" || existing?.status === "DECLINED";
  const now = new Date();
  const membership = await db.membership.upsert({
    where: { userId_clubId: { userId: actor.id, clubId } },
    create: { userId: actor.id, clubId, source, status: gated ? "PENDING" : "ACTIVE", joinedAt: gated ? null : now },
    update: { source, status: gated ? "PENDING" : "ACTIVE", requestedAt: now, joinedAt: gated ? null : now, endedAt: null },
  });

  if (gated) {
    await createTask({
      kind: "APPROVAL",
      title: `${actor.name} asked to join ${club.name}`,
      assignee: { type: "CLUB", clubId, capability: "roster" },
      href: `/clubs/${club.slug}/manage/members`,
      source: { type: "membership", id: membership.id },
      createdById: actor.id,
    });
    await notifyClubCapability(clubId, "roster", { kind: "membership.requested", title: `New join request for ${club.name}`, body: `${actor.name} asked to join.`, href: `/clubs/${club.slug}/manage/members`, exceptUserId: actor.id, email: false });
  } else {
    await subscribeInternal(actor.id, clubId);
  }
  await logActivity({ actorId: actor.id, action: gated ? "membership.requested" : "membership.joined", entityType: "membership", entityId: membership.id, clubId, data: { source }, isPublic: !gated });
  return { status: gated ? "PENDING" : "ACTIVE", membershipId: membership.id };
}

export async function decideMembership(actor: Actor | null, membershipId: string, approve: boolean) {
  const m = await db.membership.findUnique({ where: { id: membershipId }, include: { club: { select: { name: true, slug: true } } } });
  if (!m) throw notFound("Request");
  await assertClubCap(actor, m.clubId, "roster");
  if (m.status !== "PENDING") throw conflict("This request was already decided.");
  const updated = await db.membership.update({
    where: { id: m.id },
    data: approve ? { status: "ACTIVE", joinedAt: new Date() } : { status: "DECLINED", endedAt: new Date() },
  });
  if (approve) await subscribeInternal(m.userId, m.clubId);
  await resolveTasks("membership", m.id, actor!.id);
  await logActivity({ actorId: actor!.id, action: approve ? "membership.approved" : "membership.declined", entityType: "membership", entityId: m.id, clubId: m.clubId, isPublic: approve });
  await notify({
    userIds: [m.userId],
    kind: approve ? "membership.approved" : "membership.declined",
    title: approve ? `You're in! Welcome to ${m.club.name}` : `Your request to join ${m.club.name} wasn't approved`,
    href: `/clubs/${m.club.slug}`,
  });
  return updated;
}

/** Leave a club. Leaders must hand off first if they're the only one in a core seat. */
export async function leaveClub(actor: Actor | null, clubId: string) {
  assertSignedIn(actor);
  const m = await db.membership.findUnique({ where: { userId_clubId: { userId: actor.id, clubId } } });
  if (!m || (m.status !== "ACTIVE" && m.status !== "PENDING")) throw notFound("Membership");
  const roles = await db.roleAssignment.findMany({ where: { clubId, userId: actor.id, endedAt: null } });
  if (roles.some((r) => r.role === "PRESIDENT")) {
    const others = await db.roleAssignment.count({ where: { clubId, role: "PRESIDENT", endedAt: null, userId: { not: actor.id } } });
    if (others === 0) throw forbidden("Name the next president in the org chart before you leave.");
  }
  const now = new Date();
  await db.$transaction([
    db.roleAssignment.updateMany({ where: { clubId, userId: actor.id, endedAt: null }, data: { endedAt: now, endReason: "RESIGNED" } }),
    db.membership.update({ where: { id: m.id }, data: { status: "LEFT", endedAt: now } }),
    db.calendarSubscription.deleteMany({ where: { userId: actor.id, clubId } }),
  ]);
  await resolveTasks("membership", m.id, actor.id, db, "CANCELLED");
  // Ended roles: requirements they no longer owe close now, not on the next job tick.
  if (roles.length) await reopenRequirementTasks(actor.id);
  await logActivity({ actorId: actor.id, action: "membership.left", entityType: "membership", entityId: m.id, clubId });
}

/** Remove someone. You can only remove people ranked below you (advisors/admins: anyone but advisors). */
export async function removeMember(actor: Actor | null, membershipId: string) {
  const m = await db.membership.findUnique({ where: { id: membershipId } });
  if (!m) throw notFound("Member");
  const access = await assertClubCap(actor, m.clubId, "roster");
  const theirRoles = await db.roleAssignment.findMany({ where: { clubId: m.clubId, userId: m.userId, endedAt: null } });
  const theirRank = Math.max(0, ...theirRoles.map((r) => ROLE_RANK[r.role]));
  const full = access.viaPlatform !== null || access.isAdvisor;
  if (theirRoles.some((r) => r.role === "ADVISOR") && !access.viaPlatform) throw forbidden("Only an admin can remove an advisor.");
  if (!full && theirRank >= access.rank) throw forbidden("You can only remove members ranked below you.");
  const now = new Date();
  await db.$transaction([
    db.roleAssignment.updateMany({ where: { clubId: m.clubId, userId: m.userId, endedAt: null }, data: { endedAt: now, endReason: "REMOVED" } }),
    db.membership.update({ where: { id: m.id }, data: { status: "REMOVED", endedAt: now } }),
    db.calendarSubscription.deleteMany({ where: { userId: m.userId, clubId: m.clubId } }),
  ]);
  if (theirRoles.length) await reopenRequirementTasks(m.userId);
  await logActivity({ actorId: actor!.id, action: "membership.removed", entityType: "membership", entityId: m.id, clubId: m.clubId });
}

/** Club-defined secondary title shown next to the base role. */
export async function setInternalTitle(actor: Actor | null, membershipId: string, title: string | null) {
  const m = await db.membership.findUnique({ where: { id: membershipId } });
  if (!m) throw notFound("Member");
  await assertClubCap(actor, m.clubId, "roster");
  const clean = title?.trim().slice(0, 60) || null;
  await db.membership.update({ where: { id: m.id }, data: { internalTitle: clean } });
  await logActivity({ actorId: actor!.id, action: "membership.title_set", entityType: "membership", entityId: m.id, clubId: m.clubId, data: { title: clean } });
}

// ─── Calendar subscriptions ──────────────────────────────────────────────────

async function subscribeInternal(userId: string, clubId: string) {
  await db.calendarSubscription.upsert({ where: { userId_clubId: { userId, clubId } }, create: { userId, clubId }, update: {} });
}

/** Subscribe to a club's calendar without joining (any signed-in user, any approved club). */
export async function subscribeCalendar(actor: Actor | null, clubId: string) {
  assertSignedIn(actor);
  const club = await db.club.findUnique({ where: { id: clubId }, select: { status: true } });
  if (!club || club.status !== "APPROVED") throw notFound("Club");
  await subscribeInternal(actor.id, clubId);
  await logActivity({ actorId: actor.id, action: "calendar.subscribed", entityType: "club", entityId: clubId, clubId });
}

export async function unsubscribeCalendar(actor: Actor | null, clubId: string) {
  assertSignedIn(actor);
  await db.calendarSubscription.deleteMany({ where: { userId: actor.id, clubId } });
  await logActivity({ actorId: actor.id, action: "calendar.unsubscribed", entityType: "club", entityId: clubId, clubId });
}

export async function setUniversityCalendar(actor: Actor | null, on: boolean) {
  assertSignedIn(actor);
  await db.user.update({ where: { id: actor.id }, data: { subscribeUniversity: on } });
}

/** New private calendar link; the old one stops working (for a link that was shared by mistake). */
export async function resetCalendarToken(actor: Actor | null) {
  assertSignedIn(actor);
  await db.user.update({ where: { id: actor.id }, data: { calendarToken: randomUUID().replace(/-/g, "") } });
  await logActivity({ actorId: actor.id, action: "calendar.token_reset", entityType: "user", entityId: actor.id });
}

/** Viewer's relationship to a club, for register/subscribe buttons. */
export async function viewerClubState(actor: Actor | null, clubId: string) {
  if (!actor) return { signedIn: false as const };
  const [access, sub] = await Promise.all([
    getClubAccess(actor, clubId),
    db.calendarSubscription.findUnique({ where: { userId_clubId: { userId: actor.id, clubId } } }),
  ]);
  return {
    signedIn: true as const,
    isMember: Boolean(access?.isMember),
    isPending: Boolean(access?.isPendingMember),
    isLeader: Boolean(access?.isLeader),
    role: access?.role ?? null,
    subscribed: Boolean(sub),
  };
}
