import type { EventPerk, Prisma } from "@prisma/client";
import type { EventFilters } from "@/lib/events/browse-params";

/**
 * The Events page filters as one Prisma filter on Event, for the list, the
 * month view's feed and the mobile Events tab (lib/events/feed applies scope
 * and visibility around it). Pure, with type-only imports, so the seed's
 * checks (prisma/seed/verify.ts) run the very same filter.
 *
 *   type       the event's type (EventKind)
 *   category   the host club's category (ClubCategory); university events have none
 *   perks      Free food, Free stuff: either one when both are picked
 *   service    counts toward service hours (serviceMinutes set)
 *   online     online, or in person with an online link (hybrid)
 *   following  hosted or co-hosted by a club the viewer follows
 *   matchIds   events the search box matched (lib/events/browse); null = no search
 */
export function eventFilterWhere(p: Omit<EventFilters, "q">, viewer: { followedClubIds: string[] }, matchIds: string[] | null = null): Prisma.EventWhereInput {
  const and: Prisma.EventWhereInput[] = [];
  if (p.type) and.push({ kind: p.type });
  if (p.category) and.push({ club: { category: p.category } });
  const perks: EventPerk[] = [...(p.food ? (["FREE_FOOD"] as const) : []), ...(p.stuff ? (["FREE_STUFF"] as const) : [])];
  if (perks.length) and.push({ perks: { hasSome: perks } });
  if (p.service) and.push({ serviceMinutes: { gt: 0 } });
  if (p.online) and.push({ OR: [{ locationType: "VIRTUAL" }, { locationType: { in: ["CAMPUS", "ADDRESS"] }, virtualUrl: { not: null } }] });
  if (p.following) {
    const ids = viewer.followedClubIds;
    and.push({ OR: [{ clubId: { in: ids } }, { cohosts: { some: { status: "APPROVED", clubId: { in: ids } } } }] });
  }
  if (matchIds) and.push({ id: { in: matchIds } });
  return and.length ? { AND: and } : {};
}
