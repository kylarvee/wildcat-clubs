"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { acceptAdvisorInvite, declineAdvisorInvite } from "@/lib/domain/advisors";

export async function acceptAdvisorInviteAction(token: string) {
  const r = await act((actor) => acceptAdvisorInvite(actor, token));
  if (r.ok) {
    revalidatePath("/advisor", "layout");
    revalidatePath("/clubs/[slug]/manage", "layout");
  }
  return r;
}

export async function declineAdvisorInviteAction(token: string) {
  const r = await act((actor) => declineAdvisorInvite(actor, token));
  if (r.ok) revalidatePath("/advisor", "layout");
  return r;
}
