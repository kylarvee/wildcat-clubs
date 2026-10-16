import "server-only";
import { Prisma, type ClubRole, type SuccessionMethod } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, ROLE_LABEL, type ClubAccess } from "@/lib/authz";
import { activeMemberIdsFor } from "@/lib/metrics";
import { logActivity } from "@/lib/lake/activity";
import { assertClubCap, assertSignedIn, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify } from "@/lib/domain/notify";
import { assignRole, endRoleAssignment } from "@/lib/domain/roles";

/**
 * Leadership elections, for clubs whose bylaws use MEMBER_VOTE or
 * LEADERSHIP_VOTE succession (SENIORITY clubs hand off in the org chart).
 *
 *   NOMINATING ──(votingOpensAt or "Open voting now")──▶ VOTING
 *   VOTING ──(votingClosesAt or "Close voting now")──▶ CLOSED
 *   CLOSED ──(apply result → roles.assignRole)──▶ APPLIED
 *   any unfinished state ──▶ CANCELLED
 *
 * Status advances lazily (whenever an election is read through
 * syncElection) and from the scheduled job (advanceElections), so nothing
 * depends on someone clicking at the right minute.
 *
 * Secret ballot: a Vote row stores the voter (one vote each) and the choice,
 * but nothing here — no query, log row or notification — ever returns the two
 * together. Results are only counts per candidate, and only after voting closes.
 */

export const ELECTABLE_ROLES: ClubRole[] = ["PRESIDENT", "VP", "OFFICER", "AMBASSADOR"];
const LEADER_ROLES: ClubRole[] = ["PRESIDENT", "VP", "OFFICER", "AMBASSADOR"];

export function electionsAllowed(method: SuccessionMethod) {
  return method === "MEMBER_VOTE" || method === "LEADERSHIP_VOTE";
}

/** Club members and leaders (incl. advisors/admins) can see a club's elections. */
export function canSeeElections(access: ClubAccess | null) {
  return Boolean(access && (access.isMember || access.isLeader));
}

// ─── Eligibility ─────────────────────────────────────────────────────────────

/** Students currently in a leadership seat (President, VP, officers, ambassadors). */
export async function currentLeaderIds(clubId: string): Promise<string[]> {
  const rows = await db.roleAssignment.findMany({
    where: { clubId, endedAt: null, role: { in: LEADER_ROLES }, user: { status: "ACTIVE", kind: "STUDENT" } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Who may vote right now.
 *   MEMBER_VOTE      active members per lib/metrics (attended recently). If the
 *                    club has no attendance yet, every ACTIVE member votes.
 *   LEADERSHIP_VOTE  current student leaders.
 */
export async function eligibleVoterIds(clubId: string, method: SuccessionMethod): Promise<string[]> {
  if (method === "LEADERSHIP_VOTE") return currentLeaderIds(clubId);
  const members = await db.membership.findMany({
    where: { clubId, status: "ACTIVE", user: { status: "ACTIVE", kind: "STUDENT" } },
    select: { userId: true },
  });
  const memberIds = new Set(members.map((m) => m.userId));
  const active = (await activeMemberIdsFor(clubId)).filter((id) => memberIds.has(id));
  return active.length > 0 ? active : [...memberIds];
}

/** Whether someone can stand for election, with a plain reason when they can't. */
export async function candidateEligibility(userId: string, clubId: string, method: SuccessionMethod): Promise<{ eligible: boolean; reason?: string }> {
  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { kind: true, status: true } }),
    db.membership.findUnique({ where: { userId_clubId: { userId, clubId } }, select: { status: true } }),
  ]);
  if (!user || user.status !== "ACTIVE") return { eligible: false, reason: "Only current students can run." };
  if (user.kind !== "STUDENT") return { eligible: false, reason: "Club leadership roles are for students." };
  if (membership?.status !== "ACTIVE") return { eligible: false, reason: "Only active members of the club can run." };
  if (method === "LEADERSHIP_VOTE") {
    const leads = await db.roleAssignment.count({ where: { clubId, userId, endedAt: null, role: { in: LEADER_ROLES } } });
    if (leads === 0) return { eligible: false, reason: "In a leadership vote, only current club leaders can run." };
  }
  return { eligible: true };
}

// ─── Lazy status ─────────────────────────────────────────────────────────────

const electionInclude = {
  club: { select: { id: true, name: true, slug: true } },
  position: { select: { id: true, name: true, role: true, archivedAt: true, responsibilities: true } },
  _count: { select: { candidates: true, votes: true } },
} satisfies Prisma.ElectionInclude;

async function onVotingOpened(e: { id: string; clubId: string; method: SuccessionMethod; title: string; votingClosesAt: Date; club: { slug: string; name: string }; _count: { candidates: number } }, actorId: string | null) {
  await logActivity({ actorId, action: "election.voting_opened", entityType: "election", entityId: e.id, clubId: e.clubId });
  // An empty ballot isn't worth a notification; organizers see the warning instead.
  if (e._count.candidates === 0 || e.votingClosesAt <= new Date()) return;
  await notify({
    userIds: await eligibleVoterIds(e.clubId, e.method),
    kind: "election.voting_opened",
    title: `Voting is open: ${e.title}`,
    body: `Cast your secret ballot for ${e.club.name}. One vote each.`,
    href: `/clubs/${e.club.slug}/elections/${e.id}`,
  });
}

async function onVotingClosed(e: { id: string; clubId: string; method: SuccessionMethod; title: string; club: { slug: string; name: string } }, actorId: string | null) {
  const [votes, voters, candidates] = await Promise.all([
    db.vote.count({ where: { electionId: e.id } }),
    eligibleVoterIds(e.clubId, e.method),
    db.electionCandidate.findMany({ where: { electionId: e.id }, select: { userId: true } }),
  ]);
  // Turnout is frozen here so later roster changes don't rewrite it.
  await logActivity({ actorId, action: "election.closed", entityType: "election", entityId: e.id, clubId: e.clubId, data: { votes, eligibleVoters: voters.length } });
  await notify({
    userIds: candidates.map((c) => c.userId),
    kind: "election.results",
    title: `Results are in: ${e.title}`,
    body: `${votes} vote${votes === 1 ? "" : "s"} cast. See how it went.`,
    href: `/clubs/${e.club.slug}/elections/${e.id}`,
  });
}

/** Read an election and advance its status if its time has come. Safe to call on every page view. */
export async function syncElection(electionId: string, now: Date = new Date()) {
  const e = await db.election.findUnique({ where: { id: electionId }, include: electionInclude });
  if (!e) return null;
  if (e.status === "NOMINATING" && now >= e.votingOpensAt) {
    const r = await db.election.updateMany({ where: { id: e.id, status: "NOMINATING" }, data: { status: "VOTING" } });
    if (r.count) await onVotingOpened(e, null);
    e.status = "VOTING";
  }
  if (e.status === "VOTING" && now >= e.votingClosesAt) {
    const r = await db.election.updateMany({ where: { id: e.id, status: "VOTING" }, data: { status: "CLOSED" } });
    if (r.count) await onVotingClosed(e, null);
    e.status = "CLOSED";
  }
  return e;
}

/** Advance every election of a club (call before listing them). */
export async function syncClubElections(clubId: string, now: Date = new Date()) {
  const due = await db.election.findMany({
    where: {
      clubId,
      OR: [
        { status: "NOMINATING", votingOpensAt: { lte: now } },
        { status: "VOTING", votingClosesAt: { lte: now } },
      ],
    },
    select: { id: true },
  });
  for (const e of due) await syncElection(e.id, now);
}

/** Scheduled job: advance every due election platform-wide. Idempotent. */
export async function advanceElections(now: Date = new Date()) {
  const due = await db.election.findMany({
    where: {
      OR: [
        { status: "NOMINATING", votingOpensAt: { lte: now } },
        { status: "VOTING", votingClosesAt: { lte: now } },
      ],
    },
    select: { id: true },
  });
  for (const e of due) await syncElection(e.id, now);
  return { advanced: due.length };
}

async function loadSynced(electionId: string) {
  const e = await syncElection(electionId);
  if (!e) throw notFound("Election");
  return e;
}

// ─── Organizing ──────────────────────────────────────────────────────────────

const CreateInput = z.object({
  clubId: z.string().min(1),
  positionId: z.string().min(1, "Choose the seat this election fills."),
  title: z.string().trim().min(3, "Give the election a title.").max(120, "Titles can be up to 120 characters."),
  votingOpensAt: z.coerce.date({ error: "Choose when voting opens." }),
  votingClosesAt: z.coerce.date({ error: "Choose when voting closes." }),
});

/** Start an election for a seat. Nominations open immediately and run until voting opens. */
export async function createElection(actor: Actor | null, input: unknown) {
  const v = parse(CreateInput, input);
  await assertClubCap(actor, v.clubId, "elections");
  const club = await db.club.findUnique({ where: { id: v.clubId }, select: { id: true, name: true, slug: true, successionMethod: true } });
  if (!club) throw notFound("Club");
  if (!electionsAllowed(club.successionMethod)) {
    throw invalid("Your bylaws use seniority succession: the President names their successor in the org chart.");
  }
  const seat = await db.position.findUnique({ where: { id: v.positionId } });
  if (!seat || seat.clubId !== club.id || seat.archivedAt) throw notFound("Seat");
  if (!ELECTABLE_ROLES.includes(seat.role)) throw invalid("That seat can't be filled by election.");
  const now = Date.now();
  if (v.votingOpensAt.getTime() < now) throw invalid("Voting has to open in the future, so members have time to run.");
  if (v.votingClosesAt.getTime() - v.votingOpensAt.getTime() < 3_600_000) throw invalid("Keep voting open for at least an hour.");
  if (v.votingClosesAt.getTime() - now > 180 * 86_400_000) throw invalid("Voting should close within six months.");
  const running = await db.election.count({ where: { positionId: seat.id, status: { in: ["NOMINATING", "VOTING", "CLOSED"] } } });
  if (running > 0) throw conflict(`There's already an election for ${seat.name} that hasn't finished.`);

  const election = await db.election.create({
    data: {
      clubId: club.id,
      positionId: seat.id,
      title: v.title,
      method: club.successionMethod,
      status: "NOMINATING",
      votingOpensAt: v.votingOpensAt,
      votingClosesAt: v.votingClosesAt,
      createdById: actor!.id,
    },
  });
  await logActivity({ actorId: actor!.id, action: "election.created", entityType: "election", entityId: election.id, clubId: club.id, data: { title: election.title, seat: seat.name }, isPublic: true });

  // Let the people who can run know nominations are open.
  const pool =
    club.successionMethod === "LEADERSHIP_VOTE"
      ? await currentLeaderIds(club.id)
      : (await db.membership.findMany({ where: { clubId: club.id, status: "ACTIVE", user: { status: "ACTIVE", kind: "STUDENT" } }, select: { userId: true } })).map((m) => m.userId);
  await notify({
    userIds: pool,
    exceptUserId: actor!.id,
    kind: "election.nominations_open",
    title: `Nominations are open: ${election.title}`,
    body: `Run for ${seat.name} in ${club.name} before voting opens.`,
    href: `/clubs/${club.slug}/elections/${election.id}`,
    email: false,
  });
  return election;
}

const NominateInput = z.object({
  userId: z.string().optional().nullable(),
  statement: z.string().trim().max(2000, "Keep statements under 2,000 characters.").optional().nullable(),
});

/** Run yourself (any eligible member) or nominate someone else (organizers with `elections`). */
export async function nominateCandidate(actor: Actor | null, electionId: string, input: unknown) {
  assertSignedIn(actor);
  const v = parse(NominateInput, input);
  const e = await loadSynced(electionId);
  if (e.status !== "NOMINATING") throw invalid("Nominations are closed for this election.");
  const nomineeId = v.userId || actor.id;
  const self = nomineeId === actor.id;
  if (!self) await assertClubCap(actor, e.clubId, "elections");
  const elig = await candidateEligibility(nomineeId, e.clubId, e.method);
  if (!elig.eligible) throw invalid(self ? (elig.reason ?? "You can't run in this election.") : `They can't run: ${elig.reason?.toLowerCase() ?? "not eligible"}`);

  let candidate;
  try {
    candidate = await db.electionCandidate.create({
      data: { electionId: e.id, userId: nomineeId, statement: v.statement || null, nominatedById: actor.id },
      include: { user: { select: { name: true } } },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict(self ? "You're already running in this election." : "They're already a candidate.");
    throw err;
  }
  await logActivity({ actorId: actor.id, action: "election.nominated", entityType: "election", entityId: e.id, clubId: e.clubId, data: { userId: nomineeId, self } });
  if (!self) {
    await notify({
      userIds: [nomineeId],
      kind: "election.nominated",
      title: `You've been nominated for ${e.position.name}`,
      body: `${actor.name} nominated you in ${e.club.name}. Add a statement, or withdraw if you'd rather not run.`,
      href: `/clubs/${e.club.slug}/elections/${e.id}`,
    });
  }
  return candidate;
}

/** A candidate edits their statement while nominations are open. */
export async function updateCandidateStatement(actor: Actor | null, candidateId: string, statement: string | null) {
  assertSignedIn(actor);
  const c = await db.electionCandidate.findUnique({ where: { id: candidateId } });
  if (!c) throw notFound("Candidate");
  if (c.userId !== actor.id) throw forbidden("Only the candidate can edit their statement.");
  const e = await loadSynced(c.electionId);
  if (e.status !== "NOMINATING") throw invalid("Statements are locked once voting opens.");
  const clean = parse(z.string().trim().max(2000, "Keep statements under 2,000 characters.").nullable(), statement) || null;
  await db.electionCandidate.update({ where: { id: c.id }, data: { statement: clean } });
  await logActivity({ actorId: actor.id, action: "election.statement_updated", entityType: "election", entityId: e.id, clubId: e.clubId });
}

/** Withdraw a candidacy (the candidate, or an organizer) before voting opens. */
export async function withdrawCandidate(actor: Actor | null, candidateId: string) {
  assertSignedIn(actor);
  const c = await db.electionCandidate.findUnique({ where: { id: candidateId }, include: { user: { select: { name: true } } } });
  if (!c) throw notFound("Candidate");
  const e = await loadSynced(c.electionId);
  if (c.userId !== actor.id) await assertClubCap(actor, e.clubId, "elections");
  if (e.status !== "NOMINATING") throw invalid("Voting has started, so the ballot is locked. An organizer can cancel the election if needed.");
  await db.electionCandidate.delete({ where: { id: c.id } });
  await logActivity({ actorId: actor.id, action: "election.withdrawn", entityType: "election", entityId: e.id, clubId: e.clubId, data: { userId: c.userId, self: c.userId === actor.id } });
  if (c.userId !== actor.id) {
    await notify({ userIds: [c.userId], kind: "election.withdrawn", title: `You were removed from the ballot for ${e.position.name}`, href: `/clubs/${e.club.slug}/elections/${e.id}`, email: false });
  }
}

/** Close nominations early and open voting now. */
export async function openVoting(actor: Actor | null, electionId: string) {
  const e = await loadSynced(electionId);
  await assertClubCap(actor, e.clubId, "elections");
  if (e.status !== "NOMINATING") throw invalid("Voting is already open or finished.");
  if (e._count.candidates === 0) throw invalid("Add at least one candidate before opening voting.");
  const now = new Date();
  if (e.votingClosesAt.getTime() - now.getTime() < 3_600_000) throw invalid("Voting would close within the hour. Cancel this election and start a new one with a later closing time.");
  const r = await db.election.updateMany({ where: { id: e.id, status: "NOMINATING" }, data: { status: "VOTING", votingOpensAt: now } });
  if (r.count) await onVotingOpened(e, actor!.id);
}

/** End voting now (before the scheduled close). */
export async function closeVoting(actor: Actor | null, electionId: string) {
  const e = await loadSynced(electionId);
  await assertClubCap(actor, e.clubId, "elections");
  if (e.status !== "VOTING") throw invalid("Voting isn't open.");
  const r = await db.election.updateMany({ where: { id: e.id, status: "VOTING" }, data: { status: "CLOSED", votingClosesAt: new Date() } });
  if (r.count) await onVotingClosed(e, actor!.id);
}

/** Call an election off. Votes already cast are kept (still secret) but never counted toward a role. */
export async function cancelElection(actor: Actor | null, electionId: string) {
  const e = await loadSynced(electionId);
  await assertClubCap(actor, e.clubId, "elections");
  if (e.status === "APPLIED" || e.status === "CANCELLED") throw invalid("This election is already finished.");
  await db.election.update({ where: { id: e.id }, data: { status: "CANCELLED" } });
  await logActivity({ actorId: actor!.id, action: "election.cancelled", entityType: "election", entityId: e.id, clubId: e.clubId, isPublic: true });
  const candidates = await db.electionCandidate.findMany({ where: { electionId: e.id }, select: { userId: true } });
  await notify({
    userIds: candidates.map((c) => c.userId),
    exceptUserId: actor!.id,
    kind: "election.cancelled",
    title: `${e.title} was cancelled`,
    href: `/clubs/${e.club.slug}/elections/${e.id}`,
    email: false,
  });
}

// ─── Voting ──────────────────────────────────────────────────────────────────

/** Whether this person may vote in this election right now, and why not. */
export async function voterEligibility(userId: string, e: { clubId: string; method: SuccessionMethod }): Promise<{ eligible: boolean; reason?: string }> {
  const ids = await eligibleVoterIds(e.clubId, e.method);
  if (ids.includes(userId)) return { eligible: true };
  return {
    eligible: false,
    reason: e.method === "LEADERSHIP_VOTE" ? "This is a leadership vote: only the club's current student leaders vote." : "Only active members of the club can vote.",
  };
}

export async function hasVoted(electionId: string, userId: string) {
  return (await db.vote.count({ where: { electionId, voterId: userId } })) > 0;
}

/** Cast a secret ballot. One per person; it can't be changed. */
export async function castVote(actor: Actor | null, electionId: string, candidateId: string) {
  assertSignedIn(actor);
  const e = await loadSynced(electionId);
  if (e.status !== "VOTING") throw invalid(e.status === "NOMINATING" ? "Voting hasn't opened yet." : "Voting has closed.");
  const elig = await voterEligibility(actor.id, e);
  if (!elig.eligible) throw forbidden(elig.reason);
  const candidate = await db.electionCandidate.findUnique({ where: { id: candidateId }, select: { id: true, electionId: true, userId: true } });
  if (!candidate || candidate.electionId !== e.id) throw notFound("Candidate");
  if (e.method === "LEADERSHIP_VOTE" && candidate.userId === actor.id) throw forbidden("In a leadership vote you can't vote for yourself.");
  try {
    await db.vote.create({ data: { electionId: e.id, voterId: actor.id, candidateId: candidate.id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict("You've already voted in this election.");
    throw err;
  }
  // Never record the choice anywhere but the ballot itself.
  await logActivity({ actorId: actor.id, action: "vote.cast", entityType: "election", entityId: e.id, clubId: e.clubId });
}

// ─── Results ─────────────────────────────────────────────────────────────────

export type ElectionResults = {
  rows: { candidateId: string; userId: string; votes: number; share: number | null }[];
  totalVotes: number;
  eligibleVoters: number;
  turnout: number | null;
  /** Candidate ids sharing the most votes (more than one = tie). */
  leaders: string[];
};

/** Counts per candidate — only once voting has closed. Null before that. */
export async function electionResults(electionId: string): Promise<ElectionResults | null> {
  const e = await db.election.findUnique({ where: { id: electionId }, select: { id: true, clubId: true, method: true, status: true, candidates: { select: { id: true, userId: true } } } });
  if (!e || (e.status !== "CLOSED" && e.status !== "APPLIED")) return null;
  const grouped = await db.vote.groupBy({ by: ["candidateId"], where: { electionId: e.id }, _count: { _all: true } });
  const counts = new Map(grouped.map((g) => [g.candidateId, g._count._all]));
  const totalVotes = grouped.reduce((n, g) => n + g._count._all, 0);
  const frozen = await db.activityLog.findFirst({ where: { action: "election.closed", entityType: "election", entityId: e.id }, orderBy: { at: "desc" }, select: { data: true } });
  const frozenEligible = (frozen?.data as { eligibleVoters?: number } | null)?.eligibleVoters;
  const eligibleVoters = typeof frozenEligible === "number" ? frozenEligible : (await eligibleVoterIds(e.clubId, e.method)).length;
  const rows = e.candidates
    .map((c) => ({ candidateId: c.id, userId: c.userId, votes: counts.get(c.id) ?? 0, share: totalVotes ? (counts.get(c.id) ?? 0) / totalVotes : null }))
    .sort((a, b) => b.votes - a.votes);
  const top = rows[0]?.votes ?? 0;
  return {
    rows,
    totalVotes,
    eligibleVoters,
    turnout: eligibleVoters ? Math.min(1, totalVotes / eligibleVoters) : null,
    leaders: rows.filter((r) => r.votes === top).map((r) => r.candidateId),
  };
}

const ApplyInput = z.object({ winnerCandidateId: z.string().optional().nullable() });

/**
 * Put the winner in the seat through the Org Chart path (roles.assignRole),
 * replacing whoever holds it now. Only someone who could assign the seat's
 * role may apply (so a VP can't apply a President election). Ties: the
 * applier picks among the tied candidates, and that choice is recorded.
 */
export async function applyElectionResult(actor: Actor | null, electionId: string, input: unknown) {
  assertSignedIn(actor);
  const v = parse(ApplyInput, input);
  const e = await loadSynced(electionId);
  const access = await getClubAccess(actor, e.clubId);
  if (!access) throw notFound("Club");
  if (!access.assignableRoles.includes(e.position.role)) {
    throw forbidden(`Only someone who can assign the ${ROLE_LABEL[e.position.role]} role can apply this result.`);
  }
  if (e.status === "APPLIED") throw conflict("This result was already applied.");
  if (e.status !== "CLOSED") throw invalid("Close voting before applying the result.");
  if (e.position.archivedAt) throw invalid(`${e.position.name} is archived. Restore the seat in the org chart first.`);

  const results = await electionResults(e.id);
  if (!results || results.rows.length === 0) throw invalid("No one ran in this election. Cancel it instead.");
  let winnerId: string;
  const tieBroken = results.leaders.length > 1;
  if (!tieBroken) {
    winnerId = results.leaders[0];
    if (v.winnerCandidateId && v.winnerCandidateId !== winnerId) throw invalid("That candidate didn't win.");
  } else {
    if (!v.winnerCandidateId) throw conflict("It's a tie. Choose the winner from the tied candidates.");
    if (!results.leaders.includes(v.winnerCandidateId)) throw invalid("Choose one of the tied candidates.");
    winnerId = v.winnerCandidateId;
  }
  const winner = results.rows.find((r) => r.candidateId === winnerId)!;

  // Claim the election first so two people can't apply it at once.
  const claimed = await db.election.updateMany({ where: { id: e.id, status: "CLOSED" }, data: { status: "APPLIED", winnerId: winner.userId, appliedAt: new Date() } });
  if (!claimed.count) throw conflict("This result was already applied.");
  try {
    const holders = await db.roleAssignment.findMany({ where: { positionId: e.position.id, endedAt: null } });
    if (holders.some((h) => h.userId === winner.userId)) {
      // Re-elected: keep their assignment (and its history); everyone else's term ends.
      for (const h of holders) if (h.userId !== winner.userId) await endRoleAssignment(actor, h.id, "TERM_ENDED", `Election: ${e.title}`);
    } else {
      await assignRole(actor, { clubId: e.clubId, userId: winner.userId, positionId: e.position.id, replaceAssignmentIds: holders.map((h) => h.id) });
    }
  } catch (err) {
    await db.election.update({ where: { id: e.id }, data: { status: "CLOSED", winnerId: null, appliedAt: null } });
    throw err;
  }

  await logActivity({
    actorId: actor.id,
    action: "election.applied",
    entityType: "election",
    entityId: e.id,
    clubId: e.clubId,
    data: { winnerId: winner.userId, votes: winner.votes, tieBroken, ...(tieBroken ? { tiedCandidateIds: results.leaders } : {}) },
    isPublic: true,
  });
  const candidates = await db.electionCandidate.findMany({ where: { electionId: e.id }, select: { userId: true } });
  const winnerUser = await db.user.findUnique({ where: { id: winner.userId }, select: { name: true } });
  await notify({
    userIds: candidates.map((c) => c.userId).filter((id) => id !== winner.userId),
    kind: "election.applied",
    title: `${winnerUser?.name ?? "The winner"} is now ${e.position.name} of ${e.club.name}`,
    body: tieBroken ? "The vote was tied; the organizer chose between the tied candidates." : undefined,
    href: `/clubs/${e.club.slug}/elections/${e.id}`,
    email: false,
  });
  return { winnerUserId: winner.userId, tieBroken };
}
