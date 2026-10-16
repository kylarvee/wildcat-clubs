"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as roles from "@/lib/domain/roles";

/** Placements change two clubs' org charts (the org's and the target's). */
function refresh() {
  revalidatePath("/clubs/[slug]", "layout");
}

export async function place(input: { orgId: string; clubId: string; userId: string }) {
  const r = await act(async (actor) => {
    await roles.placeAmbassador(actor, input);
  });
  refresh();
  return r;
}

export async function endPlacement(assignmentId: string) {
  const r = await act((actor) => roles.endPlacement(actor, assignmentId));
  refresh();
  return r;
}
