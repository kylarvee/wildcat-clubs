"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { retireClub, setAutoApproveCohosts, setClubContactEmail } from "@/lib/domain/clubs";
import { leaveClub } from "@/lib/domain/memberships";

const refresh = () => revalidatePath("/clubs/[slug]/manage", "layout");

export async function setAutoApproveCohostsAction(clubId: string, on: boolean) {
  const r = await act(async (actor) => {
    await setAutoApproveCohosts(actor, { clubId, on });
  });
  if (r.ok) refresh();
  return r;
}

export async function setContactEmailAction(clubId: string, contactEmail: string) {
  const r = await act(async (actor) => {
    const club = await setClubContactEmail(actor, { clubId, contactEmail });
    return { contactEmail: club.contactEmail };
  });
  if (r.ok) refresh();
  return r;
}

export async function leaveClubAction(clubId: string) {
  const r = await act((actor) => leaveClub(actor, clubId));
  if (r.ok) {
    refresh();
    revalidatePath("/dashboard");
  }
  return r;
}

export async function retireClubAction(clubId: string, reason: string) {
  const r = await act((actor) => retireClub(actor, { clubId, reason }));
  if (r.ok) {
    refresh();
    revalidatePath("/clubs/[slug]", "page");
    revalidatePath("/admin/clubs", "layout");
  }
  return r;
}
