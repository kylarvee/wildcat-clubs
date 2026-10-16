import { db } from "@/lib/db";
import { loadActor } from "@/lib/auth/session";
import { buildCalendar, icsResponse } from "@/lib/events/ics";
import { feedOccurrences, icsRange, toIcsEvents, viewerContext } from "@/lib/events/feed";
import { PLATFORM } from "@/lib/institution";

/**
 * GET /api/ics/user/<calendarToken>(.ics) — a person's tailored calendar
 * (subscribed clubs, members-only events of their clubs, university events if
 * they opted in). The token is private; anyone holding it sees this feed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/i, "");
  const user = token ? await db.user.findUnique({ where: { calendarToken: token }, select: { id: true } }) : null;
  const actor = user ? await loadActor(user.id) : null;
  if (!actor || actor.status === "DEACTIVATED") return new Response("Calendar not found", { status: 404 });
  const rows = await feedOccurrences(await viewerContext(actor), { scope: "me" }, icsRange(), { take: 3000 });
  const body = buildCalendar({ name: `My ${PLATFORM.name}`, description: `Events from the clubs ${actor.name.split(" ")[0]} follows on ${PLATFORM.name}.`, events: toIcsEvents(rows) });
  return icsResponse(body, { filename: "wildcat-clubs.ics", cacheSeconds: 300 });
}
