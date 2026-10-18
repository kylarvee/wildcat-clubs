"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as ambassadors from "@/lib/domain/ambassadors";

/** A request touches two workspaces (the club's org chart, the program's placements) and their inboxes. */
function refresh() {
  revalidatePath("/clubs/[slug]", "layout");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function requestAmbassadorAction(input: { clubId: string; note?: string | null }) {
  const r = await act(async (actor) => {
    await ambassadors.requestAmbassador(actor, input);
  });
  if (r.ok) refresh();
  return r;
}

export async function withdrawAmbassadorRequestAction(clubId: string) {
  const r = await act((actor) => ambassadors.withdrawAmbassadorRequest(actor, clubId));
  if (r.ok) refresh();
  return r;
}

export async function declineAmbassadorRequestAction(input: { orgId: string; clubId: string; note?: string | null }) {
  const r = await act((actor) => ambassadors.declineAmbassadorRequest(actor, input));
  if (r.ok) refresh();
  return r;
}

export async function setAmbassadorAdvisorAction(input: { orgId: string; userId: string }) {
  const r = await act(async (actor) => {
    await ambassadors.setAmbassadorAdvisor(actor, input);
  });
  if (r.ok) {
    revalidatePath("/admin/clubs");
    revalidatePath("/clubs/[slug]", "layout");
  }
  return r;
}
