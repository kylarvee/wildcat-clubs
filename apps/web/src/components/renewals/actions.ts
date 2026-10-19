"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { renewClub, type RenewClubInput } from "@/lib/domain/renewals";

/** Renew for this academic year (the workspace overview's renewal card). */
export async function renewClubAction(input: RenewClubInput) {
  const r = await act((actor) => renewClub(actor, input));
  if (r.ok) {
    revalidatePath("/clubs/[slug]/manage", "layout");
    revalidatePath(`/clubs/${r.data.slug}`);
    revalidatePath("/admin/clubs");
    revalidatePath("/admin");
    revalidatePath("/tasks");
  }
  return r;
}
