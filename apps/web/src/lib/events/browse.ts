import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseQuery } from "@/lib/search/query-text";
import { strictTsquery } from "@/lib/search/sql";
import { eventBadges, eventMode, locationText } from "@/lib/events/labels";
import { toDateInput } from "@/lib/events/wallclock";
import { feedWhere, OCC_INCLUDE, type FeedOccurrence, type FeedScope, type ViewerContext } from "@/lib/events/feed";
import { eventFilterWhere } from "@/lib/events/browse-where";
import { dateRange, listWindow, type EventBrowseParams, type EventFilters, type EventScope } from "@/lib/events/browse-params";
import type { EventCardData } from "@/lib/events/types";

/**
 * The Events page's read model: one list of event dates for "Mine" or "All
 * of Weber State", with the page's filters (lib/events/browse-where), from the
 * same feed query as every calendar (lib/events/feed), so a card, the month
 * view and an ICS subscription never disagree about who sees what.
 *
 * Search looks at each event's title, description and host club name with
 * Postgres full text built on the fly (a couple of thousand events), using
 * the club search's query parser (lib/search/query-text): every word must
 * match, and the last one may still be being typed.
 */

/** Title (A), host club name (B), description text (C): the club search's prefix matching covers A–C. */
const EVENT_DOCUMENT = Prisma.sql`(
  setweight(to_tsvector('english', unaccent(coalesce(e.title, ''))), 'A') ||
  setweight(to_tsvector('english', unaccent(coalesce(c.name, ''))), 'B') ||
  setweight(to_tsvector('english', unaccent(regexp_replace(coalesce(e."descriptionHtml", ''), '<[^>]*>', ' ', 'g'))), 'C')
)`;

/** Ids of events matching the search box; null when there's nothing to search for. Visibility is applied by the caller. */
export async function searchEventIds(raw: string): Promise<string[] | null> {
  const parsed = parseQuery(raw);
  if (!parsed) return null;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM "Event" e LEFT JOIN "Club" c ON c.id = e."clubId"
    WHERE ${EVENT_DOCUMENT} @@ ${strictTsquery(parsed)}`;
  return rows.map((r) => r.id);
}

/** The feed scope behind the Events page's scope. */
export const feedScopeFor = (scope: EventScope): FeedScope => (scope === "mine" ? { scope: "me" } : { scope: "all" });

/** The filters as one event filter, with the search resolved to ids. Null when a search matched nothing. */
export async function eventFilter(ctx: ViewerContext, p: EventFilters): Promise<Prisma.EventWhereInput | null> {
  const matchIds = p.q ? await searchEventIds(p.q) : null;
  if (matchIds && matchIds.length === 0) return null;
  return eventFilterWhere(p, { followedClubIds: ctx.subscribedClubIds }, matchIds);
}

export function toEventCard(o: FeedOccurrence, now = new Date()): EventCardData {
  const e = o.event;
  return {
    occurrenceId: o.id,
    eventId: e.id,
    title: e.title,
    kind: e.kind,
    startsAt: o.startsAt.toISOString(),
    endsAt: o.endsAt.toISOString(),
    allDay: e.allDay,
    dayKey: toDateInput(o.startsAt),
    location: locationText({ ...e, roomOverride: o.roomOverride }),
    mode: eventMode(e),
    coverUrl: e.coverUrl,
    club: e.club ? { name: e.club.name, slug: e.club.slug, logoUrl: e.club.logoUrl, logoColor: e.club.logoColor } : null,
    cohostNames: e.cohosts.map((c) => c.club.name),
    badges: eventBadges(e),
    cancelled: o.status === "CANCELLED" || e.status === "CANCELLED",
    note: o.note,
    happeningNow: o.startsAt <= now && now < o.endsAt,
  };
}


export type EventListResult = { items: EventCardData[]; total: number };

/**
 * One page of the list: dates overlapping the filters' range (or everything
 * coming up), soonest first. What already ended drops off (listWindow).
 */
export async function listEvents(ctx: ViewerContext, scope: EventScope, p: EventBrowseParams, now = new Date()): Promise<EventListResult> {
  if (scope === "mine" && !ctx.actor) return { items: [], total: 0 };
  const filter = await eventFilter(ctx, p);
  if (!filter) return { items: [], total: 0 };
  const where = feedWhere(ctx, feedScopeFor(scope), listWindow(dateRange(p, now), now), { filter });
  const [rows, total] = await Promise.all([
    db.eventOccurrence.findMany({ where, include: OCC_INCLUDE, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: p.show }),
    db.eventOccurrence.count({ where }),
  ]);
  return { items: rows.map((o) => toEventCard(o, now)), total };
}
