import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute } from "@/lib/domain/kit";
import { currentQrToken } from "@/lib/domain/attendance";

/**
 * GET /api/checkin/<occurrenceId>/token — the QR token to show right now
 * ({ token, code, url, rotateSeconds, expiresInMs, windowState, opensAt, closesAt }).
 * Leaders with "attendance" on the host club; admins for university events.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ occurrenceId: string }> }) {
  const { occurrenceId } = await params;
  const res = await apiRoute(async () => currentQrToken(await getCurrentUser(), occurrenceId));
  res.headers.set("cache-control", "no-store");
  return res;
}
