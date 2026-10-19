import "server-only";
import { Prisma, type ClubRole, type ClubStatus, type ConversationType, type PlatformRole, type UserStatus } from "@prisma/client";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { ROLE_LABEL, ROLE_RANK } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { INSTITUTION } from "@/lib/institution";
import { assertSignedIn, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify } from "@/lib/domain/notify";
import { ensureClubChatSpace, mirrorDeletedMessage, mirrorEditedMessage, mirrorNewMessage } from "@/lib/integrations/google-chat";
import {
  GROUP_MAX_MEMBERS,
  GROUP_TITLE_MAX_LENGTH,
  MESSAGE_PAGE_SIZE,
  firstName,
  messageBodyProblem,
  normalizeMessageBody,
  previewText,
} from "@/components/messages/format";

/**
 * Messaging — club group chats, direct messages and leader group chats, on the
 * Google Chat model. THE authority for who may message whom:
 *
 *   CLUB chat      one per approved club. Participants are the club's ACTIVE
 *                  members plus everyone holding a current role (advisors
 *                  included). ConversationMember rows on club chats are only
 *                  read markers, created the first time someone reads.
 *                  People marked alumni in the club can still read it.
 *   DIRECT         you may message anyone you share an approved club with.
 *                  Club leaders (ambassador, officer, VP, president with a
 *                  current role, or advisor) may also message the leaders of
 *                  any club, and admins may message any club leader. The rule
 *                  is symmetric and re-checked on every send.
 *   LEADERS_GROUP  only leaders (or admins) start one, name it and add other
 *                  leaders. Members who stop being leaders can still read.
 *
 * Alumni accounts read their history but never send. Messages are plain text
 * up to 4,000 characters; editing and deleting are for the author only, and a
 * deleted message keeps its place as "Message deleted" with the text erased.
 * Nothing here ever touches complaint data.
 */

// ─── Types (client-safe via `import type`) ───────────────────────────────────

export type PersonRef = { id: string; name: string; handle: string; avatarUrl: string | null; avatarColor: string };
export type ChatClubRef = { id: string; name: string; slug: string; logoUrl: string | null; logoColor: string; status: ClubStatus };

export type MessageView = {
  id: string;
  conversationId: string;
  author: PersonRef;
  /** Empty once deleted. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
};

export type ConversationListItem = {
  id: string;
  type: ConversationType;
  name: string;
  club: ChatClubRef | null;
  /** DIRECT: the other person. LEADERS_GROUP: a few other members, for the avatar stack. */
  people: PersonRef[];
  memberCount: number | null;
  lastMessageAt: string;
  preview: string | null;
  unread: number;
  canSend: boolean;
};

export type Participant = PersonRef & { label: string | null; isLeader: boolean; isMe: boolean };

export type ConversationDetail = {
  id: string;
  type: ConversationType;
  name: string;
  club: ChatClubRef | null;
  other: (PersonRef & { context: string | null; active: boolean }) | null;
  participants: Participant[];
  participantCount: number;
  canSend: boolean;
  readOnlyReason: string | null;
  /** Leader groups: may rename and add leaders. */
  canManageGroup: boolean;
  /** When you last read this conversation (ISO), for the "New" divider. Null before your first visit to a DM or group. */
  readMarker: string | null;
};

export type PersonResult = PersonRef & { context: string | null; conversationId: string | null };

/** cursor: pass as ?after= to poll for what changes from here on. */
export type ThreadPage = { messages: MessageView[]; hasOlder: boolean; cursor: string };
export type ThreadPoll = { messages: MessageView[]; cursor: string; canSend: boolean; readOnlyReason: string | null };

// ─── Rules ───────────────────────────────────────────────────────────────────

/** A role in a club at any of these stages makes you a "club leader" for messaging. */
const LEADER_CLUB_STATUSES: ClubStatus[] = ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED"];
const LEADER_ROLES: ClubRole[] = ["AMBASSADOR", "OFFICER", "VP", "PRESIDENT", "ADVISOR"];
const ALUMNI_READ_ONLY = "Alumni accounts can read past messages but can't send new ones.";
/** Polls re-read a few seconds back so a message committed mid-poll is never skipped (the client de-dupes by id). */
const POLL_OVERLAP_MS = 4000;

const personSelect = { id: true, name: true, handle: true, avatarUrl: true, avatarColor: true } as const;
const clubSelect = { id: true, name: true, slug: true, logoUrl: true, logoColor: true, status: true } as const;
const messageSelect = {
  id: true,
  conversationId: true,
  body: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
  author: { select: personSelect },
} satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

function toView(m: MessageRow): MessageView {
  return {
    id: m.id,
    conversationId: m.conversationId,
    author: m.author,
    body: m.deletedAt ? "" : m.body,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deleted: Boolean(m.deletedAt),
  };
}

const leaderRoleWhere = { endedAt: null, role: { in: LEADER_ROLES }, club: { status: { in: LEADER_CLUB_STATUSES } } } satisfies Prisma.RoleAssignmentWhereInput;

/** "Club leader" for messaging and leader announcements: a current leadership role (or advisor) in a club that isn't retired or rejected. */
export const clubLeaderRoleWhere: Prisma.RoleAssignmentWhereInput = leaderRoleWhere;

type ReachUser = { id: string; status: UserStatus; platformRole: PlatformRole };
type Reach = { id: string; active: boolean; admin: boolean; leader: boolean; clubs: Set<string> };

/** Messaging reach for several people at once: their club chats and whether they lead anywhere. */
async function reachMany(users: ReachUser[]): Promise<Map<string, Reach>> {
  const ids = [...new Set(users.map((u) => u.id))];
  const [memberships, roles] = ids.length
    ? await Promise.all([
        db.membership.findMany({ where: { userId: { in: ids }, status: "ACTIVE", club: { status: "APPROVED" } }, select: { userId: true, clubId: true } }),
        db.roleAssignment.findMany({ where: { userId: { in: ids }, endedAt: null }, select: { userId: true, clubId: true, role: true, club: { select: { status: true } } } }),
      ])
    : [[], []];
  const out = new Map<string, Reach>();
  for (const u of users) {
    out.set(u.id, { id: u.id, active: u.status === "ACTIVE", admin: u.platformRole === "ADMIN" || u.platformRole === "SYSADMIN", leader: false, clubs: new Set() });
  }
  for (const m of memberships) out.get(m.userId)?.clubs.add(m.clubId);
  for (const r of roles) {
    const reach = out.get(r.userId);
    if (!reach) continue;
    if (r.club.status === "APPROVED") reach.clubs.add(r.clubId);
    if (LEADER_ROLES.includes(r.role) && LEADER_CLUB_STATUSES.includes(r.club.status)) reach.leader = true;
  }
  return out;
}

async function reachOf(user: ReachUser): Promise<Reach> {
  return (await reachMany([user])).get(user.id)!;
}

/** Symmetric: may these two people message each other directly, and why. */
function pairRule(a: Reach, b: Reach): "club" | "leaders" | null {
  if (a.id === b.id || !a.active || !b.active) return null;
  for (const c of a.clubs) if (b.clubs.has(c)) return "club";
  if ((a.leader && (b.leader || b.admin)) || (b.leader && a.admin)) return "leaders";
  return null;
}

const canLeadGroups = (r: Reach) => r.active && (r.leader || r.admin);

/** Whether `actor` may start (or keep) a direct conversation with `userId`. For "Message" buttons on profiles. */
export async function canDirectMessage(actor: Actor | null, userId: string): Promise<boolean> {
  if (!actor || actor.id === userId) return false;
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, status: true, platformRole: true } });
  if (!target) return false;
  const reach = await reachMany([actor, target]);
  return pairRule(reach.get(actor.id)!, reach.get(target.id)!) !== null;
}

/** Whether `actor` may start a leader group (current club leader, advisor or admin). */
export async function canStartLeaderGroup(actor: Actor | null): Promise<boolean> {
  if (!actor) return false;
  return canLeadGroups(await reachOf(actor));
}

// ─── Background work ─────────────────────────────────────────────────────────

/** Google mirroring runs after the response inside a request, or right away elsewhere (jobs, scripts). */
function later(task: () => Promise<unknown>) {
  const run = () => task().catch((e) => console.warn("[messaging] background task failed", e));
  try {
    after(run);
  } catch {
    void run();
  }
}

// ─── Club chats ──────────────────────────────────────────────────────────────

/** The club's chat, created the first time someone needs it. The oldest wins if two ever exist. */
export async function ensureClubConversation(clubId: string): Promise<string> {
  const existing = await db.conversation.findFirst({ where: { clubId, type: "CLUB" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  if (existing) return existing.id;
  const club = await db.club.findUnique({ where: { id: clubId }, select: { status: true, approvedAt: true, googleChatSpaceId: true } });
  if (!club || club.status !== "APPROVED") throw notFound("Club chat");
  const id = await db.$transaction(async (tx) => {
    // Two first readers at once must not create two chats.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`club-chat:${clubId}`}))`;
    const again = await tx.conversation.findFirst({ where: { clubId, type: "CLUB" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
    if (again) return again.id;
    const now = new Date();
    const created = await tx.conversation.create({
      data: { type: "CLUB", clubId, createdAt: now, lastMessageAt: club.approvedAt ?? now, googleSpaceId: club.googleChatSpaceId },
      select: { id: true },
    });
    await logActivity({ actorId: null, action: "conversation.created", entityType: "conversation", entityId: created.id, data: { type: "CLUB", clubId } }, tx);
    return created.id;
  });
  later(() => ensureClubChatSpace(clubId));
  return id;
}

/** Approved clubs whose chat this person is in (ACTIVE member or current role holder). */
async function chatClubIds(userId: string): Promise<Set<string>> {
  const reach = await reachMany([{ id: userId, status: "ACTIVE", platformRole: "USER" }]);
  return reach.get(userId)!.clubs;
}

/** Opens a club's chat by club (for "Club chat" links). Creates it on first use for participants. */
export async function openClubChat(actor: Actor | null, clubId: string): Promise<{ id: string }> {
  assertSignedIn(actor);
  const [participantClubs, membership] = await Promise.all([
    chatClubIds(actor.id),
    db.membership.findUnique({ where: { userId_clubId: { userId: actor.id, clubId } }, select: { status: true } }),
  ]);
  if (participantClubs.has(clubId)) return { id: await ensureClubConversation(clubId) };
  if (membership?.status === "ALUMNI") {
    const existing = await db.conversation.findFirst({ where: { clubId, type: "CLUB" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
    if (existing) return existing;
  }
  throw forbidden("Club chats are for the club's members and leaders. Register for the club to join its chat.");
}

// ─── Access to one conversation ──────────────────────────────────────────────

type LoadedConversation = {
  id: string;
  type: ConversationType;
  clubId: string | null;
  title: string | null;
  createdAt: Date;
  lastMessageAt: Date;
  club: ChatClubRef | null;
};

type ConversationAccess = {
  convo: LoadedConversation;
  canRead: boolean;
  canSend: boolean;
  readOnlyReason: string | null;
  /** DIRECT only: the other person (null when their account is gone). */
  other: (PersonRef & ReachUser) | null;
  actorReach: Reach;
};

async function accessFor(actor: Actor, conversationId: string): Promise<ConversationAccess | null> {
  const convo = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, type: true, clubId: true, title: true, createdAt: true, lastMessageAt: true, club: { select: clubSelect } },
  });
  if (!convo) return null;
  const actorReach = await reachOf(actor);
  const base = { convo, other: null, actorReach };

  if (convo.type === "CLUB") {
    const club = convo.club;
    if (!club || !convo.clubId) return { ...base, canRead: false, canSend: false, readOnlyReason: null };
    const participant = actorReach.clubs.has(club.id);
    const membership = participant ? null : await db.membership.findUnique({ where: { userId_clubId: { userId: actor.id, clubId: club.id } }, select: { status: true } });
    const alumnus = membership?.status === "ALUMNI";
    const canRead = (participant || alumnus) && (club.status === "APPROVED" || club.status === "RETIRED");
    const canSend = canRead && participant && club.status === "APPROVED" && actorReach.active;
    const readOnlyReason = canSend
      ? null
      : club.status === "RETIRED"
        ? `${club.name} is retired, so its chat is read-only.`
        : !actorReach.active
          ? ALUMNI_READ_ONLY
          : `You're listed as alumni in ${club.name}, so you can read the chat but not post.`;
    return { ...base, canRead, canSend, readOnlyReason: canRead ? readOnlyReason : null };
  }

  const members = await db.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true, user: { select: { ...personSelect, status: true, platformRole: true } } },
  });
  if (!members.some((m) => m.userId === actor.id)) return { ...base, canRead: false, canSend: false, readOnlyReason: null };

  if (convo.type === "DIRECT") {
    const other = members.find((m) => m.userId !== actor.id)?.user ?? null;
    let readOnlyReason: string | null = null;
    if (!actorReach.active) readOnlyReason = ALUMNI_READ_ONLY;
    else if (!other) readOnlyReason = "This person's account no longer exists.";
    else if (other.status === "DEACTIVATED") readOnlyReason = `${other.name}'s account is no longer active.`;
    else if (other.status === "ALUMNI") readOnlyReason = `${firstName(other.name)} has graduated, so new messages are off. You can still read your history.`;
    else if (!pairRule(actorReach, await reachOf(other))) {
      readOnlyReason = `You and ${firstName(other.name)} no longer share a club, so you can't send new messages here.`;
    }
    return { ...base, other, canRead: true, canSend: readOnlyReason === null, readOnlyReason };
  }

  // LEADERS_GROUP
  const readOnlyReason = !actorReach.active ? ALUMNI_READ_ONLY : canLeadGroups(actorReach) ? null : "You're no longer a club leader, so you can read this group but not post.";
  return { ...base, canRead: true, canSend: readOnlyReason === null, readOnlyReason };
}

async function requireReadable(actor: Actor, conversationId: string): Promise<ConversationAccess> {
  const access = await accessFor(actor, conversationId);
  // Someone else's conversation looks exactly like a missing one.
  if (!access?.canRead) throw notFound("Conversation");
  return access;
}

// ─── Unread counts ───────────────────────────────────────────────────────────

/**
 * Unread messages per conversation for one person: messages from others,
 * not deleted, after their read marker. Club chats they've never opened count
 * from when they joined the club. Alumni-only club chats aren't counted.
 */
async function unreadByConversation(userId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ id: string; unread: number }[]>`
    WITH my_clubs AS (
      SELECT x."clubId", MIN(x.since) AS since FROM (
        SELECT ms."clubId", COALESCE(ms."joinedAt", ms."requestedAt") AS since
          FROM "Membership" ms WHERE ms."userId" = ${userId} AND ms.status = 'ACTIVE'
        UNION ALL
        SELECT ra."clubId", ra."startedAt" FROM "RoleAssignment" ra WHERE ra."userId" = ${userId} AND ra."endedAt" IS NULL
      ) x JOIN "Club" cl ON cl.id = x."clubId" AND cl.status = 'APPROVED'
      GROUP BY x."clubId"
    ), club_chats AS (
      SELECT DISTINCT ON (c."clubId") c.id, COALESCE(cm."lastReadAt", mc.since) AS since
        FROM "Conversation" c
        JOIN my_clubs mc ON mc."clubId" = c."clubId"
        LEFT JOIN "ConversationMember" cm ON cm."conversationId" = c.id AND cm."userId" = ${userId}
       WHERE c.type = 'CLUB'
       ORDER BY c."clubId", c."createdAt" ASC, c.id ASC
    ), mine AS (
      SELECT id, since FROM club_chats
      UNION ALL
      SELECT c.id, COALESCE(cm."lastReadAt", cm."joinedAt") AS since
        FROM "ConversationMember" cm JOIN "Conversation" c ON c.id = cm."conversationId"
       WHERE cm."userId" = ${userId} AND c.type <> 'CLUB'
    )
    SELECT mine.id, COUNT(m.id)::int AS unread
      FROM mine
      JOIN "Message" m ON m."conversationId" = mine.id
     WHERE m."createdAt" > mine.since AND m."authorId" <> ${userId} AND m."deletedAt" IS NULL
     GROUP BY mine.id`;
  return new Map(rows.map((r) => [r.id, Number(r.unread)]));
}

/** How many conversations have unread messages (the badge on the header's Messages icon). */
export async function countUnreadConversations(userId: string): Promise<number> {
  let n = 0;
  for (const count of (await unreadByConversation(userId)).values()) if (count > 0) n++;
  return n;
}

// ─── Conversation list ───────────────────────────────────────────────────────

type LastMessage = { conversationId: string; body: string; deletedAt: Date | null; authorId: string; authorName: string };

async function lastMessages(ids: string[]): Promise<Map<string, LastMessage>> {
  if (!ids.length) return new Map();
  const rows = await db.$queryRaw<LastMessage[]>`
    SELECT c.id AS "conversationId", lm.body, lm."deletedAt", lm."authorId", lm."authorName"
      FROM unnest(${ids}::text[]) AS c(id)
      CROSS JOIN LATERAL (
        SELECT m.body, m."deletedAt", m."authorId", u.name AS "authorName"
          FROM "Message" m JOIN "User" u ON u.id = m."authorId"
         WHERE m."conversationId" = c.id
         ORDER BY m."createdAt" DESC, m.id DESC
         LIMIT 1
      ) lm`;
  return new Map(rows.map((r) => [r.conversationId, r]));
}

function previewFor(last: LastMessage | undefined, meId: string, type: ConversationType): string | null {
  if (!last) return null;
  if (last.deletedAt) return "Message deleted";
  const text = previewText(last.body, 90);
  if (last.authorId === meId) return `You: ${text}`;
  return type === "DIRECT" ? text : `${firstName(last.authorName)}: ${text}`;
}

/**
 * Everything in your Messages list: your club chats (created on first use),
 * direct messages and leader groups, most recent first, with unread counts.
 */
export async function listConversations(actor: Actor | null): Promise<ConversationListItem[]> {
  assertSignedIn(actor);
  const [actorReach, alumniClubs, memberRows] = await Promise.all([
    reachOf(actor),
    db.membership.findMany({ where: { userId: actor.id, status: "ALUMNI", club: { status: { in: ["APPROVED", "RETIRED"] } } }, select: { clubId: true } }),
    db.conversationMember.findMany({ where: { userId: actor.id, conversation: { type: { not: "CLUB" } } }, select: { conversationId: true, lastReadAt: true } }),
  ]);
  const participantClubs = actorReach.clubs;
  const historyClubs = alumniClubs.map((m) => m.clubId).filter((id) => !participantClubs.has(id));

  const clubChats = await db.conversation.findMany({
    where: { type: "CLUB", clubId: { in: [...participantClubs, ...historyClubs] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, clubId: true },
  });
  const chatByClub = new Map<string, string>();
  for (const c of clubChats) if (c.clubId && !chatByClub.has(c.clubId)) chatByClub.set(c.clubId, c.id);
  for (const clubId of participantClubs) if (!chatByClub.has(clubId)) chatByClub.set(clubId, await ensureClubConversation(clubId));

  const clubIds = [...chatByClub.values()];
  const otherIds = memberRows.map((m) => m.conversationId);
  const [clubConvos, otherConvos, unread, last] = await Promise.all([
    db.conversation.findMany({ where: { id: { in: clubIds } }, select: { id: true, type: true, title: true, lastMessageAt: true, club: { select: clubSelect } } }),
    db.conversation.findMany({
      where: { id: { in: otherIds } },
      select: {
        id: true,
        type: true,
        title: true,
        lastMessageAt: true,
        _count: { select: { members: true } },
        members: { where: { userId: { not: actor.id } }, orderBy: { joinedAt: "asc" }, take: 3, select: { user: { select: { ...personSelect, status: true, platformRole: true } } } },
      },
    }),
    unreadByConversation(actor.id),
    lastMessages([...clubIds, ...otherIds]),
  ]);

  // Who you can still DM: one batched reach lookup for every DM partner.
  const partners = otherConvos.filter((c) => c.type === "DIRECT").flatMap((c) => c.members.map((m) => m.user));
  const partnerReach = await reachMany(partners);
  const readMarker = new Map(memberRows.map((m) => [m.conversationId, m.lastReadAt]));

  const items: ConversationListItem[] = [];
  for (const c of clubConvos) {
    if (!c.club) continue;
    items.push({
      id: c.id,
      type: "CLUB",
      name: c.club.name,
      club: c.club,
      people: [],
      memberCount: null,
      lastMessageAt: c.lastMessageAt.toISOString(),
      preview: previewFor(last.get(c.id), actor.id, "CLUB"),
      unread: unread.get(c.id) ?? 0,
      canSend: participantClubs.has(c.club.id) && c.club.status === "APPROVED" && actorReach.active,
    });
  }
  for (const c of otherConvos) {
    const lm = last.get(c.id);
    const people = c.members.map((m) => ({ id: m.user.id, name: m.user.name, handle: m.user.handle, avatarUrl: m.user.avatarUrl, avatarColor: m.user.avatarColor }));
    if (c.type === "DIRECT") {
      // An empty DM someone else opened stays hidden until they actually write.
      if (!lm && !readMarker.get(c.id)) continue;
      const other = c.members[0]?.user;
      const reach = other ? partnerReach.get(other.id) : undefined;
      items.push({
        id: c.id,
        type: "DIRECT",
        name: other?.name ?? "Deleted account",
        club: null,
        people,
        memberCount: 2,
        lastMessageAt: c.lastMessageAt.toISOString(),
        preview: previewFor(lm, actor.id, "DIRECT"),
        unread: unread.get(c.id) ?? 0,
        canSend: Boolean(reach && pairRule(actorReach, reach)),
      });
    } else {
      items.push({
        id: c.id,
        type: c.type,
        name: c.title || "Leader group",
        club: null,
        people,
        memberCount: c._count.members,
        lastMessageAt: c.lastMessageAt.toISOString(),
        preview: previewFor(lm, actor.id, c.type),
        unread: unread.get(c.id) ?? 0,
        canSend: canLeadGroups(actorReach),
      });
    }
  }
  return items.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || a.name.localeCompare(b.name));
}

// ─── One conversation ────────────────────────────────────────────────────────

/** "President, Wildcat Robotics" (top role first; "+2" when they lead more clubs). */
async function leaderLabels(userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const rows = await db.roleAssignment.findMany({
    where: { userId: { in: userIds }, ...leaderRoleWhere },
    select: { userId: true, role: true, position: { select: { name: true } }, club: { select: { name: true } } },
  });
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  const out = new Map<string, string>();
  for (const [userId, list] of byUser) {
    const top = [...list].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.club.name.localeCompare(b.club.name))[0];
    const clubs = new Set(list.map((r) => r.club.name)).size;
    out.set(userId, `${top.position?.name ?? ROLE_LABEL[top.role]}, ${top.club.name}${clubs > 1 ? ` +${clubs - 1}` : ""}`);
  }
  return out;
}

function adminLabel(platformRole: PlatformRole) {
  return platformRole === "SYSADMIN" ? "System administrator" : `${INSTITUTION.studentGovernment} administrator`;
}

/** Where unread starts for this person: their read marker, else when they joined (the club, for club chats). Matches unreadByConversation. */
async function readMarkerFor(userId: string, convo: LoadedConversation): Promise<string | null> {
  const marker = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: convo.id, userId } }, select: { lastReadAt: true, joinedAt: true } });
  if (marker) return (marker.lastReadAt ?? marker.joinedAt).toISOString();
  if (convo.type !== "CLUB" || !convo.clubId) return null;
  const [membership, role] = await Promise.all([
    db.membership.findUnique({ where: { userId_clubId: { userId, clubId: convo.clubId } }, select: { status: true, joinedAt: true, requestedAt: true } }),
    db.roleAssignment.findFirst({ where: { userId, clubId: convo.clubId, endedAt: null }, orderBy: { startedAt: "asc" }, select: { startedAt: true } }),
  ]);
  const since = [membership?.status === "ACTIVE" ? (membership.joinedAt ?? membership.requestedAt) : null, role?.startedAt].filter((d): d is Date => Boolean(d));
  return since.length ? new Date(Math.min(...since.map((d) => d.getTime()))).toISOString() : null;
}

/** Header, read-only state and the participants sheet for one conversation. */
export async function conversationDetail(actor: Actor | null, conversationId: string): Promise<ConversationDetail> {
  assertSignedIn(actor);
  const access = await requireReadable(actor, conversationId);
  const { convo } = access;
  const common = {
    id: convo.id,
    type: convo.type,
    club: convo.club,
    canSend: access.canSend,
    readOnlyReason: access.readOnlyReason,
    readMarker: await readMarkerFor(actor.id, convo),
  };

  if (convo.type === "CLUB" && convo.club) {
    const clubId = convo.club.id;
    const [members, roles] = await Promise.all([
      db.membership.findMany({ where: { clubId, status: "ACTIVE", user: { status: { not: "DEACTIVATED" } } }, select: { internalTitle: true, user: { select: personSelect } } }),
      db.roleAssignment.findMany({
        where: { clubId, endedAt: null, user: { status: { not: "DEACTIVATED" } } },
        select: { role: true, position: { select: { name: true } }, user: { select: personSelect } },
      }),
    ]);
    const people = new Map<string, Participant & { rank: number }>();
    for (const m of members) people.set(m.user.id, { ...m.user, label: m.internalTitle, isLeader: false, isMe: m.user.id === actor.id, rank: 0 });
    for (const r of roles) {
      const rank = ROLE_RANK[r.role];
      const prev = people.get(r.user.id);
      if (prev && prev.rank >= rank && prev.isLeader) continue;
      people.set(r.user.id, { ...r.user, label: r.position?.name ?? ROLE_LABEL[r.role], isLeader: rank >= 1, isMe: r.user.id === actor.id, rank });
    }
    const participants = [...people.values()]
      .sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || b.rank - a.rank || a.name.localeCompare(b.name))
      .map(({ rank: _rank, ...p }) => p);
    return { ...common, name: convo.club.name, other: null, participants, participantCount: participants.length, canManageGroup: false };
  }

  if (convo.type === "DIRECT") {
    const other = access.other;
    let context: string | null = null;
    if (other) {
      const otherReach = await reachOf(other);
      const shared = [...access.actorReach.clubs].filter((c) => otherReach.clubs.has(c));
      if (shared.length) {
        const clubs = await db.club.findMany({ where: { id: { in: shared } }, select: { name: true }, orderBy: { name: "asc" } });
        context = `You're both in ${clubs.length > 2 ? `${clubs[0].name}, ${clubs[1].name} and ${clubs.length - 2} more` : clubs.map((c) => c.name).join(" and ")}`;
      } else {
        context = (await leaderLabels([other.id])).get(other.id) ?? (otherReach.admin ? adminLabel(other.platformRole) : null);
      }
    }
    const me: Participant = { id: actor.id, name: actor.name, handle: actor.handle, avatarUrl: actor.avatarUrl, avatarColor: actor.avatarColor, label: null, isLeader: false, isMe: true };
    const otherRef = other ? { id: other.id, name: other.name, handle: other.handle, avatarUrl: other.avatarUrl, avatarColor: other.avatarColor } : null;
    return {
      ...common,
      name: other?.name ?? "Deleted account",
      other: otherRef ? { ...otherRef, context, active: other?.status === "ACTIVE" } : null,
      participants: otherRef ? [{ ...otherRef, label: context, isLeader: false, isMe: false }, me] : [me],
      participantCount: otherRef ? 2 : 1,
      canManageGroup: false,
    };
  }

  const rows = await db.conversationMember.findMany({
    where: { conversationId },
    orderBy: { joinedAt: "asc" },
    select: { user: { select: { ...personSelect, platformRole: true } } },
  });
  const labels = await leaderLabels(rows.map((r) => r.user.id));
  const participants: Participant[] = rows
    .map(({ user: { platformRole, ...u } }) => ({
      ...u,
      label: labels.get(u.id) ?? (platformRole !== "USER" ? adminLabel(platformRole) : "No longer a club leader"),
      isLeader: labels.has(u.id),
      isMe: u.id === actor.id,
    }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name));
  return { ...common, name: convo.title || "Leader group", other: null, participants, participantCount: participants.length, canManageGroup: access.canSend };
}

// ─── Reading messages ────────────────────────────────────────────────────────

const IsoDate = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), "Use an ISO date.");

/** The latest page of messages (oldest first), or the page before `before`. */
export async function loadThread(actor: Actor | null, conversationId: string, opts: { before?: string | Date | null; limit?: number } = {}): Promise<ThreadPage> {
  assertSignedIn(actor);
  const started = Date.now();
  await requireReadable(actor, conversationId);
  const before = opts.before ? parse(IsoDate, opts.before) : null;
  const limit = Math.min(Math.max(opts.limit ?? MESSAGE_PAGE_SIZE, 1), 100);
  const rows = await db.message.findMany({
    where: { conversationId, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: messageSelect,
  });
  const hasOlder = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse().map(toView), hasOlder, cursor: new Date(started - POLL_OVERLAP_MS).toISOString() };
}

/**
 * What changed since `after` (new, edited or deleted messages), oldest first.
 * Pass the returned cursor as the next `after`. Also reports whether you can
 * still send, so the composer locks if you leave the club mid-conversation.
 */
export async function pollThread(actor: Actor | null, conversationId: string, after: string | Date): Promise<ThreadPoll> {
  assertSignedIn(actor);
  const since = parse(IsoDate, after);
  const started = Date.now();
  const access = await requireReadable(actor, conversationId);
  const rows = await db.message.findMany({
    where: { conversationId, OR: [{ createdAt: { gt: since } }, { editedAt: { gt: since } }, { deletedAt: { gt: since } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    select: messageSelect,
  });
  return { messages: rows.map(toView), cursor: new Date(started - POLL_OVERLAP_MS).toISOString(), canSend: access.canSend, readOnlyReason: access.readOnlyReason };
}

/** Marks a conversation read now (creating the read marker for club chats) and clears its message notifications. */
export async function markConversationRead(actor: Actor | null, conversationId: string): Promise<{ unreadConversations: number }> {
  assertSignedIn(actor);
  await requireReadable(actor, conversationId);
  const now = new Date();
  await db.conversationMember.upsert({
    where: { conversationId_userId: { conversationId, userId: actor.id } },
    create: { conversationId, userId: actor.id, joinedAt: now, lastReadAt: now },
    update: { lastReadAt: now },
  });
  // Read state is personal UI state (like the bell), so it isn't written to the activity stream.
  await db.notification.updateMany({ where: { userId: actor.id, kind: { in: ["message.new", "message.group_added"] }, readAt: null, href: `/messages/${conversationId}` }, data: { readAt: now } });
  return { unreadConversations: await countUnreadConversations(actor.id) };
}

// ─── Writing messages ────────────────────────────────────────────────────────

const Body = z
  .string({ error: "Write a message first." })
  .max(20_000, "That message is too long.")
  .transform(normalizeMessageBody)
  .superRefine((v, ctx) => {
    const problem = messageBodyProblem(v);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

/** DM and group members who have nothing unread here yet — one ping per conversation until they read it. */
async function quietRecipients(conversationId: string, actorId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ userId: string }[]>`
    SELECT cm."userId" FROM "ConversationMember" cm JOIN "User" u ON u.id = cm."userId"
     WHERE cm."conversationId" = ${conversationId} AND cm."userId" <> ${actorId} AND u.status <> 'DEACTIVATED'
       AND NOT EXISTS (
         SELECT 1 FROM "Message" m
          WHERE m."conversationId" = cm."conversationId" AND m."authorId" <> cm."userId" AND m."deletedAt" IS NULL
            AND m."createdAt" > COALESCE(cm."lastReadAt", cm."joinedAt"))`;
  return rows.map((r) => r.userId);
}

export async function sendMessage(actor: Actor | null, conversationId: string, body: unknown): Promise<MessageView> {
  assertSignedIn(actor);
  const text = parse(Body, body);
  const access = await requireReadable(actor, conversationId);
  if (!access.canSend) throw forbidden(access.readOnlyReason ?? "You can't send messages here.");
  const { convo } = access;

  const recipients = convo.type === "CLUB" ? [] : await quietRecipients(conversationId, actor.id);
  const now = new Date();
  const message = await db.$transaction(async (tx) => {
    const m = await tx.message.create({ data: { conversationId, authorId: actor.id, body: text, createdAt: now }, select: messageSelect });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
    await tx.conversationMember.upsert({
      where: { conversationId_userId: { conversationId, userId: actor.id } },
      create: { conversationId, userId: actor.id, joinedAt: now, lastReadAt: now },
      update: { lastReadAt: now },
    });
    // No message text in the activity stream; it only records that a message was sent.
    await logActivity({ actorId: actor.id, action: "message.sent", entityType: "message", entityId: m.id, data: { conversationId, type: convo.type } }, tx);
    return m;
  });

  // Club chats are busy, so they show up as unread counts instead of notifications.
  if (recipients.length) {
    await notify({
      userIds: recipients,
      kind: "message.new",
      title: convo.type === "DIRECT" ? `${actor.name} sent you a message` : `${actor.name} in ${convo.title || "your leader group"}`,
      body: previewText(text, 140),
      href: `/messages/${conversationId}`,
      exceptUserId: actor.id,
    });
  }
  if (convo.type === "CLUB") later(() => mirrorNewMessage(message.id));
  return toView(message);
}

export async function editMessage(actor: Actor | null, messageId: string, body: unknown): Promise<MessageView> {
  assertSignedIn(actor);
  const text = parse(Body, body);
  const m = await db.message.findUnique({ where: { id: messageId }, select: { id: true, authorId: true, conversationId: true, body: true, deletedAt: true, conversation: { select: { type: true } } } });
  if (!m || m.authorId !== actor.id) throw notFound("Message");
  const access = await requireReadable(actor, m.conversationId);
  if (m.deletedAt) throw invalid("That message was deleted.");
  if (!access.canSend) throw forbidden(access.readOnlyReason ?? "You can't edit messages here.");
  if (m.body === text) {
    const same = await db.message.findUniqueOrThrow({ where: { id: m.id }, select: messageSelect });
    return toView(same);
  }
  const updated = await db.message.update({ where: { id: m.id }, data: { body: text, editedAt: new Date() }, select: messageSelect });
  await logActivity({ actorId: actor.id, action: "message.edited", entityType: "message", entityId: m.id, data: { conversationId: m.conversationId } });
  if (m.conversation.type === "CLUB") later(() => mirrorEditedMessage(m.id));
  return toView(updated);
}

/** Deletes your own message: it stays in place as "Message deleted" and its text is erased. */
export async function deleteMessage(actor: Actor | null, messageId: string): Promise<MessageView> {
  assertSignedIn(actor);
  const m = await db.message.findUnique({ where: { id: messageId }, select: { id: true, authorId: true, conversationId: true, deletedAt: true, conversation: { select: { type: true } } } });
  if (!m || m.authorId !== actor.id) throw notFound("Message");
  await requireReadable(actor, m.conversationId);
  if (m.deletedAt) return toView(await db.message.findUniqueOrThrow({ where: { id: m.id }, select: messageSelect }));
  // The Google Chat copy is found by our message id, so it can still be removed after the text is erased.
  const deleted = await db.message.update({ where: { id: m.id }, data: { deletedAt: new Date(), body: "" }, select: messageSelect });
  await logActivity({ actorId: actor.id, action: "message.deleted", entityType: "message", entityId: m.id, data: { conversationId: m.conversationId } });
  if (m.conversation.type === "CLUB") later(() => mirrorDeletedMessage(m.id));
  return toView(deleted);
}

// ─── Starting conversations ──────────────────────────────────────────────────

/** Opens your DM with someone (reusing the existing one), if the messaging rules allow it. */
export async function startDirectConversation(actor: Actor | null, userId: string): Promise<{ id: string }> {
  assertSignedIn(actor);
  if (actor.status !== "ACTIVE") throw forbidden("Alumni accounts can't start new conversations.");
  const targetId = parse(z.string().min(1).max(64), userId);
  if (targetId === actor.id) throw invalid("You can't send a message to yourself.");
  const target = await db.user.findUnique({ where: { id: targetId }, select: { id: true, name: true, status: true, platformRole: true } });
  if (!target || target.status === "DEACTIVATED") throw notFound("Person");

  const existing = await db.conversation.findFirst({
    where: { type: "DIRECT", AND: [{ members: { some: { userId: actor.id } } }, { members: { some: { userId: target.id } } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing;

  const reach = await reachMany([actor, target]);
  const actorReach = reach.get(actor.id)!;
  if (!pairRule(actorReach, reach.get(target.id)!)) {
    if (target.status === "ALUMNI") throw forbidden(`${firstName(target.name)} has graduated, so you can't start a new conversation with them.`);
    throw forbidden(
      actorReach.leader
        ? `You can message people in your clubs and the leaders of any club. ${target.name} isn't either.`
        : `You can message people who are in one of your clubs. ${target.name} isn't in any of them.`,
    );
  }

  const pair = [actor.id, target.id].sort().join(":");
  const id = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dm:${pair}`}))`;
    const again = await tx.conversation.findFirst({
      where: { type: "DIRECT", AND: [{ members: { some: { userId: actor.id } } }, { members: { some: { userId: target.id } } }] },
      select: { id: true },
    });
    if (again) return again.id;
    const now = new Date();
    const created = await tx.conversation.create({
      data: {
        type: "DIRECT",
        createdAt: now,
        lastMessageAt: now,
        // The starter's read marker is set, so the empty DM shows only for them until they write.
        members: { create: [{ userId: actor.id, joinedAt: now, lastReadAt: now }, { userId: target.id, joinedAt: now }] },
      },
      select: { id: true },
    });
    await logActivity({ actorId: actor.id, action: "conversation.created", entityType: "conversation", entityId: created.id, data: { type: "DIRECT" } }, tx);
    return created.id;
  });
  return { id };
}

const GroupTitle = z
  .string({ error: "Name the group." })
  .trim()
  .min(1, "Name the group.")
  .max(GROUP_TITLE_MAX_LENGTH, `Group names can be up to ${GROUP_TITLE_MAX_LENGTH} characters.`);
const MemberIds = z.array(z.string().min(1).max(64)).max(GROUP_MAX_MEMBERS, `A group can have up to ${GROUP_MAX_MEMBERS} people.`);

/** Checks that everyone can be in a leader group; names the ones who can't. */
async function assertLeaders(userIds: string[]): Promise<{ id: string; name: string }[]> {
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, status: true, platformRole: true } });
  if (users.length !== userIds.length) throw invalid("Someone you picked doesn't have an account anymore. Search for them again.");
  const reach = await reachMany(users);
  const not = users.filter((u) => !canLeadGroups(reach.get(u.id)!));
  if (not.length) {
    const names = not.map((u) => u.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    throw invalid(`${list} ${names.length > 1 ? "aren't current club leaders" : "isn't a current club leader"}. Leader groups are for presidents, VPs, officers, ambassadors and advisors.`);
  }
  return users;
}

/** Starts a named leader group. Only leaders (and admins) can, and everyone in it must be a leader. */
export async function createLeadersGroup(actor: Actor | null, input: unknown): Promise<{ id: string }> {
  assertSignedIn(actor);
  const { title, memberIds } = parse(z.object({ title: GroupTitle, memberIds: MemberIds }), input);
  if (!canLeadGroups(await reachOf(actor))) throw forbidden("Only club leaders and advisors can start leader groups.");
  const ids = [...new Set(memberIds)].filter((id) => id !== actor.id);
  if (!ids.length) throw invalid("Add at least one other leader.");
  if (ids.length + 1 > GROUP_MAX_MEMBERS) throw invalid(`A group can have up to ${GROUP_MAX_MEMBERS} people.`);
  await assertLeaders(ids);

  const now = new Date();
  const created = await db.$transaction(async (tx) => {
    const c = await tx.conversation.create({
      data: {
        type: "LEADERS_GROUP",
        title,
        createdAt: now,
        lastMessageAt: now,
        members: { create: [{ userId: actor.id, joinedAt: now, lastReadAt: now }, ...ids.map((userId) => ({ userId, joinedAt: now }))] },
      },
      select: { id: true },
    });
    await logActivity({ actorId: actor.id, action: "conversation.created", entityType: "conversation", entityId: c.id, data: { type: "LEADERS_GROUP", members: ids.length + 1 } }, tx);
    return c;
  });
  await notify({
    userIds: ids,
    kind: "message.group_added",
    title: `${actor.name} added you to “${title}”`,
    body: "A leader group in Wildcat Clubs Messages.",
    href: `/messages/${created.id}`,
    exceptUserId: actor.id,
  });
  return created;
}

async function requireGroupManager(actor: Actor, conversationId: string): Promise<ConversationAccess> {
  const access = await requireReadable(actor, conversationId);
  if (access.convo.type !== "LEADERS_GROUP") throw invalid("Only leader groups can be changed.");
  if (!access.canSend) throw forbidden(access.readOnlyReason ?? "Only current club leaders can change this group.");
  return access;
}

/** Adds leaders to a leader group. Any current leader in the group can. */
export async function addGroupMembers(actor: Actor | null, conversationId: string, memberIds: unknown): Promise<{ added: number }> {
  assertSignedIn(actor);
  const ids = [...new Set(parse(MemberIds.min(1, "Pick at least one leader to add."), memberIds))];
  const access = await requireGroupManager(actor, conversationId);
  const existing = new Set((await db.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })).map((m) => m.userId));
  const fresh = ids.filter((id) => !existing.has(id));
  if (!fresh.length) return { added: 0 };
  if (existing.size + fresh.length > GROUP_MAX_MEMBERS) throw invalid(`A group can have up to ${GROUP_MAX_MEMBERS} people.`);
  await assertLeaders(fresh);
  const now = new Date();
  await db.conversationMember.createMany({ data: fresh.map((userId) => ({ conversationId, userId, joinedAt: now })), skipDuplicates: true });
  await logActivity({ actorId: actor.id, action: "conversation.members_added", entityType: "conversation", entityId: conversationId, data: { added: fresh.length } });
  await notify({
    userIds: fresh,
    kind: "message.group_added",
    title: `${actor.name} added you to “${access.convo.title || "a leader group"}”`,
    body: "A leader group in Wildcat Clubs Messages.",
    href: `/messages/${conversationId}`,
    exceptUserId: actor.id,
  });
  return { added: fresh.length };
}

export async function renameLeadersGroup(actor: Actor | null, conversationId: string, title: unknown): Promise<{ title: string }> {
  assertSignedIn(actor);
  const name = parse(GroupTitle, title);
  const access = await requireGroupManager(actor, conversationId);
  if (access.convo.title === name) return { title: name };
  await db.conversation.update({ where: { id: conversationId }, data: { title: name } });
  await logActivity({ actorId: actor.id, action: "conversation.renamed", entityType: "conversation", entityId: conversationId, data: { title: name } });
  return { title: name };
}

/** Leaves a leader group. Your messages stay; the group disappears from your list. */
export async function leaveLeadersGroup(actor: Actor | null, conversationId: string): Promise<void> {
  assertSignedIn(actor);
  const access = await requireReadable(actor, conversationId);
  if (access.convo.type !== "LEADERS_GROUP") throw invalid("You can only leave leader groups. Club chats follow your club membership.");
  await db.conversationMember.delete({ where: { conversationId_userId: { conversationId, userId: actor.id } } });
  await logActivity({ actorId: actor.id, action: "conversation.left", entityType: "conversation", entityId: conversationId });
}

// ─── Finding people ──────────────────────────────────────────────────────────

const SearchInput = z.object({
  q: z.string().max(80).default(""),
  scope: z.enum(["dm", "leaders"]).default("dm"),
  /** For "add leaders": people already in this group are left out. */
  conversationId: z.string().max(64).nullish(),
});

/**
 * People you're allowed to message (scope "dm") or put in a leader group
 * (scope "leaders"), matching a name, handle or email. Applies the same rules
 * as sending, so everyone listed can actually be reached.
 */
export async function searchPeople(actor: Actor | null, input: unknown): Promise<PersonResult[]> {
  assertSignedIn(actor);
  const { q, scope, conversationId } = parse(SearchInput, input);
  const term = q.trim().replace(/\s+/g, " ");
  if (term.length < 2 || actor.status !== "ACTIVE") return [];
  const actorReach = await reachOf(actor);

  let exclude: string[] = [actor.id];
  const reachable: Prisma.UserWhereInput[] = [];
  if (scope === "leaders") {
    if (!canLeadGroups(actorReach)) throw forbidden("Only club leaders and advisors can start leader groups.");
    if (conversationId) {
      await requireGroupManager(actor, conversationId);
      exclude = exclude.concat((await db.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })).map((m) => m.userId));
    }
    reachable.push({ roleAssignments: { some: leaderRoleWhere } }, { platformRole: { in: ["ADMIN", "SYSADMIN"] } });
  } else {
    const clubs = [...actorReach.clubs];
    if (clubs.length) {
      reachable.push({ memberships: { some: { status: "ACTIVE", clubId: { in: clubs } } } }, { roleAssignments: { some: { endedAt: null, clubId: { in: clubs } } } });
    }
    if (actorReach.leader || actorReach.admin) reachable.push({ roleAssignments: { some: leaderRoleWhere } });
    if (actorReach.leader) reachable.push({ platformRole: { in: ["ADMIN", "SYSADMIN"] } });
  }
  if (!reachable.length) return [];

  const words = term.split(" ").slice(0, 4);
  const users = await db.user.findMany({
    where: {
      id: { notIn: exclude },
      status: "ACTIVE",
      AND: [
        { OR: reachable },
        // Every word must match somewhere, so "maya chen" finds Maya Chen.
        ...words.map((w) => ({ OR: [{ name: { contains: w, mode: "insensitive" as const } }, { handle: { contains: w, mode: "insensitive" as const } }, { email: { startsWith: w, mode: "insensitive" as const } }] })),
      ],
    },
    orderBy: { name: "asc" },
    take: 20,
    select: { ...personSelect, status: true, platformRole: true },
  });
  if (!users.length) return [];

  const ids = users.map((u) => u.id);
  const [reach, labels, dms] = await Promise.all([
    reachMany(users),
    leaderLabels(ids),
    db.conversation.findMany({
      where: { type: "DIRECT", AND: [{ members: { some: { userId: actor.id } } }, { members: { some: { userId: { in: ids } } } }] },
      select: { id: true, members: { where: { userId: { not: actor.id } }, select: { userId: true } } },
    }),
  ]);
  const sharedClubIds = new Set(users.flatMap((u) => [...(reach.get(u.id)?.clubs ?? [])].filter((c) => actorReach.clubs.has(c))));
  const clubNames = new Map((await db.club.findMany({ where: { id: { in: [...sharedClubIds] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const dmWith = new Map<string, string>();
  for (const c of dms) for (const m of c.members) if (!dmWith.has(m.userId)) dmWith.set(m.userId, c.id);

  return users
    .filter((u) => (scope === "leaders" ? canLeadGroups(reach.get(u.id)!) : pairRule(actorReach, reach.get(u.id)!) !== null))
    .map(({ status: _s, platformRole, ...u }) => {
      const shared = [...(reach.get(u.id)?.clubs ?? [])].filter((c) => actorReach.clubs.has(c)).map((c) => clubNames.get(c) ?? "").filter(Boolean).sort();
      const context =
        scope === "dm" && shared.length
          ? shared.length > 2
            ? `${shared[0]}, ${shared[1]} +${shared.length - 2}`
            : shared.join(" · ")
          : (labels.get(u.id) ?? (platformRole !== "USER" ? adminLabel(platformRole) : null));
      return { ...u, context, conversationId: dmWith.get(u.id) ?? null };
    });
}
