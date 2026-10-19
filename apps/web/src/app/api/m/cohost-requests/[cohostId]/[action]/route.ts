import { revalidatePath } from "next/cache";
import { mobile, mobileActor, preflight } from "../../../_lib/http";
import { decideCohostRequest, decisionAction } from "../../../_lib/tasks";
import type { MDecisionResponse } from "../../../_types";

/**
 * POST /api/m/cohost-requests/[cohostId]/approve | decline (no body) →
 * MDecisionResponse. Approve / Decline on a co-host invitation in the app's
 * Tasks: the Events Builder's call (lib/domain/events decideCohost), so the
 * invited club's events permission applies, the task closes, and the host
 * club hears the answer.
 */
export async function POST(req: Request, { params }: { params: Promise<{ cohostId: string; action: string }> }) {
  const { cohostId, action } = await params;
  return mobile(async (): Promise<MDecisionResponse> => {
    const approve = decisionAction(action);
    const r = await decideCohostRequest(await mobileActor(req), decodeURIComponent(cohostId), approve);
    // Calendars, club pages, the event page and the header's task count.
    revalidatePath("/", "layout");
    return r;
  });
}

export const OPTIONS = preflight;
