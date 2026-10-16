"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { addDepartmentForClub, decideClub, reinstateClub } from "@/lib/domain/clubs";
import { decideCustomDocument } from "@/lib/domain/constitution";

function refresh() {
  revalidatePath("/admin/clubs", "layout");
  revalidatePath("/clubs/[slug]/manage", "layout");
  revalidatePath("/clubs/[slug]", "page");
  revalidatePath("/clubs");
}

export async function decideClubAction(input: { clubId: string; decision: "APPROVE" | "CHANGES" | "REJECT"; note?: string }) {
  const r = await act((actor) => decideClub(actor, input));
  if (r.ok) refresh();
  return r;
}

export async function addDepartmentAction(input: { clubId: string; name: string; collegeId: string | null }) {
  const r = await act(async (actor) => {
    const d = await addDepartmentForClub(actor, input.clubId, { name: input.name, collegeId: input.collegeId });
    return { name: d.name };
  });
  if (r.ok) refresh();
  return r;
}

export async function decideDocumentAction(input: { docId: string; approve: boolean; note?: string }) {
  const r = await act((actor) => decideCustomDocument(actor, input));
  if (r.ok) refresh();
  return r;
}

export async function reinstateClubAction(input: { clubId: string; note?: string }) {
  const r = await act((actor) => reinstateClub(actor, input));
  if (r.ok) refresh();
  return r;
}
