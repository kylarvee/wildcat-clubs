import "server-only";
import type { ClubRole, RoleEndReason } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, isAdmin, ROLE_LABEL } from "@/lib/authz";
import { END_REASON_LABEL } from "@/lib/roles/labels";
import type { PublicAction } from "@/lib/lake/actions";

/**
 * A person's public activity, as plain sentences for their profile:
 * "Joined Wildcat Robotics", "Became Treasurer of Finance & Investment Club",
 * "Reviewed Psychology Club", "Graduated from Weber State".
 *
 * Reads only ActivityLog rows marked public, and only rows *about* the person
 * (not things they did to other people's records). Check-ins follow the
 * attendance privacy rule: only the person, their club's attendance holders
 * and advisors, and admins see them. Clubs still in founding show only to the
 * person themself and admins.
 *
 * The actions it reads are typed against lib/lake/actions: only actions that
 * are public by default there can be listed, since this feed reads public rows.
 */

export type ActivityPart = string | { href: string; label: string };
export type ActivityKind = "joined" | "role" | "roleEnded" | "election" | "review" | "checkin" | "project" | "graduated";
export type ActivityItem = { id: string; at: Date; kind: ActivityKind; parts: ActivityPart[]; rating?: number; note?: string };

type Row = {
  id: bigint;
  at: Date;
  action: string;
  entityId: string;
  clubId: string | null;
  data: unknown;
  club: { name: string; slug: string; status: string } | null;
};

/** Things the person did themself. */
const SELF_ACTIONS: PublicAction[] = ["membership.joined", "review.created", "attendance.checkin"];
/** Things that happened to them (data.userId is the person), whoever did them. */
const ABOUT_ACTIONS: PublicAction[] = ["role.assigned", "role.ended", "project.added", "user.graduated"];
const WON: PublicAction = "election.applied";
const APPROVED: PublicAction = "membership.approved";
const LISTED = new Set(["APPROVED", "RETIRED"]);
const NEAR_MS = 2 * 60_000;

function d(row: Row): Record<string, unknown> {
  return row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : {};
}
const str = (v: unknown) => (typeof v === "string" ? v : null);

export async function profileActivity(
  person: { id: string; status: string },
  viewer: Actor,
  opts: { take?: number } = {},
): Promise<{ items: ActivityItem[]; hasMore: boolean }> {
  const take = opts.take ?? 12;
  const isSelf = viewer.id === person.id;
  const admin = isAdmin(viewer);

  const [memberships, roles, projects] = await Promise.all([
    db.membership.findMany({ where: { userId: person.id }, select: { id: true } }),
    db.roleAssignment.findMany({ where: { userId: person.id }, select: { id: true, role: true, position: { select: { name: true } } } }),
    db.project.findMany({ where: { userId: person.id }, select: { id: true, roleAssignmentId: true } }),
  ]);
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const projectIds = new Set(projects.map((p) => p.id));

  const rows: Row[] = await db.activityLog.findMany({
    where: {
      isPublic: true,
      OR: [
        { actorId: person.id, action: { in: SELF_ACTIONS } },
        ...ABOUT_ACTIONS.map((action) => ({ action, data: { path: ["userId"], equals: person.id } })),
        { action: WON, data: { path: ["winnerId"], equals: person.id } },
        ...(memberships.length ? [{ action: APPROVED, entityId: { in: memberships.map((m) => m.id) } }] : []),
      ],
    },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: Math.min(400, take * 4 + 20),
    select: { id: true, at: true, action: true, entityId: true, clubId: true, data: true, club: { select: { name: true, slug: true, status: true } } },
  });

  // Hidden reviews never show; neither do contributions that were removed.
  const reviewIds = rows.filter((r) => r.action === "review.created").map((r) => r.entityId);
  const hiddenReviews = new Set(
    reviewIds.length ? (await db.review.findMany({ where: { id: { in: reviewIds }, hiddenAt: { not: null } }, select: { id: true } })).map((r) => r.id) : [],
  );
  const reviewsLeft = new Set(reviewIds.length ? (await db.review.findMany({ where: { id: { in: reviewIds } }, select: { id: true } })).map((r) => r.id) : []);

  const canSeeCheckins = new Map<string | null, boolean>();
  async function checkinsVisible(clubId: string | null) {
    if (isSelf || admin) return true;
    if (!clubId) return false;
    if (!canSeeCheckins.has(clubId)) canSeeCheckins.set(clubId, Boolean((await getClubAccess(viewer, clubId))?.capabilities.has("attendance")));
    return canSeeCheckins.get(clubId)!;
  }

  const clubLink = (r: Row): ActivityPart => (r.club ? { href: `/clubs/${r.club.slug}`, label: r.club.name } : "a club");
  const near = (a: Row, action: string, pred: (b: Row) => boolean = () => true) =>
    rows.some((b) => b !== a && b.action === action && b.clubId === a.clubId && Math.abs(b.at.getTime() - a.at.getTime()) <= NEAR_MS && pred(b));
  const seatName = (role: ClubRole, assignmentId: string, fallback?: string | null) => roleById.get(assignmentId)?.position?.name ?? fallback ?? ROLE_LABEL[role];

  const items: ActivityItem[] = [];
  for (const r of rows) {
    if (items.length > take) break;
    if (r.club && !LISTED.has(r.club.status) && !isSelf && !admin) continue;
    const data = d(r);
    const base = { id: String(r.id), at: r.at };
    switch (r.action) {
      case "membership.joined":
      case "membership.approved":
        items.push({ ...base, kind: "joined", parts: ["Joined ", clubLink(r)] });
        break;
      case "role.assigned": {
        const role = (str(data.role) ?? "MEMBER") as ClubRole;
        if (role === "MEMBER") break;
        const seat = seatName(role, r.entityId, str(data.position));
        const election = rows.find((b) => b.action === "election.applied" && b.clubId === r.clubId && Math.abs(b.at.getTime() - r.at.getTime()) <= NEAR_MS && str(d(b).winnerId) === person.id);
        const parts: ActivityPart[] = role === "ADVISOR" ? ["Became an advisor of ", clubLink(r)] : [`Became ${seat} of `, clubLink(r)];
        items.push({ ...base, kind: "role", parts, note: election ? `Won the election: ${str(d(election).title) ?? seat}` : undefined });
        break;
      }
      case "election.applied":
        // Folded into the role it gave them when the two happened together.
        if (near(r, "role.assigned", (b) => str(d(b).userId) === person.id)) break;
        items.push({ ...base, kind: "election", parts: [`Won the election for ${str(data.title) ?? "a seat"} in `, clubLink(r)] });
        break;
      case "role.ended": {
        const role = (str(data.role) ?? "MEMBER") as ClubRole;
        const reason = str(data.reason) as RoleEndReason | null;
        if (role === "MEMBER") break;
        // A hand-off to a bigger seat reads as the new role, not an ending.
        if (reason === "SUCCEEDED" && near(r, "role.assigned", (b) => str(d(b).userId) === person.id)) break;
        if (reason === "GRADUATED" && rows.some((b) => b.action === "user.graduated" && Math.abs(b.at.getTime() - r.at.getTime()) <= NEAR_MS)) break;
        const seat = seatName(role, r.entityId);
        items.push({ ...base, kind: "roleEnded", parts: [`Finished as ${seat} of `, clubLink(r)], note: reason ? END_REASON_LABEL[reason] : undefined });
        break;
      }
      case "review.created": {
        if (hiddenReviews.has(r.entityId) || !reviewsLeft.has(r.entityId)) break;
        const rating = typeof data.rating === "number" ? data.rating : undefined;
        items.push({ ...base, kind: "review", parts: ["Reviewed ", clubLink(r)], rating });
        break;
      }
      case "attendance.checkin": {
        if (!(await checkinsVisible(r.clubId))) break;
        const title = str(data.title) ?? "an event";
        const eventId = str(data.eventId);
        const occ = str(data.occurrenceId);
        const event: ActivityPart = eventId ? { href: `/events/${eventId}${occ ? `?o=${occ}` : ""}`, label: title } : title;
        items.push({ ...base, kind: "checkin", parts: r.club ? ["Checked in to ", event, " with ", clubLink(r)] : ["Checked in to ", event] });
        break;
      }
      case "project.added": {
        if (!projectIds.has(r.entityId)) break;
        const title = str(data.title) ?? "a project";
        const roleId = str(data.roleAssignmentId);
        const role = roleId ? roleById.get(roleId) : null;
        const parts: ActivityPart[] = role ? [`Added “${title}” to their ${role.position?.name ?? ROLE_LABEL[role.role]} role in `, clubLink(r)] : [`Added a project: “${title}”`];
        items.push({ ...base, kind: "project", parts });
        break;
      }
      case "user.graduated":
        items.push({ ...base, kind: "graduated", parts: ["Graduated from Weber State"] });
        break;
    }
  }
  return { items: items.slice(0, take), hasMore: items.length > take };
}
