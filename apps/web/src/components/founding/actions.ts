"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as advisors from "@/lib/domain/advisors";
import * as clubs from "@/lib/domain/clubs";
import * as cofounders from "@/lib/domain/cofounders";

/**
 * Server actions shared by the workspace overview and settings (advisor and
 * co-founder invites, submitting to WSUSA). Each returns ActionResult for toasts.
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

export async function inviteCofounderAction(input: { clubId: string; name: string; email: string }) {
  const r = await act(async (actor) => {
    const invite = await cofounders.inviteCofounder(actor, input.clubId, { name: input.name, email: input.email });
    return { id: invite.id, email: invite.email, hasAccount: Boolean(invite.inviteeId) };
  });
  if (r.ok) refreshWorkspace();
  return r;
}

export async function resendCofounderInviteAction(inviteId: string) {
  const r = await act((actor) => cofounders.resendCofounderInvite(actor, inviteId));
  if (r.ok) refreshWorkspace();
  return r;
}

export async function cancelCofounderInviteAction(inviteId: string) {
  const r = await act((actor) => cofounders.cancelCofounderInvite(actor, inviteId));
  if (r.ok) refreshWorkspace();
  return r;
}

/** "List this club as forming" (founders only, while it's being founded). */
export async function setListedAsFormingAction(clubId: string, on: boolean) {
  const r = await act((actor) => clubs.setListedAsForming(actor, { clubId, on }));
  if (r.ok) {
    refreshWorkspace();
    revalidatePath("/clubs");
    revalidatePath("/clubs/[slug]", "page");
  }
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
