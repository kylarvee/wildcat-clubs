import "server-only";
import type { SuccessionMethod } from "@prisma/client";
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
  /** Added automatically from the org chart (the leadership pipeline). */
  fromPipeline: boolean;
  /** Next in line: when they said yes to moving up (null = hasn't answered). */
  acceptedAt: Date | null;
  createdAt: Date;
};

/** Candidates in the order they were added — for pipeline candidates, pipeline order. */
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
    fromPipeline: c.fromPipeline,
    acceptedAt: c.acceptedAt,
    createdAt: c.createdAt,
  }));
}

/** How a candidate came to be on the list, in a few words. */
export function candidateSource(c: Pick<CandidateView, "userId" | "fromPipeline" | "nominatedBy">) {
  if (c.fromPipeline) return "From the org chart";
  return c.nominatedBy.id === c.userId ? "Self-nominated" : `Added by ${c.nominatedBy.name}`;
}

/**
 * Results joined with candidate names for display. A self-select has a
 * winner only when it was unanimous (and never a "tie" to break); a member
 * vote that missed the bylaws' quorum has neither a winner nor a tie.
 */
export function resultRows(results: ElectionResults, candidates: CandidateView[], winnerUserId: string | null, method: SuccessionMethod = "MEMBER_VOTE") {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const selfSelect = method === "SELF_SELECT";
  const noQuorum = Boolean(results.quorum && !results.quorum.met);
  const tied = !selfSelect && !noQuorum && results.leaders.length > 1;
  return results.rows.map((r) => {
    const c = byId.get(r.candidateId);
    return {
      candidateId: r.candidateId,
      name: c?.name ?? "Former candidate",
      avatarUrl: c?.avatarUrl ?? null,
      avatarColor: c?.avatarColor ?? "#77707f",
      votes: r.votes,
      share: r.share,
      winner: winnerUserId ? r.userId === winnerUserId : selfSelect ? results.unanimousCandidateId === r.candidateId : !noQuorum && !tied && results.leaders[0] === r.candidateId && r.votes > 0,
      tied: !winnerUserId && tied && results.leaders.includes(r.candidateId),
    };
  });
}

/** Elections of a club, newest first, with candidate and ballot counts (no choices). */
export async function clubElections(clubId: string, opts: { positionId?: string } = {}) {
  return db.election.findMany({
    where: { clubId, ...(opts.positionId ? { positionId: opts.positionId } : {}) },
    orderBy: [{ createdAt: "desc" }],
    include: {
      position: { select: { id: true, name: true, role: true } },
      _count: { select: { candidates: true, votes: true } },
    },
  });
}
