"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { deletePolicy, savePolicy } from "@/lib/domain/policies";

/** Policies show across the app (<PolicyNotices>), so a change refreshes every page. */
function refresh() {
  revalidatePath("/", "layout");
}

export async function savePolicyAction(id: string | null, input: unknown) {
  const r = await act((actor) => savePolicy(actor, id, input));
  if (r.ok) refresh();
  return r;
}

export async function deletePolicyAction(id: string) {
  const r = await act((actor) => deletePolicy(actor, id));
  if (r.ok) refresh();
  return r;
}
