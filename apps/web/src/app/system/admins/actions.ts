"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { grantAdmin, grantSysadmin, revokeAdmin, revokeSysadmin } from "@/lib/domain/system";

/** Platform roles change menus and access everywhere, so refresh the whole app. */
function refresh() {
  revalidatePath("/", "layout");
}

export async function grantAdminAction(email: string) {
  const r = await act((actor) => grantAdmin(actor, { email }));
  if (r.ok) refresh();
  return r;
}

export async function revokeAdminAction(userId: string) {
  const r = await act((actor) => revokeAdmin(actor, userId));
  if (r.ok) refresh();
  return r;
}

export async function grantSysadminAction(userId: string) {
  const r = await act((actor) => grantSysadmin(actor, userId));
  if (r.ok) refresh();
  return r;
}

export async function revokeSysadminAction(userId: string) {
  const r = await act((actor) => revokeSysadmin(actor, userId));
  if (r.ok) refresh();
  return r;
}
