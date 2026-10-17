"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { saveRequirement, setRequirementActive, syncAllRequirementHolders } from "@/lib/domain/requirements";

/**
 * Requirement changes re-check every student leader's tasks after the
 * response is sent (new tasks, moved due dates, closed tasks), so saving stays
 * quick. The scheduled job would catch up anyway; this makes it immediate.
 */
function refresh() {
  revalidatePath("/admin/requirements", "layout");
  revalidatePath("/clubs/[slug]/manage", "layout");
  revalidatePath("/tasks");
  after(async () => {
    try {
      await syncAllRequirementHolders({ notify: "due" });
    } catch (e) {
      console.error("[requirements] re-check after a change failed", e);
    }
  });
}

export async function saveRequirementAction(id: string | null, input: unknown) {
  const r = await act((actor) => saveRequirement(actor, id, input));
  if (r.ok) refresh();
  return r;
}

export async function setRequirementActiveAction(id: string, active: boolean) {
  const r = await act((actor) => setRequirementActive(actor, id, active));
  if (r.ok) refresh();
  return r;
}
