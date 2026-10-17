import { checkinPreview } from "@/lib/domain/attendance";
import { mobile, mobileActor, preflight, readJson } from "../../_lib/http";
import { toMOccurrence } from "../../_lib/serialize";
import { checkinInput } from "../../_lib/checkin-input";
import type { MCheckinPreview } from "../../_types";

/**
 * POST /api/m/checkin/preview { url | code, token? } → MCheckinPreview.
 * What a scan would do, with no side effects — works before sign-in. A live
 * QR token comes back as a 10-minute `pass`, so someone can scan first, sign
 * in or create their account, and still check in (attendance.checkinPreview,
 * the same read the web /c/<code> page uses).
 */
export async function POST(req: Request) {
  return mobile(async (): Promise<MCheckinPreview> => {
    const actor = await mobileActor(req);
    const { code, token } = checkinInput(await readJson(req));
    const p = await checkinPreview(actor, code, token);
    if (!p.found) return { found: false, message: p.message };
    return {
      found: true,
      occurrence: toMOccurrence(p.occurrence),
      signedIn: p.signedIn,
      pass: p.pass,
      scan: p.scan,
      existing: p.existing ? { method: p.existing.method, checkedInAt: p.existing.checkedInAt.toISOString() } : null,
      membership: p.membership,
      ready: p.ready,
      blocker: p.blocker,
    };
  });
}

export const OPTIONS = preflight;
