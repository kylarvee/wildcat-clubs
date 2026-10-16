"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { withdrawCustomDocument } from "@/lib/domain/constitution";

export async function withdrawCustomDocumentAction(docId: string) {
  const r = await act((actor) => withdrawCustomDocument(actor, docId));
  if (r.ok) {
    revalidatePath("/clubs/[slug]/manage", "layout");
    revalidatePath("/admin/clubs", "layout");
  }
  return r;
}
