import "server-only";
import type { Prisma, Recurrence, Visibility } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, isAdmin } from "@/lib/authz";
import { INSTITUTION } from "@/lib/institution";
import { fmtRange } from "@/lib/time";

/**
 * Read-only lookups behind rich-text embeds: which events a viewer may see
 * (event cards in RichContent and the editor's event search) and campus
 * buildings (map embeds). Writes never happen here.
 *
 * Event visibility (Event.visibility):
 *   PUBLIC      anyone, signed in or not
 *   UNIVERSITY  any signed-in Weber State account
 *   MEMBERS     members of the host club or an approved co-host club, and admins
 *               (a university event marked MEMBERS is treated as UNIVERSITY)
 * Drafts (the club's idea list) show only to the club's event planners and admins,
 * and events of clubs that aren't approved yet only to that club's leaders.
 */

const PUBLIC_CLUB_STATUSES = ["APPROVED", "RETIRED"] as const;

/** Club ids where the viewer is an active member or holds a current role. */
async function viewerClubIds(actor: Actor): Promise<string[]> {
  const [memberships, roles] = await Promise.all([
    db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, select: { clubId: true } }),
    db.roleAssignment.findMany({ where: { userId: actor.id, endedAt: null }, select: { clubId: true } }),
  ]);
  return [...new Set([...memberships, ...roles].map((r) => r.clubId))];
}

/** Prisma filter for scheduled events the viewer may see. */
export async function visibleEventsWhere(actor: Actor | null): Promise<Prisma.EventWhereInput> {
  const base: Prisma.EventWhereInput = { status: { not: "DRAFT" } };
  if (isAdmin(actor)) return base;
  const clubIsPublic: Prisma.EventWhereInput = { OR: [{ clubId: null }, { club: { status: { in: [...PUBLIC_CLUB_STATUSES] } } }] };
  if (!actor) return { AND: [base, clubIsPublic, { visibility: "PUBLIC" }] };
  const mine = await viewerClubIds(actor);
  return {
    AND: [
      base,
      clubIsPublic,
      {
        OR: [
          { visibility: { in: ["PUBLIC", "UNIVERSITY"] } },
          { visibility: "MEMBERS", clubId: null },
          { visibility: "MEMBERS", clubId: { in: mine } },
          { visibility: "MEMBERS", cohosts: { some: { clubId: { in: mine }, status: "APPROVED" } } },
        ],
      },
    ],
  };
}

type EventGate = {
  clubId: string | null;
  visibility: Visibility;
  status: "DRAFT" | "SCHEDULED" | "CANCELLED";
  club: { status: string } | null;
  cohosts: { clubId: string; status: string }[];
};

export type EventAccess = { ok: true } | { ok: false; reason: "signin" | "members" | "hidden" };

/** Whether `actor` may see this event, and if not, what would let them. */
export async function eventAccess(actor: Actor | null, event: EventGate): Promise<EventAccess> {
  if (isAdmin(actor)) return { ok: true };
  const hostAccess = actor && event.clubId ? await getClubAccess(actor, event.clubId) : null;
  if (event.status === "DRAFT") return hostAccess?.capabilities.has("events") ? { ok: true } : { ok: false, reason: "hidden" };
  if (event.club && !(PUBLIC_CLUB_STATUSES as readonly string[]).includes(event.club.status) && !hostAccess?.isLeader) return { ok: false, reason: "hidden" };
  if (event.visibility === "PUBLIC") return { ok: true };
  if (!actor) return { ok: false, reason: "signin" };
  if (event.visibility === "UNIVERSITY" || !event.clubId) return { ok: true };
  if (hostAccess?.isMember) return { ok: true };
  for (const c of event.cohosts) {
    if (c.status !== "APPROVED") continue;
    if ((await getClubAccess(actor, c.clubId))?.isMember) return { ok: true };
  }
  return { ok: false, reason: "members" };
}

type LocationFields = {
  locationType: "CAMPUS" | "ADDRESS" | "VIRTUAL" | "TBD";
  room: string | null;
  address: string | null;
  building: { name: string; code: string } | null;
};

/** "Shepherd Union (SU) 404", "2400 Washington Blvd", "Online", "Location to be announced". */
export function eventLocationLabel(e: LocationFields, roomOverride?: string | null): string {
  const room = roomOverride || e.room;
  switch (e.locationType) {
    case "CAMPUS":
      return e.building ? `${e.building.name}${room ? ` ${room}` : ""}` : room || "On campus";
    case "ADDRESS":
      return e.address || "Off campus";
    case "VIRTUAL":
      return "Online";
    default:
      return "Location to be announced";
  }
}

/** The query string that pins an event's place on Google Maps (null when there's nothing to pin). */
export function eventMapQuery(e: LocationFields & { lat: number | null; lng: number | null }): string | null {
  if (e.locationType === "CAMPUS" && e.building) return `${e.building.name}, ${INSTITUTION.mapsSuffix}`;
  if (e.locationType === "ADDRESS") return e.address || (e.lat != null && e.lng != null ? `${e.lat},${e.lng}` : null);
  return null;
}

const cardSelect = {
  id: true,
  title: true,
  clubId: true,
  visibility: true,
  status: true,
  kind: true,
  allDay: true,
  recurrence: true,
  locationType: true,
  room: true,
  address: true,
  lat: true,
  lng: true,
  virtualUrl: true,
  building: { select: { name: true, code: true } },
  club: { select: { name: true, slug: true, status: true, logoUrl: true, logoColor: true } },
  cohosts: { select: { clubId: true, status: true, club: { select: { name: true, slug: true } } } },
} satisfies Prisma.EventSelect;

export type EventCardData = {
  id: string;
  title: string;
  status: "DRAFT" | "SCHEDULED" | "CANCELLED";
  visibility: Visibility;
  recurrence: Recurrence;
  allDay: boolean;
  next: { startsAt: Date; endsAt: Date; cancelled: boolean; upcoming: boolean } | null;
  location: string;
  virtualUrl: string | null;
  host: { name: string; slug: string; logoUrl: string | null; logoColor: string } | null;
  cohosts: { name: string; slug: string }[];
};

export type EventCardResult = { state: "ok"; event: EventCardData } | { state: "missing" } | { state: "denied"; reason: "signin" | "members" | "hidden" };

/** Everything an event card shows, after the visibility check. */
export async function loadEventCard(actor: Actor | null, eventId: string): Promise<EventCardResult> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: cardSelect }).catch(() => null);
  if (!event) return { state: "missing" };
  const access = await eventAccess(actor, event);
  if (!access.ok) return { state: "denied", reason: access.reason };

  const now = new Date();
  const upcoming = await db.eventOccurrence.findFirst({
    where: { eventId, endsAt: { gte: now } },
    orderBy: { startsAt: "asc" },
    select: { startsAt: true, endsAt: true, status: true, roomOverride: true },
  });
  const occ =
    upcoming ??
    (await db.eventOccurrence.findFirst({ where: { eventId }, orderBy: { startsAt: "desc" }, select: { startsAt: true, endsAt: true, status: true, roomOverride: true } }));

  return {
    state: "ok",
    event: {
      id: event.id,
      title: event.title,
      status: event.status,
      visibility: event.visibility,
      recurrence: event.recurrence,
      allDay: event.allDay,
      next: occ ? { startsAt: occ.startsAt, endsAt: occ.endsAt, cancelled: occ.status === "CANCELLED", upcoming: Boolean(upcoming) } : null,
      location: eventLocationLabel(event, occ?.roomOverride),
      virtualUrl: event.locationType === "VIRTUAL" ? event.virtualUrl : null,
      host: event.club ? { name: event.club.name, slug: event.club.slug, logoUrl: event.club.logoUrl, logoColor: event.club.logoColor } : null,
      cohosts: event.cohosts.filter((c) => c.status === "APPROVED").map((c) => c.club),
    },
  };
}

export type EventSearchResult = {
  id: string;
  title: string;
  when: string | null;
  upcoming: boolean;
  location: string;
  visibility: Visibility;
  cancelled: boolean;
  clubName: string | null;
  clubColor: string | null;
};

/**
 * Events the viewer may embed: with a club, that club's own and co-hosted
 * events plus university events; without one, every event the viewer can see.
 * Upcoming events first (soonest first), then past ones (most recent first).
 */
export async function searchEmbeddableEvents(actor: Actor | null, opts: { clubId?: string | null; q?: string | null; limit?: number }): Promise<EventSearchResult[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const q = opts.q?.trim().slice(0, 100);
  const filters: Prisma.EventWhereInput[] = [await visibleEventsWhere(actor)];
  if (opts.clubId) filters.push({ OR: [{ clubId: opts.clubId }, { clubId: null }, { cohosts: { some: { clubId: opts.clubId, status: "APPROVED" } } }] });
  if (q) filters.push({ OR: [{ title: { contains: q, mode: "insensitive" } }, { club: { name: { contains: q, mode: "insensitive" } } }] });

  const events = await db.event.findMany({
    where: { AND: filters },
    select: {
      ...cardSelect,
      occurrences: { where: { endsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true, endsAt: true, status: true, roomOverride: true } },
      startsAt: true,
      durationMinutes: true,
    },
    orderBy: { startsAt: "desc" },
    take: 150,
  });

  const now = Date.now();
  const rows = events.map((e) => {
    const next = e.occurrences[0] ?? null;
    const start = next?.startsAt ?? e.startsAt;
    const end = next?.endsAt ?? (e.startsAt ? new Date(e.startsAt.getTime() + e.durationMinutes * 60_000) : null);
    return {
      sortKey: next ? next.startsAt.getTime() - now : Number.MAX_SAFE_INTEGER - (start?.getTime() ?? 0),
      row: {
        id: e.id,
        title: e.title,
        when: start && end ? fmtRange(start, end, e.allDay) : null,
        upcoming: Boolean(next),
        location: eventLocationLabel(e, next?.roomOverride),
        visibility: e.visibility,
        cancelled: e.status === "CANCELLED" || next?.status === "CANCELLED",
        clubName: e.club?.name ?? null,
        clubColor: e.club?.logoColor ?? null,
      } satisfies EventSearchResult,
    };
  });
  return rows
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, limit)
    .map((r) => r.row);
}

export type BuildingOption = { id: string; code: string; name: string; address: string | null; lat: number | null; lng: number | null };

/** Campus buildings for map pins, alphabetical, optionally filtered by name or code. */
export async function listBuildings(q?: string | null): Promise<BuildingOption[]> {
  const term = q?.trim().slice(0, 100);
  return db.building.findMany({
    where: term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { code: { contains: term, mode: "insensitive" } }] } : undefined,
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, address: true, lat: true, lng: true },
    take: 300,
  });
}

