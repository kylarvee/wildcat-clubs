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

// ─── The club's bylaw rules (member votes) ───────────────────────────────────

/** How a tied member vote is settled: the choices in the bylaws' Voting Procedures (lib/constitution/templates). */
export const TIE_BREAKS = ["RUNOFF", "ADVISOR", "PRESIDENT"] as const;
export type TieBreak = (typeof TIE_BREAKS)[number];

export function isTieBreak(v: unknown): v is TieBreak {
  return typeof v === "string" && (TIE_BREAKS as readonly string[]).includes(v);
}

/**
 * The club's bylaw rules a selection froze when it started (Election.rules),
 * so a later amendment never changes a vote already under way. null means
 * the bylaws don't set it (or the club has no builder bylaws in effect), and
 * the platform's default applies: active members vote, any turnout counts,
 * whoever applies the result settles a tie, and voting may open any time.
 */
export type SelectionRules = {
  /** Member vote: club events attended this term (counted when voting opens) to vote. */
  minEvents: number | null;
  /** Member vote: the share of eligible voters (1–100) who must vote for the result to count. */
  quorumPercent: number | null;
  /** Member vote: how a tie is settled. */
  tieBreak: TieBreak | null;
  /** Member vote: days between announcing it and the earliest voting may open. */
  noticeDays: number | null;
  /** A runoff: the tied member vote it settles. */
  runoffOf: string | null;
};

export const NO_SELECTION_RULES: SelectionRules = { minEvents: null, quorumPercent: null, tieBreak: null, noticeDays: null, runoffOf: null };

const whole = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** Tolerant reader for Election.rules (selections started before rules were recorded hold {}). Never throws. */
export function readSelectionRules(json: unknown): SelectionRules {
  if (!json || typeof json !== "object" || Array.isArray(json)) return NO_SELECTION_RULES;
  const r = json as Record<string, unknown>;
  return {
    minEvents: whole(r.minEvents, 1, 100),
    quorumPercent: whole(r.quorumPercent, 1, 100),
    tieBreak: isTieBreak(r.tieBreak) ? r.tieBreak : null,
    noticeDays: whole(r.noticeDays, 1, 365),
    runoffOf: typeof r.runoffOf === "string" && r.runoffOf ? r.runoffOf : null,
  };
}

/** What Election.rules stores: the four bylaw rules (null when unset), plus the tied vote a runoff settles. */
export function selectionRulesJson(r: SelectionRules): Record<string, string | number | null> {
  return { minEvents: r.minEvents, quorumPercent: r.quorumPercent, tieBreak: r.tieBreak, noticeDays: r.noticeDays, ...(r.runoffOf ? { runoffOf: r.runoffOf } : {}) };
}

/** Member vote with an attendance rule: a member votes when they'd attended at least `minEvents` club events this term by the time voting opened. */
export function meetsAttendance(attended: number, minEvents: number): boolean {
  return attended >= minEvents;
}

export type VoterRollRow = { userId: string; attended: number; eligible: boolean };

/**
 * Who votes in a selection, and why (`basis`), as lib/domain/elections
 * voterRoll gathers it:
 *   leaders     SELF_SELECT: the club's current student leaders.
 *   attendance  MEMBER_VOTE under the bylaws' attendance requirement:
 *               registered members who'd been to at least `minEvents` of
 *               the club's events this term when voting opened (before it
 *               opens, so far). Every member gets a row with their count.
 *   active      MEMBER_VOTE with no attendance requirement: active members
 *               per lib/metrics, or every registered member when the club
 *               has no attendance yet.
 *   none        NEXT_IN_LINE, ADVISOR_PRESIDENT: there are no ballots.
 */
export type VoterRoll = {
  basis: "attendance" | "active" | "leaders" | "none";
  minEvents: number | null;
  /** The term attendance is counted in (attendance basis). */
  termName: string | null;
  /** Attendance is counted up to here: when voting opened, or now before that. */
  countedUntil: Date;
  /** Voting has opened, so an attendance roll won't change any more. */
  final: boolean;
  eligibleIds: string[];
  /** Attendance basis only: every registered member with their count, most first. */
  rows: VoterRollRow[];
};

/** An attendance roll's rows: every registered member with their count of club events, most first, eligible when it meets the rule. */
export function attendanceRows(memberIds: string[], attendedBy: (userId: string) => number, minEvents: number): VoterRollRow[] {
  return memberIds
    .map((userId) => {
      const attended = attendedBy(userId);
      return { userId, attended, eligible: meetsAttendance(attended, minEvents) };
    })
    .sort((a, b) => b.attended - a.attended);
}

export type VoterStatus = { eligible: boolean; reason?: string; /** Attendance basis: their count and what the bylaws ask. */ attended?: number; minEvents?: number };

/** One person's place on a roll, with the reason in plain words when they can't vote. */
export function voterStatusIn(roll: VoterRoll, userId: string): VoterStatus {
  const row = roll.rows.find((r) => r.userId === userId);
  const counts = row && roll.minEvents ? { attended: row.attended, minEvents: roll.minEvents } : {};
  if (roll.eligibleIds.includes(userId)) return { eligible: true, ...counts };
  if (roll.basis === "leaders") return { eligible: false, reason: "The club's current student leaders choose this seat, so only they vote." };
  if (roll.basis === "none") return { eligible: false, reason: "This selection has no ballots." };
  if (roll.basis === "attendance" && roll.minEvents) {
    if (!row) return { eligible: false, reason: "Only members of the club can vote." };
    const events = (n: number) => `${n} club event${n === 1 ? "" : "s"}`;
    return {
      eligible: false,
      ...counts,
      reason: roll.final
        ? `You'd been to ${row.attended ? events(row.attended) : "no club events"} this semester when voting opened. The club's bylaws ask for ${events(roll.minEvents)} to vote.`
        : `So far this semester you've been to ${row.attended ? events(row.attended) : "no club events"}. The club's bylaws ask for ${events(roll.minEvents)} by the time voting opens.`,
    };
  }
  return { eligible: false, reason: "Only active members of the club can vote." };
}

export type Quorum = { percent: number; needed: number; met: boolean };

/**
 * Member vote quorum: a result counts only when at least `quorumPercent` of
 * the eligible voters voted. `needed` is that many ballots, rounded up, and
 * never fewer than one (a vote nobody could cast never counts). Null when the
 * bylaws set no quorum.
 */
export function quorumOf(p: { quorumPercent: number | null; eligibleVoters: number; votes: number }): Quorum | null {
  if (!p.quorumPercent) return null;
  const needed = Math.max(1, Math.ceil((p.quorumPercent * p.eligibleVoters) / 100));
  return { percent: p.quorumPercent, needed, met: p.votes >= needed };
}

/** Member vote notice: voting may open `noticeDays` after the vote was announced (it's announced when it's started). Null when there's no notice rule. */
export function earliestVotingOpen(announcedAt: Date, noticeDays: number | null): Date | null {
  return noticeDays ? new Date(announcedAt.getTime() + noticeDays * 86_400_000) : null;
}

/** How far before the exact earliest moment a new member vote may still open: the form rounds the earliest up to the quarter hour, so a time picked at it passes a few minutes later. */
export const NOTICE_GRACE_MS = 15 * 60_000;

/** The earliest a member vote announced at `announcedAt` may open, rounded up to the quarter hour: what the form suggests and shows. */
export function noticeEarliest(announcedAt: Date, noticeDays: number | null): Date | null {
  const raw = earliestVotingOpen(announcedAt, noticeDays);
  return raw ? new Date(Math.ceil(raw.getTime() / NOTICE_GRACE_MS) * NOTICE_GRACE_MS) : null;
}

/** Who settles a tied member vote: a runoff, or a choice between the tied candidates by these people (WSUSA administrators always may). */
export type TieResolution =
  | { kind: "runoff" }
  | {
      kind: "choose";
      /** organizer: whoever can apply the result (no bylaw rule); wsusa: nobody in the club can, so an administrator does. */
      by: "advisor" | "president" | "organizer" | "wsusa";
      /** Who may choose (empty for organizer and wsusa). */
      userIds: string[];
    };

/**
 * How a tied member vote is settled under the bylaws:
 *   RUNOFF     a runoff between the tied candidates; a runoff that ties again goes to the advisor.
 *   ADVISOR    the club's advisors choose; with no advisor, its President.
 *   PRESIDENT  the club's President chooses; one who is among the tied candidates doesn't, and the advisors do.
 *   none       whoever applies the result chooses, and that's recorded.
 * When nobody in the club can, a WSUSA administrator does.
 */
export function tieResolution(p: { tieBreak: TieBreak | null; isRunoff: boolean; presidentIds: string[]; advisorIds: string[]; tiedUserIds: string[] }): TieResolution {
  if (!p.tieBreak) return { kind: "choose", by: "organizer", userIds: [] };
  if (p.tieBreak === "RUNOFF" && !p.isRunoff) return { kind: "runoff" };
  const presidents = p.presidentIds.filter((id) => !p.tiedUserIds.includes(id));
  const order: ("advisor" | "president")[] = p.tieBreak === "PRESIDENT" ? ["president", "advisor"] : ["advisor", "president"];
  for (const by of order) {
    const userIds = by === "advisor" ? p.advisorIds : presidents;
    if (userIds.length) return { kind: "choose", by, userIds };
  }
  return { kind: "choose", by: "wsusa", userIds: [] };
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
