"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as advisors from "@/lib/domain/advisors";
import * as clubs from "@/lib/domain/clubs";

/**
 * Server actions shared by the workspace overview and settings (advisor
 * invites, submitting to WSUSA). Each returns ActionResult for toasts.
 */

const refreshWorkspace = () => revalidatePath("/clubs/[slug]/manage", "layout");

export async function inviteAdvisorAction(input: { clubId: string; name: string; email: string }) {
  const r = await act(async (actor) => {
    const invite = await advisors.inviteAdvisor(actor, input.clubId, { name: input.name, email: input.email });
    return { id: invite.id, email: invite.email };
  });
  if (r.ok) refreshWorkspace();
  return r;
}

export async function resendAdvisorInviteAction(inviteId: string) {
  const r = await act((actor) => advisors.resendAdvisorInvite(actor, inviteId));
  if (r.ok) refreshWorkspace();
  return r;
}

export async function cancelAdvisorInviteAction(inviteId: string) {
  const r = await act((actor) => advisors.cancelAdvisorInvite(actor, inviteId));
  if (r.ok) refreshWorkspace();
  return r;
}

export async function submitForReviewAction(clubId: string) {
  const r = await act((actor) => clubs.submitForReview(actor, clubId));
  if (r.ok) {
    refreshWorkspace();
    revalidatePath("/admin/clubs", "layout");
  }
  return r;
}
