import "server-only";
import type { Term } from "@prisma/client";
import { db } from "@/lib/db";
import { getTerms } from "@/lib/terms";
import { fileUrl } from "@/lib/domain/files";
import { googleCalendarReady } from "@/lib/integrations/google-calendar";
import { costLineLocks } from "@/lib/domain/events";
import { splitEventLinks } from "@/lib/events/links";
import { describeRecurrence } from "@/lib/events/summary";
import type { TermJson } from "@/lib/events/types";
import type { EditorEvent } from "@/components/events/EventEditor";
import type { IncomingCohost, OutgoingCohost } from "@/components/events/BuilderPanels";

/**
 * Read models for the Events Builder pages (club and admin). Pages check
 * permission first; these only shape data for the client components.
 */

export function termsJson(terms: Term[]): TermJson[] {
  return terms.map((t) => ({ id: t.id, name: t.name, kind: t.kind, academicYear: t.academicYear, startsOn: t.startsOn.toISOString(), endsOn: t.endsOn.toISOString(), countsForActivity: t.countsForActivity }));
}

export async function loadBuildings() {
  return db.building.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, code: true } });
}

const nextMeeting = (now: Date) =>
  ({ where: { startsAt: { gte: now }, status: "SCHEDULED" }, orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true, endsAt: true } }) as const;

export async function loadBuilderData(clubId: string | null) {
  const now = new Date();
  const [incomingRows, outgoingRows, buildings, terms, google] = await Promise.all([
    clubId
      ? db.eventCohost.findMany({
          where: { clubId, status: { in: ["PENDING", "APPROVED"] }, event: { status: "SCHEDULED" } },
          orderBy: { createdAt: "desc" },
          include: {
            requestedBy: { select: { name: true } },
            event: {
              select: {
                id: true,
                title: true,
                allDay: true,
                startsAt: true,
                recurrence: true,
                recurrenceInterval: true,
                recurrenceWeekdays: true,
                recurrenceUntil: true,
                recurrenceCount: true,
                club: { select: { name: true, logoColor: true } },
                occurrences: nextMeeting(now),
              },
            },
          },
        })
      : Promise.resolve([]),
    clubId
      ? db.event.findMany({
          where: { clubId, cohosts: { some: {} } },
          orderBy: { startsAt: "desc" },
          take: 40,
          select: { id: true, title: true, cohostAllClubs: true, occurrences: nextMeeting(now), cohosts: { select: { id: true, status: true, club: { select: { name: true } } }, orderBy: { createdAt: "asc" } } },
        })
      : Promise.resolve([]),
    loadBuildings(),
    getTerms(),
    googleCalendarReady(clubId),
  ]);

  const incoming: IncomingCohost[] = incomingRows
    // Accepted co-hostings only matter while there's something coming up.
    .filter((c) => c.status === "PENDING" || c.event.occurrences.length > 0)
    .map((c) => {
      const next = c.event.occurrences[0];
      return {
        id: c.id,
        status: c.status,
        eventId: c.event.id,
        eventTitle: c.event.title,
        hostClubName: c.event.club?.name ?? "Weber State",
        hostClubColor: c.event.club?.logoColor ?? "#492365",
        next: next ? { startsAt: next.startsAt.toISOString(), endsAt: next.endsAt.toISOString(), allDay: c.event.allDay } : null,
        scheduleLabel:
          c.event.recurrence !== "NONE" && c.event.startsAt
            ? describeRecurrence({ startsAt: c.event.startsAt, recurrence: c.event.recurrence, interval: c.event.recurrenceInterval, weekdays: c.event.recurrenceWeekdays, until: c.event.recurrenceUntil, count: c.event.recurrenceCount })
            : "",
        requestedByName: c.requestedBy.name,
      };
    });

  const outgoing: OutgoingCohost[] = outgoingRows.map((e) => ({
    eventId: e.id,
    eventTitle: e.title,
    nextStartsAt: e.occurrences[0]?.startsAt.toISOString() ?? null,
    all: e.cohostAllClubs,
    cohosts: e.cohosts.map((c) => ({ id: c.id, clubName: c.club.name, status: c.status })),
  }));

  return { incoming, outgoing, buildings, terms: termsJson(terms), googleLive: google.live, googleReason: google.reason ?? null };
}

/**
 * Where an uploaded cover goes: the club's top-level Flyers folder when it has
 * one (every club starts with "Flyers"), else the top of its files. University
 * covers go to the top of University files.
 */
async function coverFolderId(clubId: string | null): Promise<string | null> {
  if (!clubId) return null;
  const folder = await db.fileItem.findFirst({
    where: { clubId, parentId: null, isFolder: true, trashedAt: null, name: { startsWith: "Flyers", mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return folder?.id ?? null;
}

/** Everything the full editor needs. Returns null when the event isn't this host's. */
export async function loadEditorData(clubId: string | null, eventId: string | null) {
  const [event, buildings, clubs, terms, google, coverFolder] = await Promise.all([
    eventId
      ? db.event.findUnique({
          where: { id: eventId },
          include: {
            cohosts: { select: { clubId: true, status: true } },
            attachments: { include: { file: { select: { id: true, name: true, mimeType: true, trashedAt: true } } } },
            costItems: { orderBy: { createdAt: "asc" } },
            requirements: { where: { active: true }, select: { name: true }, take: 1 },
            _count: { select: { occurrences: true } },
          },
        })
      : Promise.resolve(null),
    loadBuildings(),
    clubId
      ? db.club.findMany({ where: { status: "APPROVED", id: { not: clubId } }, orderBy: { name: "asc" }, select: { id: true, name: true, logoColor: true, logoUrl: true } })
      : Promise.resolve([]),
    getTerms(),
    googleCalendarReady(clubId),
    coverFolderId(clubId),
  ]);
  if (eventId && (!event || event.clubId !== clubId)) return null;

  let editor: EditorEvent | null = null;
  if (event) {
    const [attendanceCount, locks] = await Promise.all([db.attendance.count({ where: { occurrence: { eventId: event.id } } }), costLineLocks(event.costItems.map((c) => c.id))]);
    const { body, links } = splitEventLinks(event.descriptionHtml);
    editor = {
      id: event.id,
      status: event.status,
      title: event.title,
      kind: event.kind,
      descriptionHtml: body,
      links,
      visibility: event.visibility,
      setupMinutes: event.setupMinutes,
      cleanupMinutes: event.cleanupMinutes,
      startsAt: event.startsAt?.toISOString() ?? null,
      durationMinutes: event.durationMinutes,
      allDay: event.allDay,
      recurrence: event.recurrence,
      recurrenceInterval: event.recurrenceInterval,
      recurrenceWeekdays: event.recurrenceWeekdays,
      recurrenceUntil: event.recurrenceUntil?.toISOString() ?? null,
      recurrenceCount: event.recurrenceCount,
      locationType: event.locationType,
      buildingId: event.buildingId,
      room: event.room,
      address: event.address,
      virtualUrl: event.virtualUrl,
      coverUrl: event.coverUrl,
      perks: event.perks,
      serviceMinutes: event.serviceMinutes,
      cohostAllClubs: event.cohostAllClubs,
      cohosts: event.cohosts,
      attachments: event.attachments.filter((a) => !a.file.trashedAt).map((a) => ({ id: a.file.id, name: a.file.name, mimeType: a.file.mimeType, url: fileUrl(a.file.id) })),
      costs: event.costItems.map((c) => ({
        id: c.id,
        description: c.description,
        category: c.category,
        quantity: c.quantity,
        unitCostCents: c.unitCostCents,
        perOccurrence: c.perOccurrence,
        fundingSource: c.fundingSource,
        lockedBy: locks.get(c.id)?.title ?? null,
      })),
      attendanceCount,
      requirementName: event.requirements[0]?.name ?? null,
    };
  }
  return { event: editor, buildings, clubs, terms: termsJson(terms), googleLive: google.live, googleReason: google.reason ?? null, coverFolderId: coverFolder };
}
