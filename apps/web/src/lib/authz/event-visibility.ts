import type { Prisma } from "@prisma/client";
import { UNDER_REVIEW } from "@/lib/events/review";

/**
 * The event-visibility rule as a Prisma filter: pure, with type-only Prisma
 * imports, so lib/authz/events (the authority, which also answers for one
 * event) and the seed's checks (prisma/seed/verify.ts) run the very same
 * filter. See lib/authz/events for the rule in words.
 */

const LISTED_CLUB_STATUSES = ["APPROVED", "RETIRED"] as const;

/** Published: never reviewed, or approved. Everything lists only these unless it asks for events under review. */
export const PUBLISHED_EVENT: Prisma.EventWhereInput = { reviewStatus: { notIn: [...UNDER_REVIEW] } };

/** Who's looking, as the rule reads it. */
export type EventViewer = {
  signedIn: boolean;
  /** WSUSA's admins (platform ADMIN or SYSADMIN): every event. */
  admin: boolean;
  /** Clubs where the viewer is an active member or holds a role (their members-only events). */
  memberClubIds: string[];
  /** Clubs the viewer leads (Ambassador and up, or advises): their events waiting for review. */
  leaderClubIds?: string[];
  /** Offices the viewer staffs (lib/offices): their clubs' events, members-only and waiting for review included. */
  officeIds?: string[];
};

/**
 * Prisma filter for the events a viewer may see.
 * `includeMembersOnly: false` leaves MEMBERS events out entirely (public listings).
 * `underReview: true` also lets in events waiting for review, for the club's
 * leaders and its office (left out: published events only, for everyone).
 */
export function eventVisibilityWhere(viewer: EventViewer, opts: { includeMembersOnly?: boolean; underReview?: boolean } = {}): Prisma.EventWhereInput {
  if (viewer.admin) return opts.underReview ? {} : PUBLISHED_EVENT;
  const officeClubs: Prisma.EventWhereInput[] = viewer.officeIds?.length ? [{ club: { officeId: { in: viewer.officeIds } } }] : [];
  const leaderClubs: Prisma.EventWhereInput[] = viewer.leaderClubIds?.length ? [{ clubId: { in: viewer.leaderClubIds } }] : [];
  const review: Prisma.EventWhereInput = opts.underReview && (officeClubs.length || leaderClubs.length) ? { OR: [PUBLISHED_EVENT, ...leaderClubs, ...officeClubs] } : PUBLISHED_EVENT;
  const listedClub: Prisma.EventWhereInput = { OR: [{ clubId: null }, { club: { status: { in: [...LISTED_CLUB_STATUSES] } } }] };
  if (!viewer.signedIn) return { AND: [listedClub, { visibility: "PUBLIC" }, review] };
  const open: Prisma.EventWhereInput[] = [{ visibility: { in: ["PUBLIC", "UNIVERSITY"] } }, { visibility: "MEMBERS", clubId: null }];
  const members: Prisma.EventWhereInput[] =
    opts.includeMembersOnly === false
      ? []
      : [
          { visibility: "MEMBERS", clubId: { in: viewer.memberClubIds } },
          { visibility: "MEMBERS", cohosts: { some: { status: "APPROVED", clubId: { in: viewer.memberClubIds } } } },
          // An office's staff, like an advisor, see their clubs' members-only events.
          ...officeClubs.map((w) => ({ ...w, visibility: "MEMBERS" as const })),
        ];
  return { AND: [listedClub, { OR: [...open, ...members] }, review] };
}

export const LISTED_EVENT_CLUB_STATUSES: readonly string[] = LISTED_CLUB_STATUSES;
