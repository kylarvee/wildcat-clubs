"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { createTerm, deleteTerm, updateTerm } from "@/lib/domain/system";

export type TermFormInput = { name: string; kind: string; academicYear: string; startsOn: string; endsOn: string; countsForActivity: boolean };

/** Terms drive activity, pilot periods, retention and recurring events everywhere, so refresh the whole app. */
export async function saveTermAction(id: string | null, input: TermFormInput) {
  const r = await act(async (actor) => {
    const t = id ? await updateTerm(actor, id, input) : await createTerm(actor, input);
    return { id: t.id, name: t.name };
  });
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function deleteTermAction(id: string) {
  const r = await act((actor) => deleteTerm(actor, id));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
