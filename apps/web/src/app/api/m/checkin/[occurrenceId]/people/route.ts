import { revalidatePath } from "next/cache";
import { mobile, mobileActor, preflight, readJson } from "../../../_lib/http";
import { checkinCandidatesView, manualCheckin } from "../../../_lib/checkin-tools";

/**
 * "Add someone" at a meeting, for leaders who can run its check-in
 * (lib/domain/attendance: Attendance in the host club; admins at university
 * events).
 *
 * GET  /api/m/checkin/[occurrenceId]/people?q= → MCheckinCandidates: the host
 *      club's members first, then any Weber State account (2+ characters).
 * POST /api/m/checkin/[occurrenceId]/people { userId } → MManualCheckinResult:
 *      checks them in as "Added by a leader" (attendance.addManual).
 */
export async function GET(req: Request, { params }: { params: Promise<{ occurrenceId: string }> }) {
  const { occurrenceId } = await params;
  const q = new URL(req.url).searchParams.get("q");
  return mobile(async () => checkinCandidatesView(await mobileActor(req), decodeURIComponent(occurrenceId), q));
}

export async function POST(req: Request, { params }: { params: Promise<{ occurrenceId: string }> }) {
  const { occurrenceId } = await params;
  return mobile(async () => {
    const r = await manualCheckin(await mobileActor(req), decodeURIComponent(occurrenceId), await readJson(req));
    // The same pages the web's manual add refreshes.
    revalidatePath("/me/involvement");
    revalidatePath("/clubs/[slug]/manage/attendance", "layout");
    return r;
  });
}

export const OPTIONS = preflight;
