import "server-only";
import type { FileItem, FileVisibility } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, isAdmin } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, forbidden, invalid, notFound } from "@/lib/domain/kit";
import { guessMime, MAX_UPLOAD_BYTES, putBytes } from "@/lib/files/storage";

/**
 * Club Files — permissions and uploads. Every place that shows or links a
 * file (explorer, picker, resources, editor embeds, events, projects,
 * policies, constitutions) checks canViewFile() here.
 *
 * Visibility (INHERIT walks up to the parent; a scope root defaults to MEMBERS):
 *   Club files       PUBLIC anyone · MEMBERS club members · LEADERS officers+, advisors
 *   Personal files   PUBLIC anyone · MEMBERS any signed-in account · LEADERS owner only
 *   University files PUBLIC anyone · MEMBERS any signed-in account · LEADERS admins only
 * Admins see everything. Explicit FileGrant rows add viewers/editors.
 */

type FileLike = Pick<FileItem, "id" | "clubId" | "ownerId" | "parentId" | "visibility" | "createdById" | "trashedAt">;

export async function effectiveVisibility(file: FileLike): Promise<Exclude<FileVisibility, "INHERIT">> {
  let current: FileLike | null = file;
  for (let depth = 0; current && depth < 32; depth++) {
    if (current.visibility !== "INHERIT") return current.visibility;
    if (!current.parentId) break;
    current = await db.fileItem.findUnique({
      where: { id: current.parentId },
      select: { id: true, clubId: true, ownerId: true, parentId: true, visibility: true, createdById: true, trashedAt: true },
    });
  }
  return "MEMBERS";
}

export async function canViewFile(actor: Actor | null, file: FileLike): Promise<boolean> {
  if (isAdmin(actor)) return true;
  if (file.trashedAt) return Boolean(actor && (await canEditFile(actor, file)));
  const vis = await effectiveVisibility(file);
  if (vis === "PUBLIC") return true;
  if (!actor) return false;
  if (file.createdById === actor.id) return true;
  if (await db.fileGrant.findUnique({ where: { fileId_userId: { fileId: file.id, userId: actor.id } } })) return true;
  if (file.clubId) {
    const access = await getClubAccess(actor, file.clubId);
    if (!access) return false;
    if (vis === "MEMBERS") return access.isMember || access.isLeader;
    return access.isLeader;
  }
  if (file.ownerId) return vis === "MEMBERS" || file.ownerId === actor.id;
  return vis === "MEMBERS"; // university LEADERS = admins only (handled above)
}

export async function canEditFile(actor: Actor | null, file: Pick<FileItem, "id" | "clubId" | "ownerId">): Promise<boolean> {
  if (!actor) return false;
  if (isAdmin(actor)) return true;
  if (file.clubId) {
    const access = await getClubAccess(actor, file.clubId);
    if (access?.capabilities.has("files")) return true;
  } else if (file.ownerId) {
    if (file.ownerId === actor.id) return true;
  }
  const grant = await db.fileGrant.findUnique({ where: { fileId_userId: { fileId: file.id, userId: actor.id } } });
  return Boolean(grant?.canEdit);
}

export type UploadInput = {
  name: string;
  mimeType?: string | null;
  bytes: Buffer;
  /** "club" needs clubId; "user" = the uploader's own files; "university" = admins only. */
  scope: "club" | "user" | "university";
  clubId?: string | null;
  parentId?: string | null;
  visibility?: FileVisibility;
};

/** Upload a file into a scope. Club uploads need the `files` capability — except
 *  logo/profile uploads, which callers make with `profile` via uploadClubAsset. */
export async function uploadFile(actor: Actor | null, input: UploadInput, opts: { capability?: "files" | "profile" } = {}) {
  assertSignedIn(actor);
  if (input.bytes.length === 0) throw invalid("That file is empty.");
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw invalid("Files can be up to 25 MB.");
  let clubId: string | null = null;
  let ownerId: string | null = null;
  if (input.scope === "club") {
    if (!input.clubId) throw invalid("Missing club.");
    const access = await getClubAccess(actor, input.clubId);
    if (!access) throw notFound("Club");
    if (!access.capabilities.has(opts.capability ?? "files")) throw forbidden();
    clubId = input.clubId;
  } else if (input.scope === "user") {
    ownerId = actor.id;
  } else if (!isAdmin(actor)) {
    throw forbidden();
  }
  if (input.parentId) {
    const parent = await db.fileItem.findUnique({ where: { id: input.parentId } });
    if (!parent?.isFolder || parent.clubId !== clubId || parent.ownerId !== ownerId) throw invalid("That folder isn't in the same place.");
  }
  const storageKey = await putBytes(input.name, input.bytes);
  const file = await db.fileItem.create({
    data: {
      clubId,
      ownerId,
      parentId: input.parentId ?? null,
      name: input.name.slice(0, 200),
      mimeType: guessMime(input.name, input.mimeType),
      sizeBytes: input.bytes.length,
      storageKey,
      visibility: input.visibility ?? "INHERIT",
      createdById: actor.id,
    },
  });
  await logActivity({ actorId: actor.id, action: "file.uploaded", entityType: "file", entityId: file.id, clubId, data: { name: file.name } });
  return file;
}

export function fileUrl(id: string, download = false) {
  return `/api/files/${id}${download ? "?download=1" : ""}`;
}
