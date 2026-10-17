"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { deactivateUser, markUserCurrentByAdmin, markUserGraduatedByAdmin, reactivateUser } from "@/lib/domain/users";

/** Status changes end roles and memberships, which show across club pages too. */
function refresh(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/clubs/[slug]", "layout");
}

export async function markGraduatedAction(userId: string, graduatedOn: string | null) {
  const r = await act((actor) => markUserGraduatedByAdmin(actor, userId, { graduatedOn }));
  if (r.ok) refresh(userId);
  return r;
}

export async function markCurrentAction(userId: string) {
  const r = await act((actor) => markUserCurrentByAdmin(actor, userId));
  if (r.ok) refresh(userId);
  return r;
}

export async function deactivateAction(userId: string, reason: string) {
  const r = await act((actor) => deactivateUser(actor, userId, { reason }));
  if (r.ok) refresh(userId);
  return r;
}

export async function reactivateAction(userId: string) {
  const r = await act((actor) => reactivateUser(actor, userId));
  if (r.ok) refresh(userId);
  return r;
}
