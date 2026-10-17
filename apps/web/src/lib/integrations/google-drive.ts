import "server-only";
import { Readable } from "node:stream";
import { after } from "next/server";
import type { drive_v3 } from "@googleapis/drive";
import type { FileVisibility } from "@prisma/client";
import { db } from "@/lib/db";
import { integrationLive } from "@/lib/config";
import { googleJwt } from "@/lib/integrations/google";
import { getBytes } from "@/lib/files/storage";
import { resolveVisibility, TOP_LEVEL_DEFAULT } from "@/lib/files/visibility";
import type { Vis } from "@/lib/files/types";

/**
 * Google Drive mirror for Club Files. The platform's own storage
 * (lib/files/storage + FileItem) is the source of truth; when a sysadmin turns
 * on "Google Drive" sync, each club's files are copied into a folder in the
 * club's own Workspace account (Club.contactEmail), so leaders can also open
 * them from Drive. With sync off — or a club without a Google account — every
 * call is a no-op. Personal and university files stay on the platform only.
 *
 * What is mirrored: uploads and new folders (FileItem.driveFileId records the
 * copy; Club.googleDriveFolderId the club's top folder), renames, moves,
 * trash / restore and permanent deletes.
 *
 * Timing: the work runs after the response is sent (next/server `after`), one
 * club at a time and in order, so nobody waits on Google and an upload is
 * copied before a rename of it is. Outside a request (scripts) it runs inline.
 * Failures are logged, never thrown; the next catch-up (when Club Files
 * opens) copies anything that was missed.
 *
 * Sharing, where Drive can express it without leaking anything:
 *   - The club's Drive folder is shared with the club's current leaders as editors.
 *   - Files whose effective visibility is PUBLIC get an "anyone with the link"
 *     reader permission; it is removed when they stop being public. Folders never
 *     get one, because Drive passes a folder's access down to everything inside,
 *     including items the club made more private.
 *   - People added under "Share & permissions" get reader or writer access on that
 *     item (on a folder, Drive extends it to the contents, as the platform does).
 *   - MEMBERS and LEADERS items are not shared member by member: members open
 *     them through the platform, which checks canViewFile on every request.
 *
 * Workspace setup (once, by WSU's Google Workspace admin):
 *   1. Create a service account and put its key JSON in GOOGLE_SERVICE_ACCOUNT_JSON.
 *   2. Admin console → Security → API controls → Domain-wide delegation → add the
 *      service account's client ID with this OAuth scope:
 *        https://www.googleapis.com/auth/drive.file
 *      (create and manage only the files and folders this app makes in each
 *      club account's Drive — including sharing them; it can't read anything
 *      else in those accounts.)
 *   3. Turn on Google Drive sync in System settings, and give each club a
 *      Google account email in its Settings.
 */

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveSyncResult = { status: "queued" | "synced" | "off" | "skipped" | "failed"; message?: string };

type ClubRow = { id: string; name: string; contactEmail: string; googleDriveFolderId: string | null };

export type DriveState = "live" | "off" | "needs-account" | "not-club";

/** Whether this club's files mirror to Drive right now (for the explorer's status line). */
export async function driveReady(clubId: string | null): Promise<{ live: boolean; state: DriveState; account: string | null; reason?: string }> {
  if (!clubId) return { live: false, state: "not-club", account: null, reason: "Only club files are copied to Google Drive." };
  if (!(await integrationLive("googleDrive"))) return { live: false, state: "off", account: null, reason: "Google Drive sync is off." };
  const club = await db.club.findUnique({ where: { id: clubId }, select: { contactEmail: true } });
  if (!club?.contactEmail) return { live: false, state: "needs-account", account: null, reason: "Add the club's Google account email in Settings to copy its files to Drive." };
  return { live: true, state: "live", account: club.contactEmail };
}

/** Loaded on first use, so mock mode never pulls in the Google client. */
async function client(subject: string): Promise<drive_v3.Drive> {
  const { drive } = await import("@googleapis/drive");
  return drive({ version: "v3", auth: googleJwt(subject, SCOPES) });
}

async function liveClub(clubId: string): Promise<ClubRow | null> {
  const club = await db.club.findUnique({ where: { id: clubId }, select: { id: true, name: true, contactEmail: true, googleDriveFolderId: true } });
  return club?.contactEmail ? { ...club, contactEmail: club.contactEmail } : null;
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function httpStatus(e: unknown): number | undefined {
  const s = (e as { code?: unknown; response?: { status?: number } })?.response?.status ?? (e as { code?: unknown })?.code;
  return typeof s === "number" ? s : undefined;
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

const queues = new Map<string, Promise<unknown>>();

/** Runs one club's Drive work in order (per server process). */
function enqueue<T>(clubId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(clubId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(clubId, next);
  void next
    .catch(() => undefined)
    .finally(() => {
      if (queues.get(clubId) === next) queues.delete(clubId);
    });
  return next;
}

type Work = (d: drive_v3.Drive, club: ClubRow, ctx: Ctx) => Promise<void>;

async function schedule(clubId: string | null, label: string, work: Work): Promise<DriveSyncResult> {
  if (!clubId) return { status: "off" };
  if (!(await integrationLive("googleDrive"))) return { status: "off" };
  const run = () =>
    enqueue(clubId, async (): Promise<DriveSyncResult> => {
      try {
        const club = await liveClub(clubId);
        if (!club) return { status: "off" };
        await work(await client(club.contactEmail), club, new Ctx(club.id));
        return { status: "synced" };
      } catch (e) {
        console.error(`[drive] ${label} failed:`, errorText(e));
        return { status: "failed", message: errorText(e) };
      }
    });
  try {
    after(run);
    return { status: "queued" };
  } catch {
    // Not inside a request (a script or test): do it now.
    return run();
  }
}

// ─── Items ───────────────────────────────────────────────────────────────────

type ItemRow = {
  id: string;
  clubId: string | null;
  parentId: string | null;
  isFolder: boolean;
  name: string;
  mimeType: string | null;
  storageKey: string | null;
  driveFileId: string | null;
  visibility: FileVisibility;
  trashedAt: Date | null;
};

const ITEM_SELECT = { id: true, clubId: true, parentId: true, isFolder: true, name: true, mimeType: true, storageKey: true, driveFileId: true, visibility: true, trashedAt: true } as const;

/** Per-run lookups: the club's folders (for effective visibility) and its leaders' emails. */
class Ctx {
  private folders: Map<string, { parentId: string | null; visibility: FileVisibility }> | null = null;
  private memo = new Map<string, Vis>();
  private leaders: Set<string> | null = null;
  constructor(private clubId: string) {}

  async effective(item: Pick<ItemRow, "parentId" | "visibility">): Promise<Vis> {
    if (item.visibility !== "INHERIT") return item.visibility;
    if (!item.parentId) return TOP_LEVEL_DEFAULT;
    if (!this.folders) {
      const rows = await db.fileItem.findMany({ where: { clubId: this.clubId, isFolder: true }, select: { id: true, parentId: true, visibility: true } });
      this.folders = new Map(rows.map((r) => [r.id, r]));
    }
    const folders = this.folders;
    return resolveVisibility(item.parentId, (id) => folders.get(id), this.memo);
  }

  async leaderEmails(): Promise<Set<string>> {
    if (!this.leaders) this.leaders = await leaderEmails(this.clubId);
    return this.leaders;
  }
}

/** Finds or creates the club's top folder in its Workspace Drive. */
async function rootFolder(d: drive_v3.Drive, club: ClubRow, ctx: Ctx): Promise<string> {
  if (club.googleDriveFolderId) return club.googleDriveFolderId;
  const created = await d.files.create({
    requestBody: {
      name: `${club.name} (Wildcat Clubs)`,
      mimeType: FOLDER_MIME,
      description: "Kept in sync by Wildcat Clubs. Make changes in Club Files on the platform so everyone sees them.",
    },
    fields: "id",
  });
  const id = created.data.id!;
  // Mirror bookkeeping only (not user data), so the adapter records it itself, like the Calendar and Chat adapters.
  await db.club.update({ where: { id: club.id }, data: { googleDriveFolderId: id } });
  club.googleDriveFolderId = id;
  await shareRootWithLeaders(d, club, ctx).catch((e) => console.error("[drive] sharing the club folder failed:", errorText(e)));
  return id;
}

/** The Drive folder an item belongs in, copying the folders above it first. */
async function parentDriveId(d: drive_v3.Drive, club: ClubRow, ctx: Ctx, parentId: string | null, depth: number): Promise<string> {
  if (!parentId || depth > 32) return rootFolder(d, club, ctx);
  const parent = await db.fileItem.findUnique({ where: { id: parentId }, select: ITEM_SELECT });
  if (!parent || parent.clubId !== club.id) return rootFolder(d, club, ctx);
  return parent.driveFileId ?? (await createRemote(d, club, ctx, parent, depth + 1));
}

async function createRemote(d: drive_v3.Drive, club: ClubRow, ctx: Ctx, item: ItemRow, depth = 0): Promise<string> {
  const parent = await parentDriveId(d, club, ctx, item.parentId, depth);
  let id: string;
  if (item.isFolder) {
    const res = await d.files.create({ requestBody: { name: item.name, mimeType: FOLDER_MIME, parents: [parent] }, fields: "id" });
    id = res.data.id!;
  } else {
    if (!item.storageKey) throw new Error(`“${item.name}” has no stored bytes to copy.`);
    const bytes = await getBytes(item.storageKey);
    const mimeType = item.mimeType ?? "application/octet-stream";
    const res = await d.files.create({
      requestBody: { name: item.name, mimeType, parents: [parent] },
      media: { mimeType, body: Readable.from(bytes) },
      fields: "id",
    });
    id = res.data.id!;
  }
  await db.fileItem.update({ where: { id: item.id }, data: { driveFileId: id } });
  item.driveFileId = id;
  await syncPermissions(d, ctx, item).catch((e) => console.error("[drive] sharing failed:", errorText(e)));
  if (item.trashedAt) await d.files.update({ fileId: id, requestBody: { trashed: true } });
  return id;
}

async function load(ids: string[]): Promise<ItemRow[]> {
  if (ids.length === 0) return [];
  return db.fileItem.findMany({ where: { id: { in: ids } }, select: ITEM_SELECT });
}

/** Moves an existing Drive copy under the right folder. */
async function placeRemote(d: drive_v3.Drive, club: ClubRow, ctx: Ctx, item: ItemRow) {
  if (!item.driveFileId) return;
  const target = await parentDriveId(d, club, ctx, item.parentId, 0);
  const current = await d.files.get({ fileId: item.driveFileId, fields: "parents" });
  const removeParents = (current.data.parents ?? []).filter((p) => p !== target).join(",");
  await d.files.update({ fileId: item.driveFileId, addParents: target, removeParents: removeParents || undefined, requestBody: { name: item.name }, fields: "id" });
}

// ─── Public mirror calls (all scheduled; none throw) ─────────────────────────

/** Copies new uploads or folders to Drive. */
export function mirrorCreated(clubId: string | null, fileIds: string[]): Promise<DriveSyncResult> {
  return schedule(clubId, "copy", async (d, club, ctx) => {
    for (const item of await load(fileIds)) {
      const fresh = await db.fileItem.findUnique({ where: { id: item.id }, select: { driveFileId: true } });
      if (!fresh?.driveFileId) await createRemote(d, club, ctx, item);
    }
  });
}

/** Renames the Drive copy. */
export function mirrorRenamed(clubId: string | null, fileId: string): Promise<DriveSyncResult> {
  return schedule(clubId, "rename", async (d, club, ctx) => {
    const [item] = await load([fileId]);
    if (!item) return;
    if (!item.driveFileId) await createRemote(d, club, ctx, item);
    else await d.files.update({ fileId: item.driveFileId, requestBody: { name: item.name } });
  });
}

/** Moves Drive copies to match their new folders, then re-applies sharing (a move can change who may see them). */
export function mirrorMoved(clubId: string | null, fileIds: string[]): Promise<DriveSyncResult> {
  return schedule(clubId, "move", async (d, club, ctx) => {
    for (const item of await load(fileIds)) {
      if (!item.driveFileId) {
        await createRemote(d, club, ctx, item);
        continue;
      }
      await placeRemote(d, club, ctx, item);
      await syncSubtree(d, ctx, club.id, item);
    }
  });
}

/** Trashes Drive copies. Only top-level items are sent; Drive trashes what's inside a folder with it. */
export function mirrorTrashed(clubId: string | null, fileIds: string[]): Promise<DriveSyncResult> {
  return schedule(clubId, "trash", async (d) => {
    for (const item of await load(fileIds)) {
      if (item.driveFileId) await d.files.update({ fileId: item.driveFileId, requestBody: { trashed: true } });
    }
  });
}

/** Restores Drive copies (a restore can land in a different folder or under a new name). */
export function mirrorRestored(clubId: string | null, fileIds: string[]): Promise<DriveSyncResult> {
  return schedule(clubId, "restore", async (d, club, ctx) => {
    for (const item of await load(fileIds)) {
      if (!item.driveFileId) {
        await createRemote(d, club, ctx, item);
        continue;
      }
      await d.files.update({ fileId: item.driveFileId, requestBody: { trashed: false } });
      await placeRemote(d, club, ctx, item);
      await syncSubtree(d, ctx, club.id, item);
    }
  });
}

/** Deletes Drive copies for good (the rows are already gone, so the caller passes the Drive ids). */
export function mirrorDeleted(clubId: string | null, driveFileIds: string[]): Promise<DriveSyncResult> {
  const ids = driveFileIds.filter(Boolean);
  if (ids.length === 0) return Promise.resolve({ status: "skipped" });
  return schedule(clubId, "delete", async (d) => {
    for (const id of ids) {
      await d.files.delete({ fileId: id }).catch((e: unknown) => {
        // Already gone: deleting a folder takes its contents along.
        if (httpStatus(e) !== 404) throw e;
      });
    }
  });
}

/** Re-applies sharing after a visibility change or a grant (for a folder, to everything inside it too). */
export function mirrorSharing(clubId: string | null, fileId: string): Promise<DriveSyncResult> {
  return schedule(clubId, "sharing", async (d, club, ctx) => {
    const [item] = await load([fileId]);
    if (!item || item.trashedAt) return;
    if (!item.driveFileId) await createRemote(d, club, ctx, item);
    else await syncSubtree(d, ctx, club.id, item);
  });
}

/**
 * Catches up a club's Drive copy: items made before sync was turned on, or by
 * tools that store club files directly (constitution PDFs, profile documents),
 * or a copy that failed earlier. Folders go first so files land inside them.
 * Runs when Club Files opens; a small batch each time keeps it light.
 */
export function backfillClubDrive(clubId: string, limit = 20): Promise<DriveSyncResult> {
  return schedule(clubId, "catch-up", async (d, club, ctx) => {
    await rootFolder(d, club, ctx);
    await shareRootWithLeaders(d, club, ctx).catch((e) => console.error("[drive] sharing the club folder failed:", errorText(e)));
    const pending = await db.fileItem.findMany({
      where: { clubId, driveFileId: null, trashedAt: null },
      orderBy: [{ isFolder: "desc" }, { createdAt: "asc" }],
      take: limit,
      select: ITEM_SELECT,
    });
    for (const item of pending) {
      // An earlier item in this batch may have copied this one as a parent.
      const fresh = await db.fileItem.findUnique({ where: { id: item.id }, select: { driveFileId: true } });
      if (!fresh?.driveFileId) await createRemote(d, club, ctx, item);
    }
  });
}

// ─── Sharing ─────────────────────────────────────────────────────────────────

async function listPermissions(d: drive_v3.Drive, fileId: string) {
  const res = await d.permissions.list({ fileId, fields: "permissions(id,type,role,emailAddress)" });
  return res.data.permissions ?? [];
}

/** The item and every copied item inside it (one query for the club, then a walk). */
async function syncSubtree(d: drive_v3.Drive, ctx: Ctx, clubId: string, top: ItemRow) {
  await syncPermissions(d, ctx, top);
  if (!top.isFolder) return;
  const rows = await db.fileItem.findMany({ where: { clubId, trashedAt: null }, select: ITEM_SELECT });
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  for (const r of rows) {
    if (r.id === top.id || !r.driveFileId) continue;
    let current = r.parentId;
    for (let depth = 0; current && depth < 64; depth++) {
      if (current === top.id) {
        await syncPermissions(d, ctx, r);
        break;
      }
      current = parentOf.get(current) ?? null;
    }
  }
}

async function syncPermissions(d: drive_v3.Drive, ctx: Ctx, item: ItemRow) {
  if (!item.driveFileId) return;
  const [perms, grants, leaders, effective] = await Promise.all([
    listPermissions(d, item.driveFileId),
    db.fileGrant.findMany({ where: { fileId: item.id }, select: { canEdit: true, user: { select: { email: true } } } }),
    ctx.leaderEmails(),
    ctx.effective(item),
  ]);
  const anyone = perms.find((p) => p.type === "anyone");
  const wantAnyone = !item.isFolder && effective === "PUBLIC";
  if (wantAnyone && !anyone) {
    await d.permissions.create({ fileId: item.driveFileId, requestBody: { type: "anyone", role: "reader" } });
  } else if (!wantAnyone && anyone?.id) {
    await d.permissions.delete({ fileId: item.driveFileId, permissionId: anyone.id });
  }
  const wanted = new Map(grants.map((g) => [g.user.email.toLowerCase(), g.canEdit ? "writer" : "reader"]));
  for (const p of perms) {
    if (p.type !== "user" || p.role === "owner" || !p.emailAddress || !p.id) continue;
    const email = p.emailAddress.toLowerCase();
    const role = wanted.get(email);
    if (!role) {
      // Leaders reach everything through the club folder; leave their access alone.
      if (leaders.has(email)) continue;
      await d.permissions.delete({ fileId: item.driveFileId, permissionId: p.id }).catch(() => undefined);
    } else if (role !== p.role) {
      await d.permissions.update({ fileId: item.driveFileId, permissionId: p.id, requestBody: { role } });
    }
    wanted.delete(email);
  }
  for (const [email, role] of wanted) {
    await d.permissions.create({ fileId: item.driveFileId, sendNotificationEmail: false, requestBody: { type: "user", role, emailAddress: email } });
  }
}

async function leaderEmails(clubId: string): Promise<Set<string>> {
  const rows = await db.roleAssignment.findMany({
    where: { clubId, endedAt: null, role: { in: ["ADVISOR", "PRESIDENT", "VP", "OFFICER", "AMBASSADOR"] }, user: { status: "ACTIVE" } },
    select: { user: { select: { email: true } } },
  });
  return new Set(rows.map((r) => r.user.email.toLowerCase()));
}

/** The club's Drive folder is shared with whoever leads the club now (editors), so they can work in Drive too. */
async function shareRootWithLeaders(d: drive_v3.Drive, club: ClubRow, ctx: Ctx) {
  if (!club.googleDriveFolderId) return;
  const [perms, leaders] = await Promise.all([listPermissions(d, club.googleDriveFolderId), ctx.leaderEmails()]);
  const wanted = new Set(leaders);
  wanted.delete(club.contactEmail.toLowerCase());
  for (const p of perms) {
    if (p.type !== "user" || p.role === "owner" || !p.emailAddress || !p.id) continue;
    const email = p.emailAddress.toLowerCase();
    if (wanted.has(email)) wanted.delete(email);
    else await d.permissions.delete({ fileId: club.googleDriveFolderId, permissionId: p.id }).catch(() => undefined);
  }
  for (const email of wanted) {
    await d.permissions.create({ fileId: club.googleDriveFolderId, sendNotificationEmail: false, requestBody: { type: "user", role: "writer", emailAddress: email } });
  }
}
