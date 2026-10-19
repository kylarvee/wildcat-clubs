import { revalidatePath } from "next/cache";
import { mobile, mobileActor, preflight } from "../../../_lib/http";
import { decideJoinRequest, decisionAction } from "../../../_lib/tasks";
import type { MDecisionResponse } from "../../../_types";

/**
 * POST /api/m/join-requests/[membershipId]/approve | decline (no body) →
 * MDecisionResponse. Approve / Decline on a join request in the app's Tasks:
 * the web roster's call (lib/domain/memberships decideMembership), so the
 * roster permission applies, the task closes for every leader who had it,
 * and the person hears the answer.
 */
export async function POST(req: Request, { params }: { params: Promise<{ membershipId: string; action: string }> }) {
  const { membershipId, action } = await params;
  return mobile(async (): Promise<MDecisionResponse> => {
    const approve = decisionAction(action);
    const r = await decideJoinRequest(await mobileActor(req), decodeURIComponent(membershipId), approve);
    // Rosters, club pages and the header's task count everywhere.
    revalidatePath("/", "layout");
    return r;
  });
}

export const OPTIONS = preflight;
