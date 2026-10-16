import "server-only";
import { db } from "@/lib/db";
import type { ElectionResults } from "@/lib/domain/elections";

/**
 * Read models for election pages. Candidates and counts only — nothing here
 * touches who voted for whom.
 */

export type CandidateView = {
  id: string;
  userId: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  avatarColor: string;
  statement: string | null;
  nominatedBy: { id: string; name: string };
  createdAt: Date;
};

export async function electionCandidates(electionId: string): Promise<CandidateView[]> {
  const rows = await db.electionCandidate.findMany({
    where: { electionId },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, name: true, handle: true, avatarUrl: true, avatarColor: true } },
      nominatedBy: { select: { id: true, name: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    userId: c.userId,
    name: c.user.name,
    handle: c.user.handle,
    avatarUrl: c.user.avatarUrl,
    avatarColor: c.user.avatarColor,
    statement: c.statement,
    nominatedBy: c.nominatedBy,
    createdAt: c.createdAt,
  }));
}

/** Results joined with candidate names for display. */
export function resultRows(results: ElectionResults, candidates: CandidateView[], winnerUserId: string | null) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const tied = results.leaders.length > 1;
  return results.rows.map((r) => {
    const c = byId.get(r.candidateId);
    return {
      candidateId: r.candidateId,
      name: c?.name ?? "Former candidate",
      avatarUrl: c?.avatarUrl ?? null,
      avatarColor: c?.avatarColor ?? "#77707f",
      votes: r.votes,
      share: r.share,
      winner: winnerUserId ? r.userId === winnerUserId : !tied && results.leaders[0] === r.candidateId && r.votes > 0,
      tied: !winnerUserId && tied && results.leaders.includes(r.candidateId),
    };
  });
}

/** Elections of a club, newest first, with candidate and ballot counts (no choices). */
export async function clubElections(clubId: string) {
  return db.election.findMany({
    where: { clubId },
    orderBy: [{ createdAt: "desc" }],
    include: {
      position: { select: { id: true, name: true, role: true } },
      _count: { select: { candidates: true, votes: true } },
    },
  });
}
