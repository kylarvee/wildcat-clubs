"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as memberships from "@/lib/domain/memberships";

function refresh(slug: string) {
  revalidatePath(`/clubs/${slug}`, "layout");
}

export async function decideRequest(slug: string, membershipId: string, approve: boolean) {
  const r = await act(async (actor) => {
    await memberships.decideMembership(actor, membershipId, approve);
  });
  refresh(slug);
  return r;
}

export async function saveInternalTitle(slug: string, membershipId: string, title: string) {
  const r = await act((actor) => memberships.setInternalTitle(actor, membershipId, title));
  refresh(slug);
  return r;
}

export async function removeFromClub(slug: string, membershipId: string) {
  const r = await act((actor) => memberships.removeMember(actor, membershipId));
  refresh(slug);
  return r;
}
