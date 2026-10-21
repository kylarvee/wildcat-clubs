import "server-only";
import type { EventReview, EventRisk } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { adminClubWhere, adminScope } from "@/lib/authz";
import { listOffices } from "@/lib/offices";
import { locationText, VISIBILITY_LABEL } from "@/lib/events/labels";
import { readTravel, type TravelPlan } from "@/lib/events/review";
import { describeSchedule } from "@/lib/events/summary";
import { richToText } from "@/lib/rich/sanitize";

/**
 * The Event reviews page's read model (/admin/events): the club events waiting
 * on the viewer's office (lib/authz adminClubWhere: WSUSA's admins see every
 * office's, an office's staff their own), and the ones sent back to their
 * clubs. Each has what the reviewer needs in one place: what it involves, the
 * trip, when and where, the host club and who to contact. The office's queue
 * (its APPROVAL tasks) is the to-do list; this is where the decision is made
 * (lib/domain/events approveEventReview, requestEventChanges). Callers check
 * can(actor, "admin.events") first.
 */

export type ReviewContact = { name: string; email: string; role: string };

export type ReviewItem = {
  id: string;
  title: string;
  status: EventReview;
  flags: EventRisk[];
  travel: TravelPlan | null;
  /** "Saturday, Nov 7, 2026 · 9:00 AM", or the repeat rule. */
  when: string;
  meetings: number;
  firstStartsAt: Date | null;
  place: string;
  visibility: string;
  description: string | null;
  club: { id: string; name: string; slug: string; logoColor: string; logoUrl: string | null; contactEmail: string | null };
  /** Shown to WSUSA's admins: whose review it is. */
  office: string;
  /** In the viewer's own office's queue (WSUSA's admins also see, and may decide, other offices'). */
  ownQueue: boolean;
  cohosts: string[];
  contacts: ReviewContact[];
  /** When it was sent (or sent back) for review, and by whom. */
  sentAt: Date;
  sentBy: string | null;
  /** The office's last note (when it asked for changes, or approved before). */
  note: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
};

const SEAT_LABEL: Record<string, string> = { PRESIDENT: "President", VP: "Vice President", ADVISOR: "Advisor" };

export async function eventReviewQueue(actor: Actor): Promise<{ toReview: ReviewItem[]; sentBack: ReviewItem[]; umbrella: boolean }> {
  const now = new Date();
  const umbrella = adminScope(actor).all;
  const rows = await db.event.findMany({
    where: { reviewStatus: { in: ["PENDING", "CHANGES_REQUESTED"] }, status: "SCHEDULED", club: { ...adminClubWhere(actor), status: "APPROVED" } },
    orderBy: [{ startsAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 200,
    include: {
      club: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoColor: true,
          logoUrl: true,
          contactEmail: true,
          officeId: true,
          roleAssignments: { where: { endedAt: null, role: { in: ["PRESIDENT", "VP", "ADVISOR"] } }, select: { role: true, user: { select: { name: true, email: true } } } },
        },
      },
      building: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
      reviewedBy: { select: { name: true } },
      cohosts: { where: { status: { in: ["APPROVED", "PENDING"] } }, select: { club: { select: { name: true } } } },
      occurrences: { where: { status: "SCHEDULED", endsAt: { gte: now } }, orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true, endsAt: true } },
      _count: { select: { occurrences: true } },
    },
  });
  const ids = rows.map((r) => r.id);
  const [sends, offices] = await Promise.all([
    ids.length
      ? db.activityLog.findMany({ where: { action: "event.review_requested", entityType: "event", entityId: { in: ids } }, orderBy: { at: "desc" }, select: { entityId: true, at: true, actor: { select: { name: true } } } })
      : [],
    listOffices(),
  ]);
  const lastSend = new Map<string, { at: Date; by: string | null }>();
  for (const s of sends) if (!lastSend.has(s.entityId)) lastSend.set(s.entityId, { at: s.at, by: s.actor?.name ?? null });
  const officeName = (id: string | null) => offices.find((o) => (id ? o.id === id : o.umbrella))?.name ?? "WSUSA";

  const items = rows.map((e): ReviewItem => {
    const club = e.club!;
    const next = e.occurrences[0] ?? null;
    const start = next?.startsAt ?? e.startsAt;
    const contacts: ReviewContact[] = [{ name: e.createdBy.name, email: e.createdBy.email, role: "Created the event" }];
    for (const a of [...club.roleAssignments].sort((x, y) => ["PRESIDENT", "VP", "ADVISOR"].indexOf(x.role) - ["PRESIDENT", "VP", "ADVISOR"].indexOf(y.role))) {
      if (!contacts.some((c) => c.email === a.user.email)) contacts.push({ name: a.user.name, email: a.user.email, role: SEAT_LABEL[a.role] ?? a.role });
    }
    const sent = lastSend.get(e.id);
    return {
      id: e.id,
      title: e.title,
      status: e.reviewStatus,
      flags: e.riskFlags,
      travel: readTravel(e.travel),
      when: start
        ? describeSchedule({ startsAt: e.recurrence === "NONE" ? start : (e.startsAt ?? start), recurrence: e.recurrence, interval: e.recurrenceInterval, weekdays: e.recurrenceWeekdays, until: e.recurrenceUntil, count: e.recurrenceCount, allDay: e.allDay })
        : "No date yet",
      meetings: e._count.occurrences,
      firstStartsAt: start ?? null,
      place: locationText(e),
      visibility: VISIBILITY_LABEL[e.visibility],
      description: richToText(e.descriptionHtml, 400) || null,
      club: { id: club.id, name: club.name, slug: club.slug, logoColor: club.logoColor, logoUrl: club.logoUrl, contactEmail: club.contactEmail },
      office: officeName(club.officeId),
      ownQueue: club.officeId === null ? umbrella : (actor.officeIds ?? []).includes(club.officeId),
      cohosts: e.cohosts.map((c) => c.club.name),
      contacts,
      sentAt: sent?.at ?? e.updatedAt,
      sentBy: sent?.by ?? null,
      note: e.reviewNote,
      reviewedAt: e.reviewedAt,
      reviewedBy: e.reviewedBy?.name ?? null,
    };
  });
  return { toReview: items.filter((i) => i.status === "PENDING"), sentBack: items.filter((i) => i.status === "CHANGES_REQUESTED"), umbrella };
}
