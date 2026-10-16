import { db } from "@/lib/db";
import { buildCalendar, icsResponse } from "@/lib/events/ics";
import { feedOccurrences, icsRange, toIcsEvents, viewerContext } from "@/lib/events/feed";
import { INSTITUTION } from "@/lib/institution";

/** GET /api/ics/club/<slug>(.ics) — a club's PUBLIC events (hosted and co-hosted), for any calendar app. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug.replace(/\.ics$/i, "");
  const club = await db.club.findUnique({ where: { slug }, select: { id: true, name: true, status: true } });
  if (!club || (club.status !== "APPROVED" && club.status !== "RETIRED")) return new Response("Calendar not found", { status: 404 });
  const rows = await feedOccurrences(await viewerContext(null), { scope: "club", clubId: club.id }, icsRange(), { publicOnly: true, take: 3000 });
  const body = buildCalendar({ name: `${club.name} · ${INSTITUTION.shortName}`, description: `Public events from ${club.name} at ${INSTITUTION.name}.`, events: toIcsEvents(rows) });
  return icsResponse(body, { filename: `${slug}.ics`, cacheSeconds: 900 });
}
