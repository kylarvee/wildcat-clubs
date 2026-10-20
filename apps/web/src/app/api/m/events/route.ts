import { mobile, mobileActor, preflight } from "../_lib/http";
import { eventsTabView } from "../_lib/events";

/**
 * GET /api/m/events?filter=all|free-food|service|following&from=ISO&to=ISO →
 * MCalendar: the app's Events tab, from the same feed and filters as the web
 * Events page. Works signed out (public events); "following" needs sign-in.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return mobile(async () => eventsTabView(await mobileActor(req), { filter: q.get("filter"), from: q.get("from"), to: q.get("to") }));
}

export const OPTIONS = preflight;
