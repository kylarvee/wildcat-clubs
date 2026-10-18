import { checkIn } from "@/lib/domain/attendance";
import { METHOD_LABEL } from "@/lib/attendance/rules";
import { mobile, mobileActor, preflight, readJson } from "../_lib/http";
import { toClubRef, toMOccurrence } from "../_lib/serialize";
import { checkinInput } from "../_lib/checkin-input";
import type { MCheckinResult } from "../_types";

/**
 * POST /api/m/checkin { url | code, token?, via } → MCheckinResult.
 * Scan or typed code ("mobile-scan") and the in-app "check in?" pop-up
 * ("mobile-popup", one tap at an online event → TAP). Calls attendance.checkIn — the one write path for
 * attendance — so auto-enrolment, join gates, training requirements and the
 * activity log behave exactly as on the web. Repeating it is harmless
 * (status "ALREADY").
 */
export async function POST(req: Request) {
  return mobile(async (): Promise<MCheckinResult> => {
    const actor = await mobileActor(req);
    const { code, token, via } = checkinInput(await readJson(req));
    const r = await checkIn(actor, { code, token, via });
    return {
      status: r.status,
      attendanceId: r.attendanceId,
      method: r.method,
      methodLabel: METHOD_LABEL[r.method],
      checkedInAt: r.checkedInAt.toISOString(),
      occurrence: toMOccurrence(r.occurrence),
      club: r.club ? toClubRef(r.club) : null,
      membership: r.membership,
      reviewProgress: r.reviewProgress,
      requirementsMet: r.requirementsMet,
    };
  });
}

export const OPTIONS = preflight;
