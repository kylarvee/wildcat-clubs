"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { acceptCofounderInvite, declineCofounderInvite } from "@/lib/domain/cofounders";

export async function acceptCofounderInviteAction(token: string) {
  const r = await act((actor) => acceptCofounderInvite(actor, token));
  if (r.ok) {
    revalidatePath("/cofounder", "layout");
    revalidatePath("/clubs/[slug]/manage", "layout");
    revalidatePath("/tasks");
  }
  return r;
}

export async function declineCofounderInviteAction(token: string) {
  const r = await act((actor) => declineCofounderInvite(actor, token));
  if (r.ok) {
    revalidatePath("/cofounder", "layout");
    revalidatePath("/tasks");
  }
  return r;
}
