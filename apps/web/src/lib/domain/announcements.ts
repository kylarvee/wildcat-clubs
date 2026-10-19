import "server-only";
import type { AnnouncementAudience, Prisma } from "@prisma/client";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, type ClubAccess } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { INSTITUTION } from "@/lib/institution";
import { richToText, sanitizeRichHtml } from "@/lib/rich/sanitize";
import { assertCan, assertClubCap, assertSignedIn, invalid, notFound, oneLine, parse } from "@/lib/domain/kit";
import { notifyInBatches } from "@/lib/domain/notify";
import { clubLeaderRoleWhere } from "@/lib/domain/messaging";
import { reindexClubSoon } from "@/lib/search/fresh";
import { ANNOUNCEMENT_TITLE_MAX, AUDIENCES } from "@/components/announcements/labels";

/**
 * Announcements — the one input tool for club and university-wide posts.
 *
 *   Club (clubId set)       needs the club's "announcements" capability.
 *                           PUBLIC: anyone, on the public club page; members are notified.
 *                           MEMBERS: the club's members and leaders.
 *                           LEADERS: the club's role holders and advisors.
 *   University (clubId null) needs admin.announce.
 *                           PUBLIC: everyone, signed out included; every active account is notified.
 *                           MEMBERS: every signed-in account.
 *                           LEADERS: every current club leader and advisor.
 *
 * Publishing notifies the audience (in-app, push and email per each person's
 * settings) after the response, in batches. Edits don't notify again, except
 * people a widened audience newly reaches.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type AnnouncementView = {
  id: string;
  clubId: string | null;
  title: string;
  bodyHtml: string;
  audience: AnnouncementAudience;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Changed meaningfully after posting (more than a minute later). */
  edited: boolean;
  author: { id: string; name: string; handle: string; avatarUrl: string | null; avatarColor: string };
  club: { id: string; name: string; slug: string; logoUrl: string | null; logoColor: string } | null;
};

const viewSelect = {
  id: true,
  clubId: true,
  title: true,
  bodyHtml: true,
  audience: true,
  pinned: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, handle: true, avatarUrl: true, avatarColor: true } },
  club: { select: { id: true, name: true, slug: true, logoUrl: true, logoColor: true } },
} satisfies Prisma.AnnouncementSelect;

type Row = Prisma.AnnouncementGetPayload<{ select: typeof viewSelect }>;

function toView(a: Row): AnnouncementView {
  return { ...a, edited: a.updatedAt.getTime() - a.createdAt.getTime() > 60_000 };
}

// ─── Validation ──────────────────────────────────────────────────────────────

const Input = z.object({
  title: z
    .string({ error: "Give the announcement a title." })
    .overwrite(oneLine)
    .trim()
    .min(1, "Give the announcement a title.")
    .max(ANNOUNCEMENT_TITLE_MAX, `Titles can be up to ${ANNOUNCEMENT_TITLE_MAX} characters.`),
  bodyHtml: z.string({ error: "Write the announcement first." }).max(200_000, "That announcement is too long. Try splitting it into two."),
  audience: z.enum(AUDIENCES as [AnnouncementAudience, ...AnnouncementAudience[]], { error: "Choose who the announcement is for." }),
  pinned: z.boolean().default(false),
});
export type AnnouncementInput = z.input<typeof Input>;

function parseInput(input: unknown) {
  const data = parse(Input, input);
  const bodyHtml = sanitizeRichHtml(data.bodyHtml);
  // An embed or picture on its own is a fine announcement; an empty editor isn't.
  if (!richToText(bodyHtml).trim() && !/data-embed=|<img\b/i.test(bodyHtml)) throw invalid("Write the announcement first.");
  return { ...data, bodyHtml };
}

// ─── Permission ──────────────────────────────────────────────────────────────

async function assertManage(actor: Actor | null, clubId: string | null) {
  if (clubId) await assertClubCap(actor, clubId, "announcements");
  else assertCan(actor, "admin.announce");
}

async function loadOwned(actor: Actor | null, id: string) {
  assertSignedIn(actor);
  const row = await db.announcement.findUnique({ where: { id: parse(z.string().min(1).max(64), id) }, select: viewSelect });
  if (!row) throw notFound("Announcement");
  await assertManage(actor, row.clubId);
  return row;
}

// ─── Who hears about it ──────────────────────────────────────────────────────

/** Everyone in a club's audience: role holders for LEADERS; members plus role holders otherwise. */
async function clubAudienceIds(clubId: string, audience: AnnouncementAudience): Promise<string[]> {
  const [members, roles] = await Promise.all([
    audience === "LEADERS" ? [] : db.membership.findMany({ where: { clubId, status: "ACTIVE", user: { status: "ACTIVE" } }, select: { userId: true } }),
    db.roleAssignment.findMany({ where: { clubId, endedAt: null, role: { not: "MEMBER" }, user: { status: "ACTIVE" } }, select: { userId: true } }),
  ]);
  return [...new Set([...members, ...roles].map((r) => r.userId))];
}

/** University audiences: every active account, or every current club leader. */
async function universityAudienceIds(audience: AnnouncementAudience): Promise<string[]> {
  const rows =
    audience === "LEADERS"
      ? await db.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: clubLeaderRoleWhere } }, select: { id: true } })
      : await db.user.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  return rows.map((r) => r.id);
}

const audienceIds = (clubId: string | null, audience: AnnouncementAudience) => (clubId ? clubAudienceIds(clubId, audience) : universityAudienceIds(audience));

/** How many people each audience would notify (for the composer's hints). */
export async function audienceReach(actor: Actor | null, clubId: string | null): Promise<Record<AnnouncementAudience, number>> {
  await assertManage(actor, clubId);
  const [everyone, leaders] = await Promise.all([audienceIds(clubId, "MEMBERS"), audienceIds(clubId, "LEADERS")]);
  return { PUBLIC: everyone.length, MEMBERS: everyone.length, LEADERS: leaders.length };
}

/**
 * Notification work runs after the response (in batches) so posting to the
 * whole university stays quick. A big audience's emails and pushes are
 * queued as one send (lib/domain/notify notifyInBatches); the bells land at once.
 */
function notifyLater(input: { userIds: string[]; title: string; body: string; href: string; exceptUserId: string }) {
  const ids = input.userIds.filter((id) => id !== input.exceptUserId);
  if (!ids.length) return;
  const run = () => notifyInBatches({ userIds: ids, kind: "announcement.new", title: input.title, body: input.body, href: input.href });
  const safe = () => run().catch((e) => console.error("[announcements] notifying failed", e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

function notificationFor(a: { title: string; bodyHtml: string }, club: { name: string; slug: string } | null) {
  const snippet = richToText(a.bodyHtml, 200).replace(/\s+/g, " ").trim();
  return {
    title: club ? `New announcement in ${club.name}` : `New announcement from ${INSTITUTION.studentGovernment}`,
    body: snippet ? `${a.title} — ${snippet}` : a.title,
    href: club ? `/clubs/${club.slug}#announcements` : "/dashboard#announcements",
  };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/** Posts a club announcement and notifies its audience. Returns how many people will be notified. */
export async function createClubAnnouncement(actor: Actor | null, clubId: string, input: unknown): Promise<{ id: string; notified: number }> {
  await assertClubCap(actor, clubId, "announcements");
  const data = parseInput(input);
  const club = await db.club.findUnique({ where: { id: clubId }, select: { name: true, slug: true, status: true } });
  if (!club) throw notFound("Club");
  if (club.status !== "APPROVED") throw invalid("Announcements open once WSUSA approves the club.");
  const a = await db.announcement.create({ data: { clubId, authorId: actor!.id, ...data }, select: { id: true } });
  await logActivity({
    actorId: actor!.id,
    action: "announcement.created",
    entityType: "announcement",
    entityId: a.id,
    clubId,
    data: { title: data.title, audience: data.audience, pinned: data.pinned },
    isPublic: data.audience === "PUBLIC",
  });
  // Public posts are searchable (lib/search); members- and leaders-only ones never are.
  if (data.audience === "PUBLIC") reindexClubSoon(clubId);
  const recipients = (await clubAudienceIds(clubId, data.audience)).filter((id) => id !== actor!.id);
  notifyLater({ userIds: recipients, ...notificationFor(data, club), exceptUserId: actor!.id });
  return { id: a.id, notified: recipients.length };
}

/** Posts a university-wide announcement (admins) and notifies its audience. */
export async function createUniversityAnnouncement(actor: Actor | null, input: unknown): Promise<{ id: string; notified: number }> {
  assertCan(actor, "admin.announce");
  const data = parseInput(input);
  const a = await db.announcement.create({ data: { clubId: null, authorId: actor.id, ...data }, select: { id: true } });
  await logActivity({ actorId: actor.id, action: "announcement.created", entityType: "announcement", entityId: a.id, data: { title: data.title, audience: data.audience, pinned: data.pinned, university: true } });
  const recipients = (await universityAudienceIds(data.audience)).filter((id) => id !== actor.id);
  notifyLater({ userIds: recipients, ...notificationFor(data, null), exceptUserId: actor.id });
  return { id: a.id, notified: recipients.length };
}

/** Edits an announcement. Only people a widened audience newly reaches are notified. */
export async function updateAnnouncement(actor: Actor | null, id: string, input: unknown): Promise<{ id: string; notified: number }> {
  const before = await loadOwned(actor, id);
  const data = parseInput(input);
  await db.announcement.update({ where: { id: before.id }, data });
  await logActivity({
    actorId: actor!.id,
    action: "announcement.updated",
    entityType: "announcement",
    entityId: before.id,
    clubId: before.clubId,
    data: { title: data.title, audience: data.audience, pinned: data.pinned, ...(before.audience !== data.audience ? { previousAudience: before.audience } : {}) },
  });
  if (before.audience === "PUBLIC" || data.audience === "PUBLIC") reindexClubSoon(before.clubId);
  let notified = 0;
  if (before.audience !== data.audience) {
    const [was, now] = await Promise.all([audienceIds(before.clubId, before.audience), audienceIds(before.clubId, data.audience)]);
    const had = new Set(was);
    const fresh = now.filter((u) => !had.has(u) && u !== actor!.id);
    notified = fresh.length;
    notifyLater({ userIds: fresh, ...notificationFor(data, before.club), exceptUserId: actor!.id });
  }
  return { id: before.id, notified };
}

export async function deleteAnnouncement(actor: Actor | null, id: string): Promise<void> {
  const a = await loadOwned(actor, id);
  await db.announcement.delete({ where: { id: a.id } });
  await logActivity({ actorId: actor!.id, action: "announcement.deleted", entityType: "announcement", entityId: a.id, clubId: a.clubId, data: { title: a.title } });
  if (a.audience === "PUBLIC") reindexClubSoon(a.clubId);
}

/** Pins to (or unpins from) the top of the club page or the university list. Doesn't notify. */
export async function setAnnouncementPinned(actor: Actor | null, id: string, pinned: boolean): Promise<{ pinned: boolean }> {
  const a = await loadOwned(actor, id);
  const on = parse(z.boolean(), pinned);
  if (a.pinned !== on) {
    // Pinning shouldn't mark the post "edited", so updatedAt is kept.
    await db.announcement.update({ where: { id: a.id }, data: { pinned: on, updatedAt: a.updatedAt } });
    await logActivity({ actorId: actor!.id, action: on ? "announcement.pinned" : "announcement.unpinned", entityType: "announcement", entityId: a.id, clubId: a.clubId, data: { title: a.title } });
  }
  return { pinned: on };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Audiences a club-page viewer may see. Matches lib/clubs/queries visibleAnnouncementCount. */
export function visibleAudiences(access: ClubAccess | null): AnnouncementAudience[] {
  const out: AnnouncementAudience[] = ["PUBLIC"];
  if (access?.isMember || access?.isLeader) out.push("MEMBERS");
  if (access?.isLeader) out.push("LEADERS");
  return out;
}

const pinnedFirst: Prisma.AnnouncementOrderByWithRelationInput[] = [{ pinned: "desc" }, { createdAt: "desc" }];

/** A club's announcements this viewer may see, pinned first, plus whether they may post. */
export async function clubAnnouncementsFor(
  viewer: Actor | null,
  clubId: string,
  opts: { take?: number } = {},
): Promise<{ items: AnnouncementView[]; total: number; canPost: boolean }> {
  const access = viewer ? await getClubAccess(viewer, clubId) : null;
  const where: Prisma.AnnouncementWhereInput = { clubId, audience: { in: visibleAudiences(access) } };
  const [rows, total] = await Promise.all([
    db.announcement.findMany({ where, orderBy: pinnedFirst, take: Math.min(opts.take ?? 20, 50), select: viewSelect }),
    db.announcement.count({ where }),
  ]);
  return { items: rows.map(toView), total, canPost: Boolean(access?.capabilities.has("announcements")) };
}

/** Every announcement a manager can edit: one club's, or the university's (clubId null). */
export async function managedAnnouncements(actor: Actor | null, clubId: string | null): Promise<AnnouncementView[]> {
  await assertManage(actor, clubId);
  const rows = await db.announcement.findMany({ where: { clubId }, orderBy: pinnedFirst, take: 200, select: viewSelect });
  return rows.map(toView);
}

/** One announcement for its edit page; null when it's not in this scope or the actor can't manage it. */
export async function announcementForEdit(actor: Actor | null, id: string, clubId: string | null): Promise<AnnouncementView | null> {
  await assertManage(actor, clubId);
  const row = await db.announcement.findFirst({ where: { id, clubId }, select: viewSelect });
  return row ? toView(row) : null;
}

/**
 * The dashboard feed: university announcements for this person's audiences,
 * plus announcements from clubs they're active in (leaders-only posts where
 * they lead). Pinned university posts first, then newest first. Signed-out
 * visitors (userId null) get public university announcements.
 */
export async function announcementFeed(userId: string | null, limit = 5): Promise<AnnouncementView[]> {
  const take = Math.min(Math.max(limit, 1), 50);
  const user = userId ? await db.user.findUnique({ where: { id: userId }, select: { id: true, status: true, platformRole: true } }) : null;
  const signedIn = Boolean(user && user.status !== "DEACTIVATED");

  let memberClubs: string[] = [];
  let leaderClubs: string[] = [];
  let leadsAnywhere = false;
  if (user && signedIn) {
    const [memberships, roles] = await Promise.all([
      db.membership.findMany({ where: { userId: user.id, status: "ACTIVE", club: { status: "APPROVED" } }, select: { clubId: true } }),
      db.roleAssignment.findMany({ where: { userId: user.id, endedAt: null }, select: { clubId: true, role: true, club: { select: { status: true } } } }),
    ]);
    const approvedRoles = roles.filter((r) => r.club.status === "APPROVED");
    memberClubs = [...new Set([...memberships.map((m) => m.clubId), ...approvedRoles.map((r) => r.clubId)])];
    leaderClubs = [...new Set(approvedRoles.filter((r) => r.role !== "MEMBER").map((r) => r.clubId))];
    leadsAnywhere = (await db.roleAssignment.count({ where: { userId: user.id, ...clubLeaderRoleWhere } })) > 0;
  }
  const admin = user?.platformRole === "ADMIN" || user?.platformRole === "SYSADMIN";
  const universityAudiences: AnnouncementAudience[] = signedIn ? (leadsAnywhere || admin ? ["PUBLIC", "MEMBERS", "LEADERS"] : ["PUBLIC", "MEMBERS"]) : ["PUBLIC"];

  const where: Prisma.AnnouncementWhereInput = {
    OR: [
      { clubId: null, audience: { in: universityAudiences } },
      ...(memberClubs.length ? [{ clubId: { in: memberClubs }, audience: { in: ["PUBLIC", "MEMBERS"] as AnnouncementAudience[] } }] : []),
      ...(leaderClubs.length ? [{ clubId: { in: leaderClubs }, audience: "LEADERS" as const }] : []),
    ],
  };
  const [pinned, recent] = await Promise.all([
    db.announcement.findMany({ where: { AND: [where, { clubId: null, pinned: true }] }, orderBy: { createdAt: "desc" }, take, select: viewSelect }),
    db.announcement.findMany({ where, orderBy: { createdAt: "desc" }, take, select: viewSelect }),
  ]);
  const seen = new Set(pinned.map((a) => a.id));
  return [...pinned, ...recent.filter((a) => !seen.has(a.id))].slice(0, take).map(toView);
}
