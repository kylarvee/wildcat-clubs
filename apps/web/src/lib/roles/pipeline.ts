import type { ClubRole, ClubType, SuccessionMethod } from "@prisma/client";

/**
 * The leadership pipeline: the pure rules behind the four ways a club fills a
 * seat (lib/domain/elections). No database access, so they're easy to test
 * and safe to import anywhere, client components included.
 *
 * A club's seats in pipeline order are President, then Vice President, then
 * officer seats (in their order on the chart), then ambassador seats; members
 * sit below. In clubs that aren't College Ambassadors orgs, ambassador seats
 * belong to the college's ambassador program: the club doesn't fill them, and
 * the ambassadors the college places aren't next in line for the club's own
 * seats.
 */

/** The four modes, in the order the builder and the forms list them. ADVISOR_PRESIDENT is the default. */
export const SUCCESSION_METHODS: SuccessionMethod[] = ["ADVISOR_PRESIDENT", "NEXT_IN_LINE", "SELF_SELECT", "MEMBER_VOTE"];
export const DEFAULT_SUCCESSION: SuccessionMethod = "ADVISOR_PRESIDENT";

export function isSuccessionMethod(v: unknown): v is SuccessionMethod {
  return typeof v === "string" && (SUCCESSION_METHODS as string[]).includes(v);
}

/** Modes decided by secret ballot (the others have no ballots at all). */
export function usesBallots(method: SuccessionMethod) {
  return method === "MEMBER_VOTE" || method === "SELF_SELECT";
}

/** Who can add candidates beyond the pipeline: members run themselves only in a member vote; organizers add anyone except in next-in-line rounds. */
export function canSelfNominate(method: SuccessionMethod) {
  return method === "MEMBER_VOTE";
}
export function organizersAddCandidates(method: SuccessionMethod) {
  return method !== "NEXT_IN_LINE";
}

const TIER: Partial<Record<ClubRole, number>> = { PRESIDENT: 0, VP: 1, OFFICER: 2, AMBASSADOR: 3 };

/** Position of a role's tier in the pipeline (President 0 … ambassadors 3); anything else sits below. */
export function tierOf(role: ClubRole): number {
  return TIER[role] ?? 99;
}

/** Whether seats of this role are filled through the club's own pipeline. */
export function inClubPipeline(role: ClubRole, clubType: ClubType): boolean {
  if (role === "AMBASSADOR") return clubType === "COLLEGE_AMBASSADORS";
  return role === "PRESIDENT" || role === "VP" || role === "OFFICER";
}

export type PipelineHolder = { userId: string; assignmentId: string; startedAt: Date };
export type PipelineSeat = { id: string; role: ClubRole; name: string; sortOrder: number; holders: PipelineHolder[] };
/** Someone on the pipeline, at their highest seat. */
export type PipelinePerson = { userId: string; assignmentId: string; seatId: string; seatName: string; role: ClubRole; startedAt: Date };

/** Seats in pipeline order: tier, then the seat's order on the chart, then name. */
export function pipelineOrder<T extends { role: ClubRole; sortOrder: number; name: string }>(seats: T[]): T[] {
  return [...seats].sort((a, b) => tierOf(a.role) - tierOf(b.role) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Everyone on the club's pipeline in order, each person once, at their highest seat (co-holders: longest in the seat first). */
export function pipelinePeople(seats: PipelineSeat[], clubType: ClubType): PipelinePerson[] {
  const out: PipelinePerson[] = [];
  const seen = new Set<string>();
  for (const s of pipelineOrder(seats.filter((x) => inClubPipeline(x.role, clubType)))) {
    for (const h of [...s.holders].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) {
      if (seen.has(h.userId)) continue;
      seen.add(h.userId);
      out.push({ userId: h.userId, assignmentId: h.assignmentId, seatId: s.id, seatName: s.name, role: s.role, startedAt: h.startedAt });
    }
  }
  return out;
}

/**
 * The current leaders below a seat, in pipeline order: the people whose
 * highest seat is in a lower tier. Anyone already in this tier or above
 * isn't below it (another officer isn't "below" the Treasurer).
 */
export function leadersBelow(seats: PipelineSeat[], seatId: string, clubType: ClubType): PipelinePerson[] {
  const seat = seats.find((s) => s.id === seatId);
  if (!seat) return [];
  const tier = tierOf(seat.role);
  return pipelinePeople(seats, clubType).filter((p) => tierOf(p.role) > tier);
}

/**
 * Next in line for a seat: the people in the first tier below it that has
 * anyone in it — for President the Vice Presidents, for a Vice President the
 * officers, and so on — in pipeline order. Empty when nobody sits below.
 */
export function nextInLine(seats: PipelineSeat[], seatId: string, clubType: ClubType): PipelinePerson[] {
  const below = leadersBelow(seats, seatId, clubType);
  if (!below.length) return [];
  const tier = tierOf(below[0].role);
  return below.filter((p) => tierOf(p.role) === tier);
}

/** Who a new selection adds as candidates automatically: only the next in line for NEXT_IN_LINE, every leader below the seat otherwise. */
export function pipelineCandidates(seats: PipelineSeat[], seatId: string, clubType: ClubType, method: SuccessionMethod): PipelinePerson[] {
  return method === "NEXT_IN_LINE" ? nextInLine(seats, seatId, clubType) : leadersBelow(seats, seatId, clubType);
}

/**
 * NEXT_IN_LINE: the first person, in pipeline order, who said yes. Candidates
 * come in the order they were asked, which is pipeline order (seat order,
 * then earliest start in their current seat).
 */
export function firstToAccept<T extends { acceptedAt: Date | null }>(candidatesInOrder: T[]): T | null {
  return candidatesInOrder.find((c) => c.acceptedAt) ?? null;
}

/**
 * SELF_SELECT counts only when it's unanimous: every eligible leader voted,
 * all for the same candidate. Nobody votes for themselves, so when the choice
 * is one of the leaders, theirs is the one ballot that can't be cast.
 * Returns the chosen candidate's id, or null when the leaders didn't agree.
 * Takes who voted and the counts separately — never who voted for whom.
 */
export function unanimousChoice(input: { eligibleVoterIds: string[]; voterIds: string[]; tally: { candidateId: string; userId: string; votes: number }[] }): string | null {
  const chosen = input.tally.filter((t) => t.votes > 0);
  if (chosen.length !== 1) return null;
  const choice = chosen[0];
  const voted = new Set(input.voterIds);
  const everyoneElse = input.eligibleVoterIds.filter((id) => id !== choice.userId);
  return everyoneElse.every((id) => voted.has(id)) ? choice.candidateId : null;
}

export type KeyHolders = { presidentIds: string[]; advisorIds: string[] };

/** ADVISOR_PRESIDENT: the people who propose and confirm (admins may also act; callers check that). */
export function isKeyHolder(userId: string, keys: KeyHolders) {
  return keys.presidentIds.includes(userId) || keys.advisorIds.includes(userId);
}

/**
 * ADVISOR_PRESIDENT: who may confirm a proposal (besides admins, who always
 * may). The other side confirms: an advisor confirms the President's
 * proposal, the President confirms an advisor's. If the club has no advisor,
 * the President alone may (their own proposal included); if it has no
 * President, an advisor alone may. The person proposed for President never
 * confirms it, so for a President seat they don't count as the club's
 * President here — if they're its only President, an advisor decides alone.
 */
export function confirmersFor(p: KeyHolders & { proposerId: string; candidateUserId: string; seatRole: ClubRole }): string[] {
  const presidents = p.seatRole === "PRESIDENT" ? p.presidentIds.filter((id) => id !== p.candidateUserId) : p.presidentIds;
  const advisors = p.advisorIds;
  if (p.presidentIds.includes(p.proposerId)) return advisors.length ? advisors : presidents;
  if (advisors.includes(p.proposerId)) return presidents.length ? presidents : advisors;
  // An admin (or someone who has since left the seat) proposed: either side confirms.
  return [...new Set([...presidents, ...advisors])];
}
