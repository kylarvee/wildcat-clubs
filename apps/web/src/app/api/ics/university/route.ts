import { buildCalendar, icsResponse } from "@/lib/events/ics";
import { feedOccurrences, icsRange, toIcsEvents, viewerContext } from "@/lib/events/feed";
import { INSTITUTION, PLATFORM } from "@/lib/institution";

/** GET /api/ics/university(.ics) — every PUBLIC club and university event. */
export async function GET() {
  const rows = await feedOccurrences(await viewerContext(null), { scope: "university" }, icsRange(), { publicOnly: true, take: 5000 });
  const body = buildCalendar({ name: `${INSTITUTION.mascot} clubs · ${INSTITUTION.shortName}`, description: `Public club and university events on ${PLATFORM.name}.`, events: toIcsEvents(rows) });
  return icsResponse(body, { filename: "weber-state-clubs.ics", cacheSeconds: 900 });
}
