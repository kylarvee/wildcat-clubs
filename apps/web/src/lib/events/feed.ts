import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { can, getClubAccess, isAdmin } from "@/lib/authz";
import { eventVisibilityWhere } from "@/lib/authz/events";
import { eventCostSummaries } from "@/lib/domain/events";
import { KIND_LABEL, locationText, UNIVERSITY_COLOR } from "@/lib/events/labels";
import { describeSchedule } from "@/lib/events/summary";
import { appUrl, campusMapQuery } from "@/lib/events/share";
import { splitEventLinks } from "@/lib/events/links";
import type { IcsEvent } from "@/lib/events/ics";
import { richToText } from "@/lib/rich/sanitize";
import { INSTITUTION } from "@/lib/institution";
import { toDateInput, toWallClockIso, addDaysToDateInput } from "@/lib/events/wallclock";
import type { CalendarEventJson } from "@/lib/events/types";

/**
 * Which occurrences a viewer sees on a calendar — the one query behind the
 * calendar JSON feed (CalendarView, Events Builder) and the ICS feeds, so a
 * calendar and a subscription can never disagree.
 *
 * Scopes:
 *   club        events the club hosts + events it co-hosts (approved)
 *   me          clubs the viewer subscribes to (+ university events if they opted in)
 *   university  public / Weber State events of every club + university events
 *   trainings   university (admin) events only
 * Visibility always applies: PUBLIC anyone · UNIVERSITY signed in · MEMBERS
 * members and leaders of the host or an approved co-host (never in "university").
 */

export type FeedScope = { scope: "club"; clubId: string } | { scope: "me" } | { scope: "university" } | { scope: "trainings" };

export type ViewerContext = {
  actor: Actor | null;
  admin: boolean;
  /** Clubs where the viewer is an active member or holds a role. */
  memberClubIds: string[];
  /** Clubs where the viewer holds a leadership role (for cost / manage checks). */
  leaderClubIds: string[];
  subscribedClubIds: string[];
  subscribeUniversity: boolean;
};

export async function viewerContext(actor: Actor | null): Promise<ViewerContext> {
  if (!actor) return { actor: null, admin: false, memberClubIds: [], leaderClubIds: [], subscribedClubIds: [], subscribeUniversity: false };
  const [memberships, roles, subs, user] = await Promise.all([
    db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, select: { clubId: true } }),
    db.roleAssignment.findMany({ where: { userId: actor.id, endedAt: null }, select: { clubId: true, role: true } }),
    db.calendarSubscription.findMany({ where: { userId: actor.id }, select: { clubId: true } }),
    db.user.findUnique({ where: { id: actor.id }, select: { subscribeUniversity: true } }),
  ]);
  return {
    actor,
    admin: isAdmin(actor),
    memberClubIds: [...new Set([...memberships.map((m) => m.clubId), ...roles.map((r) => r.clubId)])],
    leaderClubIds: [...new Set(roles.filter((r) => r.role !== "MEMBER").map((r) => r.clubId))],
    subscribedClubIds: subs.map((s) => s.clubId),
    subscribeUniversity: user?.subscribeUniversity ?? true,
  };
}

/** Visibility comes from lib/authz/events; the university listing leaves members-only events out even for admins. */
function visibilityWhere(ctx: ViewerContext, opts: { allowMembers: boolean; publicOnly?: boolean }): Prisma.EventWhereInput {
  if (opts.publicOnly) return eventVisibilityWhere({ signedIn: false, admin: false, memberClubIds: [] });
  if (!opts.allowMembers) {
    return { AND: [eventVisibilityWhere({ signedIn: Boolean(ctx.actor), admin: false, memberClubIds: [] }, { includeMembersOnly: false })] };
  }
  return eventVisibilityWhere({ signedIn: Boolean(ctx.actor), admin: ctx.admin, memberClubIds: ctx.memberClubIds });
}

function scopeWhere(scope: FeedScope, ctx: ViewerContext): Prisma.EventWhereInput {
  const hostedOrCohosted = (ids: string[]): Prisma.EventWhereInput[] => [{ clubId: { in: ids } }, { cohosts: { some: { status: "APPROVED", clubId: { in: ids } } } }];
  switch (scope.scope) {
    case "club":
      return { OR: hostedOrCohosted([scope.clubId]) };
    case "me":
      return { OR: [...hostedOrCohosted(ctx.subscribedClubIds), ...(ctx.subscribeUniversity ? [{ clubId: null }] : [])] };
    case "university":
      return {};
    case "trainings":
      return { clubId: null };
  }
}

export const OCC_INCLUDE = {
  event: {
    select: {
      id: true,
      title: true,
      kind: true,
      status: true,
      visibility: true,
      descriptionHtml: true,
      allDay: true,
      recurrence: true,
      recurrenceInterval: true,
      recurrenceWeekdays: true,
      recurrenceUntil: true,
      recurrenceCount: true,
      startsAt: true,
      locationType: true,
      room: true,
      address: true,
      lat: true,
      lng: true,
      virtualUrl: true,
      updatedAt: true,
      clubId: true,
      club: { select: { id: true, name: true, slug: true, logoColor: true, status: true } },
      building: { select: { name: true, code: true, lat: true, lng: true } },
      cohosts: { where: { status: "APPROVED" }, select: { club: { select: { id: true, name: true, slug: true } } } },
    },
  },
} as const satisfies Prisma.EventOccurrenceInclude;

export type FeedOccurrence = Prisma.EventOccurrenceGetPayload<{ include: typeof OCC_INCLUDE }>;

/** Occurrences overlapping [start, end) in a scope, filtered by what the viewer may see. */
export async function feedOccurrences(
  ctx: ViewerContext,
  scope: FeedScope,
  range: { start: Date; end: Date },
  opts: { publicOnly?: boolean; take?: number } = {},
): Promise<FeedOccurrence[]> {
  if (scope.scope === "me" && !ctx.actor) return [];
  const where: Prisma.EventOccurrenceWhereInput = {
    startsAt: { lt: range.end },
    endsAt: { gt: range.start },
    event: {
      AND: [
        { status: { in: ["SCHEDULED", "CANCELLED"] } },
        // Club events show while the club is active (or as history once retired).
        { OR: [{ clubId: null }, { club: { status: { in: ["APPROVED", "RETIRED"] } } }] },
        scopeWhere(scope, ctx),
        visibilityWhere(ctx, { allowMembers: scope.scope !== "university", publicOnly: opts.publicOnly }),
      ],
    },
  };
  return db.eventOccurrence.findMany({ where, include: OCC_INCLUDE, orderBy: { startsAt: "asc" }, take: opts.take ?? 2000 });
}

/** What the viewer may do with each host club's events: manage (events) and see costs (events or budget). */
async function hostPowers(ctx: ViewerContext, rows: FeedOccurrence[]) {
  const manage = new Set<string>();
  const costs = new Set<string>();
  const clubIds = [...new Set(rows.map((r) => r.event.clubId).filter(Boolean) as string[])];
  // lib/authz decides; only clubs where the viewer could hold a capability are asked.
  const candidates = ctx.admin ? clubIds : clubIds.filter((c) => ctx.leaderClubIds.includes(c));
  const accesses = await Promise.all(candidates.map((id) => getClubAccess(ctx.actor, id)));
  for (const access of accesses) {
    if (!access) continue;
    if (access.capabilities.has("events")) manage.add(access.clubId);
    if (access.capabilities.has("events") || access.capabilities.has("budget")) costs.add(access.clubId);
  }
  return { manage, costs, university: can(ctx.actor, "admin.trainings") };
}

/** FullCalendar events for the calendar JSON feed. */
export async function toCalendarJson(ctx: ViewerContext, scope: FeedScope, rows: FeedOccurrence[]): Promise<CalendarEventJson[]> {
  const powers = await hostPowers(ctx, rows);
  const costEventIds = [...new Set(rows.filter((r) => r.event.clubId && powers.costs.has(r.event.clubId)).map((r) => r.eventId))];
  const summaries = await eventCostSummaries(costEventIds);
  // One-time costs belong to an event's first scheduled meeting.
  const firstScheduled = new Map<string, string>();
  if (costEventIds.length) {
    const firsts = await db.eventOccurrence.groupBy({ by: ["eventId"], where: { eventId: { in: costEventIds }, status: "SCHEDULED" }, _min: { startsAt: true } });
    for (const f of firsts) if (f._min.startsAt) firstScheduled.set(f.eventId, f._min.startsAt.toISOString());
  }

  const now = new Date();
  return rows.map((o) => {
    const e = o.event;
    const color = e.club?.logoColor ?? UNIVERSITY_COLOR;
    const cancelled = o.status === "CANCELLED" || e.status === "CANCELLED";
    const canManage = e.clubId ? powers.manage.has(e.clubId) : powers.university;
    const summary = summaries.get(e.id);
    const hostedHere = scope.scope === "club" ? e.clubId === scope.clubId : true;
    const mapQuery = e.locationType === "CAMPUS" && e.building ? campusMapQuery(e.building.name) : e.locationType === "ADDRESS" ? e.address : null;
    const start = e.allDay ? toDateInput(o.startsAt) : toWallClockIso(o.startsAt);
    const end = e.allDay ? addDaysToDateInput(toDateInput(new Date(o.endsAt.getTime() - 1)), 1) : toWallClockIso(o.endsAt);
    return {
      id: o.id,
      title: e.title,
      start,
      end,
      allDay: e.allDay,
      backgroundColor: color,
      borderColor: color,
      textColor: "#ffffff",
      // Only upcoming one-time events of clubs you manage can be dragged; repeating ones open
      // the editor, and past ones are history.
      editable: canManage && hostedHere && e.recurrence === "NONE" && !cancelled && o.endsAt > now,
      classNames: cancelled ? ["wc-cancelled"] : [],
      extendedProps: {
        eventId: e.id,
        occurrenceId: o.id,
        clubId: e.clubId,
        clubName: e.club?.name ?? null,
        clubSlug: e.club?.slug ?? null,
        clubColor: color,
        hostedHere,
        cohostNames: e.cohosts.map((c) => c.club.name),
        location: locationText({ ...e, roomOverride: o.roomOverride }),
        locationType: e.locationType,
        mapQuery,
        virtualUrl: e.locationType === "VIRTUAL" ? e.virtualUrl : null,
        kind: e.kind,
        visibility: e.visibility,
        cancelled,
        note: o.note,
        startsAt: o.startsAt.toISOString(),
        endsAt: o.endsAt.toISOString(),
        allDay: e.allDay,
        recurrence: e.recurrence,
        scheduleLabel: describeSchedule({
          startsAt: e.startsAt ?? o.startsAt,
          recurrence: e.recurrence,
          interval: e.recurrenceInterval,
          weekdays: e.recurrenceWeekdays,
          until: e.recurrenceUntil,
          count: e.recurrenceCount,
          allDay: e.allDay,
        }),
        canManage: canManage && hostedHere,
        ...(summary && summary.items > 0
          ? { expectedCostCents: summary.perOccurrenceCents + (firstScheduled.get(e.id) === o.startsAt.toISOString() ? summary.oneTimeCents : 0), eventTotalCents: summary.totalCents }
          : {}),
      },
    };
  });
}

// ─── ICS ─────────────────────────────────────────────────────────────────────

/** A feed's window: recent history plus the year ahead. */
export function icsRange(now = new Date()) {
  return { start: new Date(now.getTime() - 90 * 86_400_000), end: new Date(now.getTime() + 400 * 86_400_000) };
}

/** One VEVENT per occurrence (UID occurrenceId@wildcatclubs); cancelled ones say so. */
export function toIcsEvents(rows: FeedOccurrence[]): IcsEvent[] {
  return rows.map((o) => {
    const e = o.event;
    const { body, links } = splitEventLinks(e.descriptionHtml);
    const url = appUrl(`/events/${e.id}?o=${o.id}`);
    const where =
      e.locationType === "CAMPUS" && e.building
        ? `${locationText({ ...e, roomOverride: o.roomOverride })}, ${INSTITUTION.mapsSuffix}`
        : e.locationType === "VIRTUAL"
          ? (e.virtualUrl ?? "Online")
          : e.locationType === "ADDRESS"
            ? e.address
            : null;
    const geo = e.locationType === "CAMPUS" && e.building?.lat != null && e.building.lng != null ? { lat: e.building.lat, lng: e.building.lng } : e.locationType === "ADDRESS" && e.lat != null && e.lng != null ? { lat: e.lat, lng: e.lng } : null;
    const cancelled = o.status === "CANCELLED" || e.status === "CANCELLED";
    const description = [
      cancelled && o.note ? `Cancelled: ${o.note}` : null,
      richToText(body, 3000),
      links.map((l) => `${l.label || "Link"}: ${l.url}`).join("\n"),
      e.cohosts.length ? `Co-hosted with ${e.cohosts.map((c) => c.club.name).join(", ")}` : null,
      `Details: ${url}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      uid: `${o.id}@wildcatclubs`,
      start: o.startsAt,
      end: o.endsAt,
      allDay: e.allDay,
      summary: `${e.title} (${e.club?.name ?? INSTITUTION.shortName})`,
      description,
      location: where,
      url,
      geo,
      status: cancelled ? "CANCELLED" : "CONFIRMED",
      updatedAt: e.updatedAt,
      categories: [KIND_LABEL[e.kind]],
    };
  });
}
