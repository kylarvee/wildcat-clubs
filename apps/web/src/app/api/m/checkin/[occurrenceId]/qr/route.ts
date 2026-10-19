import { mobile, mobileActor, preflight } from "../../../_lib/http";
import { checkinQrView } from "../../../_lib/checkin-tools";

/**
 * GET /api/m/checkin/[occurrenceId]/qr → MCheckinQr: the rotating QR a
 * leader shows at the door, with the event code and the head count. The
 * same token as the web's live check-in screen (lib/domain/attendance
 * checkinScreen), so it needs the same permission: Attendance in the host
 * club, or an admin at a university event. The app fetches it again each
 * time the code changes.
 */
export async function GET(req: Request, { params }: { params: Promise<{ occurrenceId: string }> }) {
  const { occurrenceId } = await params;
  return mobile(async () => checkinQrView(await mobileActor(req), decodeURIComponent(occurrenceId)));
}

export const OPTIONS = preflight;
