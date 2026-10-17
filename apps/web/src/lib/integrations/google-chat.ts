import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { integrationLive } from "@/lib/config";
import { CLUB_ACCOUNT_FIELDS, clubGoogleAccount, googleJwt } from "@/lib/integrations/google";
import { PLATFORM } from "@/lib/institution";

/**
 * Google Chat mirror. Our Conversation/Message tables are the source of truth;
 * when a sysadmin turns on "Google Chat" sync, each club chat gets a Chat space
 * (created as the club's own Workspace account, Club.contactEmail, through the
 * service account — only for approved clubs whose account WSUSA verified, see
 * clubGoogleAccount) and new messages, edits and deletions are copied into it.
 * Direct messages and leader groups stay in-app only.
 *
 * Mirrored messages are posted by the club account as "*Name*: text", because
 * posting as each student would need every student added to the space. Each
 * one gets a client-assigned id ("client-<our message id>"), so edits and
 * deletions find it without a schema field.
 *
 * With sync off every call is a quick no-op. Nothing here ever throws.
 */

const SCOPES = ["https://www.googleapis.com/auth/chat.spaces", "https://www.googleapis.com/auth/chat.messages"];

export type ChatMirrorResult = { status: "synced" | "off" | "skipped" | "failed"; message?: string };

/** Whether this club's chat mirrors to Google right now (and why not). */
export async function googleChatReady(clubId: string): Promise<{ live: boolean; reason?: string }> {
  if (!(await integrationLive("googleChat"))) return { live: false, reason: "Google Chat sync is off." };
  const account = clubGoogleAccount(await db.club.findUnique({ where: { id: clubId }, select: CLUB_ACCOUNT_FIELDS }));
  return account.email ? { live: true } : { live: false, reason: account.reason };
}

/** Loaded on first use, so mock mode never pulls in the Google client. */
async function client(subject: string) {
  const { chat } = await import("@googleapis/chat");
  return chat({ version: "v1", auth: googleJwt(subject, SCOPES) });
}

function fail(what: string, e: unknown): ChatMirrorResult {
  const message = e instanceof Error ? e.message : String(e);
  console.warn(`[google-chat] ${what} failed: ${message}`);
  return { status: "failed", message };
}

/** Chat's custom message ids: "client-" + lowercase letters, digits and hyphens, 63 chars max. */
function clientMessageId(messageId: string): string | null {
  const id = `client-${messageId.toLowerCase()}`;
  return /^client-[a-z0-9-]{1,56}$/.test(id) ? id : null;
}

/** Chat text for one of our messages. Chat renders *bold*. */
function chatText(authorName: string, body: string) {
  return `*${authorName.replace(/\*/g, "")}*: ${body}`;
}

/**
 * Makes sure the club has a Chat space and that its CLUB conversation points
 * at it. Creates the space (as the club account) the first time.
 */
export async function ensureClubChatSpace(clubId: string): Promise<ChatMirrorResult & { spaceName?: string }> {
  try {
    const ready = await googleChatReady(clubId);
    if (!ready.live) return { status: (await integrationLive("googleChat")) ? "skipped" : "off", message: ready.reason };
    const club = await db.club.findUnique({ where: { id: clubId }, select: { id: true, name: true, googleChatSpaceId: true, ...CLUB_ACCOUNT_FIELDS } });
    const account = clubGoogleAccount(club);
    if (!club || !account.email) return { status: "skipped", message: account.reason };

    let spaceName = club.googleChatSpaceId;
    if (!spaceName) {
      const chat = await client(account.email);
      const res = await chat.spaces.create({
        // Stable request id: a retry after a timeout returns the same space instead of making a second one.
        // It names the account too, because Chat refuses a request id another user already used — after
        // the club changes its Google account, the new account must be able to make its own space.
        requestId: `wildcat-clubs-${club.id}-${createHash("sha256").update(account.email).digest("hex").slice(0, 16)}`,
        requestBody: {
          spaceType: "SPACE",
          displayName: club.name.slice(0, 128),
          spaceDetails: { description: `${club.name}'s club chat, copied from ${PLATFORM.name}. Post in ${PLATFORM.name} so everyone sees it.`.slice(0, 150) },
        },
      });
      spaceName = res.data.name ?? null;
      if (!spaceName) return { status: "failed", message: "Google didn't return a space name." };
      await db.club.update({ where: { id: club.id }, data: { googleChatSpaceId: spaceName } });
    }
    await db.conversation.updateMany({ where: { clubId: club.id, type: "CLUB", OR: [{ googleSpaceId: null }, { googleSpaceId: { not: spaceName } }] }, data: { googleSpaceId: spaceName } });
    return { status: "synced", spaceName };
  } catch (e) {
    return fail("creating the club space", e);
  }
}

async function loadForMirror(messageId: string) {
  return db.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      body: true,
      deletedAt: true,
      author: { select: { name: true } },
      conversation: { select: { type: true, clubId: true, googleSpaceId: true, club: { select: { googleChatSpaceId: true, ...CLUB_ACCOUNT_FIELDS } } } },
    },
  });
}

/** The account a club chat message is mirrored as, or null when that club's sync may not run. */
function mirrorAccount(m: Awaited<ReturnType<typeof loadForMirror>>): string | null {
  return m?.conversation.club ? clubGoogleAccount(m.conversation.club).email : null;
}

/** Copies a new club-chat message into the club's Chat space. */
export async function mirrorNewMessage(messageId: string): Promise<ChatMirrorResult> {
  try {
    if (!(await integrationLive("googleChat"))) return { status: "off" };
    const m = await loadForMirror(messageId);
    if (!m || m.deletedAt || m.conversation.type !== "CLUB" || !m.conversation.clubId) return { status: "skipped" };
    const space = await ensureClubChatSpace(m.conversation.clubId);
    const account = mirrorAccount(m);
    if (space.status !== "synced" || !space.spaceName || !account) return { status: space.status === "synced" ? "skipped" : space.status, message: space.message };
    const chat = await client(account);
    await chat.spaces.messages.create({
      parent: space.spaceName,
      messageId: clientMessageId(m.id) ?? undefined,
      requestId: `wc-${m.id}`,
      requestBody: { text: chatText(m.author.name, m.body) },
    });
    return { status: "synced" };
  } catch (e) {
    return fail("copying a message", e);
  }
}

/** Updates the mirrored copy after an edit. */
export async function mirrorEditedMessage(messageId: string): Promise<ChatMirrorResult> {
  try {
    if (!(await integrationLive("googleChat"))) return { status: "off" };
    const m = await loadForMirror(messageId);
    const space = m?.conversation.googleSpaceId ?? m?.conversation.club?.googleChatSpaceId;
    const id = m ? clientMessageId(m.id) : null;
    const account = mirrorAccount(m);
    if (!m || m.deletedAt || !space || !id || !account) return { status: "skipped" };
    const chat = await client(account);
    await chat.spaces.messages.patch({ name: `${space}/messages/${id}`, updateMask: "text", requestBody: { text: chatText(m.author.name, m.body) } });
    return { status: "synced" };
  } catch (e) {
    return fail("updating a message", e);
  }
}

/** Removes the mirrored copy after a delete. */
export async function mirrorDeletedMessage(messageId: string): Promise<ChatMirrorResult> {
  try {
    if (!(await integrationLive("googleChat"))) return { status: "off" };
    const m = await loadForMirror(messageId);
    const space = m?.conversation.googleSpaceId ?? m?.conversation.club?.googleChatSpaceId;
    const id = m ? clientMessageId(m.id) : null;
    const account = mirrorAccount(m);
    if (!m || !space || !id || !account) return { status: "skipped" };
    const chat = await client(account);
    await chat.spaces.messages.delete({ name: `${space}/messages/${id}` });
    return { status: "synced" };
  } catch (e) {
    return fail("deleting a message", e);
  }
}
