"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { removeClubDocument, updateClubProfile, type ProfileInput } from "@/lib/domain/clubs";

export async function saveProfileAction(input: ProfileInput) {
  const r = await act(async (actor) => {
    const club = await updateClubProfile(actor, input);
    return { slug: club.slug };
  });
  if (r.ok) {
    revalidatePath("/clubs/[slug]/manage", "layout");
    revalidatePath(`/clubs/${r.data.slug}`);
  }
  return r;
}

export async function removeClubDocumentAction(docId: string) {
  const r = await act((actor) => removeClubDocument(actor, docId));
  if (r.ok) revalidatePath("/clubs/[slug]/manage", "layout");
  return r;
}
