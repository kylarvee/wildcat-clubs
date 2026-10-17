import { mobile, mobileActor, preflight } from "../_lib/http";
import { calendarView } from "../_lib/views";

/**
 * GET /api/m/calendar?from=ISO&to=ISO → MCalendar: your calendar — the clubs
 * you subscribe to plus university events if you follow them — from the same
 * feed as the web calendar and your ICS link (lib/events/feed, scope "me").
 * Defaults to today (campus time) through six weeks out. Cancelled meetings
 * are included and marked, so nobody shows up to an empty room.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return mobile(async () => calendarView(await mobileActor(req), { from: q.get("from"), to: q.get("to") }));
}

export const OPTIONS = preflight;
