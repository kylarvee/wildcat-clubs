import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewEvent } from "@/lib/domain/events";
import { buildCalendar, icsResponse } from "@/lib/events/ics";
import { OCC_INCLUDE, toIcsEvents } from "@/lib/events/feed";

/** GET /api/ics/occurrence/<occurrenceId> — one meeting as an .ics download ("Add to calendar"). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.replace(/\.ics$/i, "");
  const occ = await db.eventOccurrence.findUnique({ where: { id }, include: OCC_INCLUDE });
  if (!occ) return new Response("Not found", { status: 404 });
  const actor = await getCurrentUser();
  if (!(await canViewEvent(actor, occ.event))) return new Response("Not found", { status: 404 });
  const body = buildCalendar({ name: occ.event.title, events: toIcsEvents([occ]) });
  const slug = occ.event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "event";
  return icsResponse(body, { filename: `${slug}.ics`, download: true, cacheSeconds: 60 });
}
