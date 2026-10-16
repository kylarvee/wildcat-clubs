import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute } from "@/lib/domain/kit";
import { checkinFeed } from "@/lib/domain/attendance";

/**
 * GET /api/checkin/<occurrenceId>/feed?take=8 — live count and latest arrivals
 * for the check-in screen ({ count, windowState, latest[] }). Same permission
 * as the token API.
 */
export async function GET(req: Request, { params }: { params: Promise<{ occurrenceId: string }> }) {
  const { occurrenceId } = await params;
  const take = Number(new URL(req.url).searchParams.get("take") ?? 8) || 8;
  const res = await apiRoute(async () => checkinFeed(await getCurrentUser(), occurrenceId, take));
  res.headers.set("cache-control", "no-store");
  return res;
}
