import { mobile, mobileActor, preflight } from "../_lib/http";
import { homeView } from "../_lib/views";

/**
 * GET /api/m/home → MHome: what's happening now (check-ins open at your
 * clubs), your clubs and roles, the next two weeks of your calendar, and
 * recent announcements you're allowed to see. Same sources as the web
 * dashboard: attendance.liveOccurrencesForUser, the calendar feed, and
 * announcements.announcementFeed.
 */
export async function GET(req: Request) {
  return mobile(async () => homeView(await mobileActor(req)));
}

export const OPTIONS = preflight;
