"use server";

import { revalidatePath } from "next/cache";
import type { FileVisibility } from "@prisma/client";
import type { Actor } from "@/lib/auth/session";
import { act } from "@/lib/domain/kit";
import * as files from "@/lib/domain/files";
import type { ScopeRef } from "@/lib/files/types";

/**
 * Club Files server actions, shared by the club explorer, My files and the
 * picker. Each one is a thin act() wrapper around lib/domain/files.
 */

/** The scope as the browser knows it; "user" always means the signed-in person's own files. */
export type ClientScope = { kind: "club"; clubId: string } | { kind: "user" } | { kind: "university" };

function toRef(actor: Actor | null, scope: ClientScope): ScopeRef {
  if (scope.kind === "user") return { kind: "user", userId: actor?.id ?? "" };
  return scope;
}

/** Featured files and the constitution show on club pages; refresh them after any club file change. */
function refreshClubPages() {
  revalidatePath("/clubs/[slug]", "page");
}

export async function createFolderAction(scope: ClientScope, parentId: string | null, name?: string) {
  const r = await act((actor) => files.createFolder(actor, { scope: toRef(actor, scope), parentId, name }));
  return r;
}

export async function renameItemAction(id: string, name: string) {
  const r = await act((actor) => files.renameItem(actor, id, name));
  if (r.ok) refreshClubPages();
  return r;
}

export async function moveItemsAction(ids: string[], targetId: string | null) {
  const r = await act((actor) => files.moveItems(actor, ids, targetId));
  if (r.ok) refreshClubPages();
  return r;
}

export async function setVisibilityAction(id: string, visibility: FileVisibility) {
  const r = await act((actor) => files.setVisibility(actor, id, visibility));
  if (r.ok) refreshClubPages();
  return r;
}

export async function setFeaturedAction(id: string, featured: boolean) {
  const r = await act((actor) => files.setFeatured(actor, id, featured));
  if (r.ok) refreshClubPages();
  return r;
}

export async function grantAccessAction(fileId: string, userId: string, canEdit: boolean) {
  return act((actor) => files.grantAccess(actor, fileId, { userId, canEdit }));
}

export async function revokeAccessAction(fileId: string, userId: string) {
  return act((actor) => files.revokeAccess(actor, fileId, userId));
}

export async function trashItemsAction(ids: string[]) {
  const r = await act((actor) => files.trashItems(actor, ids));
  if (r.ok) refreshClubPages();
  return r;
}

export async function restoreItemsAction(ids: string[]) {
  const r = await act((actor) => files.restoreItems(actor, ids));
  if (r.ok) refreshClubPages();
  return r;
}

export async function deleteForeverAction(ids: string[]) {
  return act((actor) => files.deleteForever(actor, ids));
}

export async function emptyTrashAction(scope: ClientScope) {
  return act((actor) => files.emptyTrash(actor, toRef(actor, scope)));
}

export async function sharingInfoAction(id: string) {
  return act((actor) => files.sharingInfo(actor, id));
}

export async function searchPeopleAction(fileId: string, q: string) {
  return act((actor) => files.searchPeopleToShare(actor, fileId, q));
}
