import { db } from "@/lib/db";
import { DomainError, notFound } from "@/lib/domain/kit";
import { eventAccess } from "@/lib/authz/events";
import { OCC_INCLUDE } from "@/lib/events/feed";
import { splitEventLinks } from "@/lib/events/links";
import { campusMapQuery } from "@/lib/events/share";
import { describeSchedule } from "@/lib/events/summary";
import { richToText } from "@/lib/rich/sanitize";
import { mobile, mobileActor, preflight } from "../../_lib/http";
import { feedToMEvent } from "../../_lib/serialize";
import { leaderCheckinFor } from "../../_lib/checkin-tools";
import type { MEventDetail } from "../../_types";

/**
 * An occurrence by id — or, for links that name the whole event
 * ("/events/<eventId>" in notifications), its next meeting (else its latest).
 */
async function findOccurrence(id: string) {
  const exact = await db.eventOccurrence.findUnique({ where: { id }, include: OCC_INCLUDE });
  if (exact) return exact;
  const next = await db.eventOccurrence.findFirst({ where: { eventId: id, endsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, include: OCC_INCLUDE });
  return next ?? db.eventOccurrence.findFirst({ where: { eventId: id }, orderBy: { startsAt: "desc" }, include: OCC_INCLUDE });
}

/**
 * GET /api/m/events/[occurrenceId] → MEventDetail: one meeting with its
 * description, links and where to go (an event id works too: its next
 * meeting). Visibility comes from lib/authz/events (eventAccess):
 * members-only events stay hidden from everyone else. `leaderCheckin` (the
 * QR and "Add someone") is there only while check-in is open, for people
 * who can run it (lib/domain/attendance canManageOccurrence).
 */
export async function GET(req: Request, { params }: { params: Promise<{ occurrenceId: string }> }) {
  const { occurrenceId } = await params;
  return mobile(async (): Promise<MEventDetail> => {
    const actor = await mobileActor(req);
    const o = await findOccurrence(decodeURIComponent(occurrenceId));
    if (!o) throw notFound("Event");
    const e = o.event;
    const access = await eventAccess(actor, {
      id: e.id,
      clubId: e.clubId,
      visibility: e.visibility,
      club: e.club,
      cohosts: e.cohosts.map((c) => ({ clubId: c.club.id, status: "APPROVED" })),
    });
    if (!access.ok) {
      if (access.reason === "signin") throw new DomainError("UNAUTHENTICATED", "Sign in with your Weber State account to see this event.");
      if (access.reason === "members") throw new DomainError("FORBIDDEN", "This event is for club members only.");
      throw notFound("Event");
    }
    const { body, links } = splitEventLinks(e.descriptionHtml);
    const leaderCheckin = await leaderCheckinFor(actor, o.id);
    return {
      ...feedToMEvent(o),
      description: richToText(body, 4000),
      links,
      mapQuery: e.locationType === "CAMPUS" && e.building ? campusMapQuery(e.building.name) : e.locationType === "ADDRESS" ? e.address : null,
      virtualUrl: e.locationType === "VIRTUAL" ? e.virtualUrl : null,
      scheduleLabel:
        e.recurrence === "NONE"
          ? null
          : describeSchedule({
              startsAt: e.startsAt ?? o.startsAt,
              recurrence: e.recurrence,
              interval: e.recurrenceInterval,
              weekdays: e.recurrenceWeekdays,
              until: e.recurrenceUntil,
              count: e.recurrenceCount,
              allDay: e.allDay,
            }),
      webPath: `/events/${e.id}?o=${o.id}`,
      leaderCheckin,
    };
  });
}

export const OPTIONS = preflight;
