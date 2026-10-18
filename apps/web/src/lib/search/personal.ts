import "server-only";
import { db } from "@/lib/db";
import { majorMatch, type PersonalSignals } from "./rank";

/**
 * The viewer's own signals for every club in a list, in three queries total
 * (their majors, co-members' clubs, their check-ins). Membership and calendar
 * follows come from viewerClubStates, which the list already loaded.
 *
 * Co-members: people (active student accounts) who share an active club with
 * the viewer. For each club we count those who are active members of it,
 * through some *other* shared club, so a club's own roster never counts
 * toward itself. Lift compares that share of the club's members with the
 * share of all students who are the viewer's co-members: 2 means the club is
 * twice as full of "people from your clubs" as chance. Only counts leave
 * this module.
 */

export type ClubFacetsForViewer = {
  id: string;
  focusMajorId: string | null;
  focusMajorDepartmentId: string | null;
  departmentId: string | null;
  /** The club's college, or its department's or focus major's. */
  collegeId: string | null;
};

type State = { member: boolean; pending: boolean; subscribed: boolean; leader: boolean };

export async function personalSignals(viewerId: string, clubs: ClubFacetsForViewer[], states: Map<string, State>): Promise<Map<string, PersonalSignals>> {
  const [majors, peers, attended] = await Promise.all([
    db.userMajor.findMany({
      where: { userId: viewerId },
      select: { isMinor: true, major: { select: { id: true, name: true, departmentId: true, collegeId: true, college: { select: { shortName: true } }, department: { select: { collegeId: true } } } } },
    }),
    db.$queryRaw<{ club_id: string | null; n: number; members: number; peers_total: number; students: number }[]>`
      WITH peers AS (
        SELECT x."clubId" AS club_id, count(DISTINCT x."userId")::int AS n
          FROM "Membership" mine
          JOIN "Membership" p ON p."clubId" = mine."clubId" AND p.status = 'ACTIVE' AND p."userId" <> ${viewerId}
          JOIN "User" u ON u.id = p."userId" AND u.kind = 'STUDENT' AND u.status = 'ACTIVE'
          JOIN "Membership" x ON x."userId" = p."userId" AND x.status = 'ACTIVE' AND x."clubId" <> mine."clubId"
         WHERE mine."userId" = ${viewerId} AND mine.status = 'ACTIVE'
         GROUP BY x."clubId"
      ),
      sizes AS (
        SELECT m."clubId" AS club_id, count(*)::int AS members
          FROM "Membership" m JOIN "User" u ON u.id = m."userId" AND u.kind = 'STUDENT' AND u.status = 'ACTIVE'
         WHERE m.status = 'ACTIVE' AND m."clubId" IN (SELECT club_id FROM peers)
         GROUP BY m."clubId"
      ),
      totals AS (
        SELECT (SELECT count(DISTINCT p."userId")::int
                  FROM "Membership" mine
                  JOIN "Membership" p ON p."clubId" = mine."clubId" AND p.status = 'ACTIVE' AND p."userId" <> ${viewerId}
                  JOIN "User" u ON u.id = p."userId" AND u.kind = 'STUDENT' AND u.status = 'ACTIVE'
                 WHERE mine."userId" = ${viewerId} AND mine.status = 'ACTIVE') AS peers_total,
               (SELECT count(*)::int FROM "User" WHERE kind = 'STUDENT' AND status = 'ACTIVE') AS students
      )
      SELECT peers.club_id, peers.n, COALESCE(sizes.members, 0) AS members, totals.peers_total, totals.students
        FROM peers LEFT JOIN sizes ON sizes.club_id = peers.club_id CROSS JOIN totals`,
    db.attendance.groupBy({ by: ["clubId"], where: { userId: viewerId, clubId: { not: null } }, _count: { _all: true } }),
  ]);
  const viewerMajors = majors.map((m) => ({
    id: m.major.id,
    name: m.major.name,
    minor: m.isMinor,
    departmentId: m.major.departmentId,
    collegeId: m.major.collegeId ?? m.major.department?.collegeId ?? null,
    collegeName: m.major.college?.shortName ?? null,
  }));
  // Share of all students who are the viewer's co-members: what a club's share would be by chance.
  const baseline = peers.length && peers[0].students ? peers[0].peers_total / peers[0].students : 0;
  const peersBy = new Map(peers.filter((r) => r.club_id).map((r) => [r.club_id!, { n: r.n, lift: baseline && r.members ? r.n / r.members / baseline : 0 }]));
  const attendedBy = new Map(attended.map((r) => [r.clubId!, r._count._all]));

  const out = new Map<string, PersonalSignals>();
  for (const c of clubs) {
    const s = states.get(c.id);
    out.set(c.id, {
      majorMatch: viewerMajors.length ? majorMatch(viewerMajors, c) : null,
      peers: peersBy.get(c.id)?.n ?? 0,
      peerLift: peersBy.get(c.id)?.lift ?? 0,
      attended: attendedBy.get(c.id) ?? 0,
      subscribed: Boolean(s?.subscribed),
      member: Boolean(s?.member || s?.pending || s?.leader),
    });
  }
  return out;
}
