import "server-only";
import { Prisma, type ClubRole, type ElectionStatus, type SuccessionMethod } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, ROLE_LABEL, type ClubAccess } from "@/lib/authz";
import { activeMemberIdsFor, clubMemberAttendanceCounts } from "@/lib/metrics";
import { currentOrLastTerm, getTerms } from "@/lib/terms";
import { clubRules } from "@/lib/constitution/club-rules";
import { selectionRulesFor } from "@/lib/constitution/rules";
import { logActivity } from "@/lib/lake/activity";
import { assertClubCap, assertSignedIn, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify } from "@/lib/domain/notify";
import { assignRole, endRoleAssignment } from "@/lib/domain/roles";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { officeForClub } from "@/lib/offices";
import { clubPipeline } from "@/lib/roles/queries";
import {
  attendanceRows,
  canSelfNominate,
  confirmersFor,
  earliestVotingOpen,
  firstToAccept,
  inClubPipeline,
  isKeyHolder,
  leadersBelow,
  noticeEarliest,
  NOTICE_GRACE_MS,
  organizersAddCandidates,
  pipelineCandidates,
  quorumOf,
  readSelectionRules,
  selectionRulesJson,
  SUCCESSION_METHODS,
  tieResolution,
  unanimousChoice,
  usesBallots,
  type KeyHolders,
  type PipelinePerson,
  type Quorum,
  type SelectionRules,
  type TieResolution,
  type VoterRoll,
  type VoterRollRow,
  type VoterStatus,
  voterStatusIn,
} from "@/lib/roles/pipeline";
import { fmtDate } from "@/lib/time";

/**
 * Filling leadership seats: the leadership pipeline's four modes on one
 * lifecycle. Each Election row fills one seat; `method` is the mode used this
 * time (the club's primary mode from its bylaws unless the organizer picks
 * another).
 *
 *   NOMINATING ──(votingOpensAt or "Open voting now")──▶ VOTING
 *   VOTING ──(votingClosesAt or "Close now")──▶ CLOSED
 *   CLOSED ──(apply the result → roles.assignRole)──▶ APPLIED
 *   any unfinished state ──▶ CANCELLED
 *
 *   MEMBER_VOTE        Members vote by secret ballot; the most votes wins,
 *                      under the club's bylaw rules (below).
 *   SELF_SELECT        Current student leaders vote by secret ballot, never for
 *                      themselves. It counts only if it's unanimous.
 *   NEXT_IN_LINE       No ballots. Starts in VOTING ("waiting for answers"): each
 *                      person next in line says yes (acceptedAt) or no (withdraws)
 *                      by votingClosesAt. At close, the first in pipeline order
 *                      who said yes is the result.
 *   ADVISOR_PRESIDENT  No ballots and no window: it stays NOMINATING while the
 *                      President or an advisor proposes one candidate and the
 *                      other confirms. Confirming fills the seat. votingClosesAt
 *                      is only the "decide by" date.
 *
 * Every selection starts with the people on the org chart below the seat as
 * candidates (fromPipeline). Results apply through the Org Chart write path,
 * and whoever moves up leaves the seat they moved up from, which then shows as
 * open in the pipeline (nothing cascades on its own).
 *
 * Bylaw rules: a new selection freezes the club's rules from its builder
 * bylaws in effect (lib/constitution/club-rules) into Election.rules, so an
 * amendment never changes a vote under way. Member votes follow them:
 *   minEvents      who votes: members who'd been to that many of the club's
 *                  events this term when voting opened (voterRoll); without
 *                  it, active members per lib/metrics.
 *   quorumPercent  a result counts only if that share of eligible voters
 *                  voted; otherwise it's "No quorum" and can't be applied.
 *   tieBreak       a runoff between the tied candidates (startRunoff), or the
 *                  advisor or the President chooses (pipeline tieResolution);
 *                  without it, whoever applies the result chooses.
 *   noticeDays     voting opens no sooner than that many days after the
 *                  selection was started (announced).
 * Self-select always counts the current leaders' ballots, unanimously.
 *
 * Status advances lazily (whenever a selection is read through syncElection)
 * and from the scheduled job (advanceElections), so nothing depends on someone
 * clicking at the right minute.
 *
 * Secret ballot: a Vote row stores the voter (one vote each) and the choice,
 * but nothing here — no query, log row or notification — ever returns the two
 * together. Results are only counts per candidate, and only after voting closes.
 */

export const ELECTABLE_ROLES: ClubRole[] = ["PRESIDENT", "VP", "OFFICER", "AMBASSADOR"];
const LEADER_ROLES: ClubRole[] = ["PRESIDENT", "VP", "OFFICER", "AMBASSADOR"];
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** "Thu, Oct 16 at 6:30 PM" in campus time, for notification text. */
const when = (d: Date) => fmtDate(d, "EEE, MMM d 'at' h:mm a");

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

/** The parts of a selection that decide who votes in it. */
export type BallotFacts = { clubId: string; method: SuccessionMethod; status: ElectionStatus; votingOpensAt: Date; rules: Prisma.JsonValue };

export { voterStatusIn, type VoterRoll, type VoterRollRow, type VoterStatus } from "@/lib/roles/pipeline";

/**
 * Who votes in a selection, and why (pipeline VoterRoll). Under the bylaws'
 * attendance rule it counts each registered member's check-ins at the
 * club's events (hosted or co-hosted, lib/metrics) this term, up to when
 * voting opened, or up to now before it opens.
 */
export async function voterRoll(e: BallotFacts): Promise<VoterRoll> {
  const final = e.status !== "NOMINATING";
  const countedUntil = final ? e.votingOpensAt : new Date();
  const base = { minEvents: null, termName: null, countedUntil, final, rows: [] as VoterRollRow[] };
  if (e.method === "SELF_SELECT") return { ...base, basis: "leaders", eligibleIds: await currentLeaderIds(e.clubId) };
  if (e.method !== "MEMBER_VOTE") return { ...base, basis: "none", eligibleIds: [] };
  const members = await db.membership.findMany({
    where: { clubId: e.clubId, status: "ACTIVE", user: { status: "ACTIVE", kind: "STUDENT" } },
    select: { userId: true },
  });
  const memberIds = members.map((m) => m.userId);
  const { minEvents } = readSelectionRules(e.rules);
  if (!minEvents) {
    const ids = new Set(memberIds);
    const active = (await activeMemberIdsFor(e.clubId)).filter((id) => ids.has(id));
    return { ...base, basis: "active", eligibleIds: active.length > 0 ? active : memberIds };
  }
  const term = currentOrLastTerm(await getTerms(), countedUntil);
  const counts = await clubMemberAttendanceCounts(e.clubId, { from: term?.startsOn, to: countedUntil });
  const rows = attendanceRows(memberIds, (userId) => counts.get(userId)?.attended ?? 0, minEvents);
  return { ...base, basis: "attendance", minEvents, termName: term?.name ?? null, eligibleIds: rows.filter((r) => r.eligible).map((r) => r.userId), rows };
}

/** Who may vote in a selection (voterRoll). */
export async function eligibleVoterIds(e: BallotFacts): Promise<string[]> {
  return (await voterRoll(e)).eligibleIds;
}

/** Whether someone can be a candidate, with a plain reason when they can't. Any mode: an active student member. */
export async function candidateEligibility(userId: string, clubId: string): Promise<{ eligible: boolean; reason?: string }> {
  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { kind: true, status: true } }),
    db.membership.findUnique({ where: { userId_clubId: { userId, clubId } }, select: { status: true } }),
  ]);
  if (!user || user.status !== "ACTIVE") return { eligible: false, reason: "Only current students can be candidates." };
  if (user.kind !== "STUDENT") return { eligible: false, reason: "Club leadership roles are for students." };
  if (membership?.status !== "ACTIVE") return { eligible: false, reason: "Only active members of the club can be candidates." };
  return { eligible: true };
}

/** The club's sitting President(s) and advisors: who proposes and confirms in an Advisor & President selection. */
export async function keyHolders(clubId: string): Promise<KeyHolders> {
  const rows = await db.roleAssignment.findMany({
    where: { clubId, endedAt: null, role: { in: ["PRESIDENT", "ADVISOR"] }, user: { status: "ACTIVE" } },
    select: { userId: true, role: true },
  });
  return {
    presidentIds: [...new Set(rows.filter((r) => r.role === "PRESIDENT").map((r) => r.userId))],
    advisorIds: [...new Set(rows.filter((r) => r.role === "ADVISOR").map((r) => r.userId))],
  };
}

// ─── Lazy status ─────────────────────────────────────────────────────────────

const electionInclude = {
  club: { select: { id: true, name: true, slug: true, type: true } },
  position: { select: { id: true, name: true, role: true, archivedAt: true, responsibilities: true, defaultPermissions: true } },
  _count: { select: { candidates: true, votes: true } },
} satisfies Prisma.ElectionInclude;

export type SyncedElection = Prisma.ElectionGetPayload<{ include: typeof electionInclude }>;

/** Selections whose time has come. Advisor & President selections have no window, so they never move on their own. */
function dueWhere(now: Date): Prisma.ElectionWhereInput {
  return {
    method: { not: "ADVISOR_PRESIDENT" },
    OR: [
      { status: "NOMINATING", votingOpensAt: { lte: now } },
      { status: "VOTING", votingClosesAt: { lte: now } },
    ],
  };
}

const memberHref = (e: { id: string; club: { slug: string } }) => `/clubs/${e.club.slug}/elections/${e.id}`;
const manageHref = (e: { id: string; club: { slug: string } }) => `/clubs/${e.club.slug}/manage/elections/${e.id}`;

/** `openedAt`: when voting actually opened (the roll is counted to then). */
async function onVotingOpened(e: SyncedElection, actorId: string | null, openedAt: Date = e.votingOpensAt) {
  await logActivity({ actorId, action: "election.voting_opened", entityType: "election", entityId: e.id, clubId: e.clubId });
  // An empty ballot isn't worth a notification; organizers see the warning instead.
  if (e._count.candidates === 0 || e.votingClosesAt <= new Date()) return;
  await notify({
    userIds: await eligibleVoterIds({ ...e, status: "VOTING", votingOpensAt: openedAt }),
    kind: "election.voting_opened",
    title: `Voting is open: ${e.title}`,
    body: e.method === "SELF_SELECT" ? `${e.club.name}'s leaders choose together: it has to be unanimous, and ballots are secret.` : `Cast your secret ballot for ${e.club.name}. One vote each.`,
    href: memberHref(e),
  });
}

/** Who voted (never for whom) and the counts, for the unanimity check. */
async function unanimousOf(electionId: string, eligible: string[]): Promise<string | null> {
  const [grouped, voters, candidates] = await Promise.all([
    db.vote.groupBy({ by: ["candidateId"], where: { electionId }, _count: { _all: true } }),
    db.vote.findMany({ where: { electionId }, select: { voterId: true } }),
    db.electionCandidate.findMany({ where: { electionId }, select: { id: true, userId: true } }),
  ]);
  const counts = new Map(grouped.map((g) => [g.candidateId, g._count._all]));
  return unanimousChoice({
    eligibleVoterIds: eligible,
    voterIds: voters.map((v) => v.voterId),
    tally: candidates.map((c) => ({ candidateId: c.id, userId: c.userId, votes: counts.get(c.id) ?? 0 })),
  });
}

async function onVotingClosed(e: SyncedElection, actorId: string | null) {
  const candidates = await db.electionCandidate.findMany({
    where: { electionId: e.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, acceptedAt: true, user: { select: { name: true } } },
  });
  const tellEveryone = (title: string, body: string) =>
    notify({ userIds: [...candidates.map((c) => c.userId), e.createdById], exceptUserId: actorId, kind: "election.results", title, body, href: memberHref(e) });

  if (e.method === "NEXT_IN_LINE") {
    const first = firstToAccept(candidates);
    await logActivity({ actorId, action: "election.closed", entityType: "election", entityId: e.id, clubId: e.clubId, data: { asked: candidates.length, saidYes: candidates.filter((c) => c.acceptedAt).length, firstYes: first?.id ?? null } });
    // Anyone who never answered doesn't need the prompt any more.
    for (const c of candidates) await resolveTasks("electionAnswer", c.id, null, db, "CANCELLED");
    await tellEveryone(
      first ? `${first.user.name} is first in line for ${e.position.name}` : `Nobody said yes to ${e.position.name}`,
      first ? "Answers are in. Someone who can assign the seat moves them up from the elections page." : "Answers are in. The organizers will fill the seat another way.",
    );
    return;
  }

  const [votes, voters] = await Promise.all([db.vote.count({ where: { electionId: e.id } }), eligibleVoterIds({ ...e, status: "VOTING" })]);
  // Turnout (and, for self-select, whether it was unanimous) is frozen here so later roster changes don't rewrite it.
  const data: Record<string, unknown> = { votes, eligibleVoters: voters.length };
  if (e.method === "SELF_SELECT") data.unanimous = await unanimousOf(e.id, voters);
  await logActivity({ actorId, action: "election.closed", entityType: "election", entityId: e.id, clubId: e.clubId, data: data as Prisma.InputJsonObject });
  const quorum = e.method === "MEMBER_VOTE" ? quorumOf({ quorumPercent: readSelectionRules(e.rules).quorumPercent, eligibleVoters: voters.length, votes }) : null;
  await tellEveryone(
    quorum && !quorum.met ? `No quorum: ${e.title}` : `Results are in: ${e.title}`,
    e.method === "SELF_SELECT" && !data.unanimous
      ? "The leaders didn't choose unanimously, so the seat will be chosen again."
      : quorum && !quorum.met
        ? `${votes} of ${voters.length} eligible voters voted, and ${e.club.name}'s bylaws need ${quorum.needed}, so the result doesn't count. The organizers will hold the vote again or fill the seat another way.`
        : `${votes} vote${votes === 1 ? "" : "s"} cast. See how it went.`,
  );
}

/** Read a selection and advance its status if its time has come. Safe to call on every page view. */
export async function syncElection(electionId: string, now: Date = new Date()) {
  const e = await db.election.findUnique({ where: { id: electionId }, include: electionInclude });
  if (!e) return null;
  if (e.method === "ADVISOR_PRESIDENT") return e;
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

/** Advance every selection of a club (call before listing them). */
export async function syncClubElections(clubId: string, now: Date = new Date()) {
  const due = await db.election.findMany({ where: { clubId, ...dueWhere(now) }, select: { id: true } });
  for (const e of due) await syncElection(e.id, now);
}

/** Scheduled job: advance every due selection platform-wide. Idempotent. */
export async function advanceElections(now: Date = new Date()) {
  const due = await db.election.findMany({ where: dueWhere(now), select: { id: true } });
  for (const e of due) await syncElection(e.id, now);
  return { advanced: due.length };
}

async function loadSynced(electionId: string) {
  const e = await syncElection(electionId);
  if (!e) throw notFound("Election");
  return e;
}

// ─── Starting a selection ────────────────────────────────────────────────────

const CreateInput = z.object({
  clubId: z.string().min(1),
  positionId: z.string().min(1, "Choose the seat to fill."),
  title: z.string().trim().min(3, "Give it a title.").max(120, "Titles can be up to 120 characters."),
  /** The mode for this seat this time; the club's primary mode when left out. */
  method: z.enum(SUCCESSION_METHODS as [SuccessionMethod, ...SuccessionMethod[]]).nullish(),
  /** Ballot modes only: when nominations close and voting opens. */
  votingOpensAt: z.coerce.date({ error: "Choose when voting opens." }).nullish(),
  /** When voting closes — or, with no ballots, the "respond by" (next in line) or "decide by" (advisor & President) date. */
  votingClosesAt: z.coerce.date({ error: "Choose a date." }),
});

type Plan = {
  actor: Actor;
  club: { id: string; name: string; slug: string };
  seat: { id: string; name: string; role: ClubRole };
  method: SuccessionMethod;
  title: string;
  opens: Date;
  closes: Date;
  pool: PipelinePerson[];
  now: Date;
  /** The club's bylaw rules, frozen into Election.rules. */
  rules: SelectionRules;
};

/** Checks a new selection without writing anything: who may start it, the seat, the mode's dates, and its candidates from the pipeline. */
async function planSelection(actor: Actor | null, input: unknown): Promise<Plan> {
  const v = parse(CreateInput, input);
  await assertClubCap(actor, v.clubId, "elections");
  const club = await db.club.findUnique({ where: { id: v.clubId }, select: { id: true, name: true, slug: true, type: true, successionMethod: true } });
  if (!club) throw notFound("Club");
  const seat = await db.position.findUnique({ where: { id: v.positionId }, select: { id: true, clubId: true, name: true, role: true, archivedAt: true } });
  if (!seat || seat.clubId !== club.id || seat.archivedAt) throw notFound("Seat");
  if (!ELECTABLE_ROLES.includes(seat.role)) throw invalid("That seat can't be filled this way.");
  if (!inClubPipeline(seat.role, club.type)) throw invalid(`The college's ambassador program fills ${seat.name}. Ask for an ambassador from the org chart instead.`);

  const method = v.method ?? club.successionMethod;
  const now = new Date();
  const closes = v.votingClosesAt;
  const rules = selectionRulesFor(await clubRules(club.id));
  let opens = now;
  if (usesBallots(method)) {
    if (!v.votingOpensAt) throw invalid("Choose when voting opens.");
    opens = v.votingOpensAt;
    if (opens.getTime() < now.getTime()) throw invalid(method === "MEMBER_VOTE" ? "Voting has to open in the future, so members have time to run." : "Voting has to open in the future, so there's time to add candidates.");
    const raw = method === "MEMBER_VOTE" ? earliestVotingOpen(now, rules.noticeDays) : null;
    if (raw && opens.getTime() < raw.getTime() - NOTICE_GRACE_MS) {
      throw invalid(`${club.name}'s bylaws give members ${rules.noticeDays} day${rules.noticeDays === 1 ? "" : "s"}' notice before a vote, so voting can open ${when(noticeEarliest(now, rules.noticeDays)!)} at the earliest.`);
    }
    if (closes.getTime() - opens.getTime() < HOUR) throw invalid("Keep voting open for at least an hour.");
  } else if (closes.getTime() - now.getTime() < HOUR) {
    throw invalid(method === "NEXT_IN_LINE" ? "Give people at least an hour to answer." : "Choose a decide-by date at least an hour from now.");
  }
  if (closes.getTime() - now.getTime() > 180 * DAY) throw invalid("Choose a date within six months.");

  const pipeline = await clubPipeline(club.id);
  const pool = pipelineCandidates(pipeline.seats, seat.id, club.type, method);
  if (method === "NEXT_IN_LINE" && pool.length === 0) {
    throw invalid(`Nobody is next in line for ${seat.name}: the seats below it are empty. Choose another way to fill it.`);
  }
  return { actor: actor!, club, seat, method, title: v.title, opens, closes, pool, now, rules };
}

async function writeSelection(plan: Plan) {
  const { actor, club, seat, method, pool, now } = plan;
  const election = await db.$transaction(async (tx) => {
    const e = await tx.election.create({
      data: {
        clubId: club.id,
        positionId: seat.id,
        title: plan.title,
        method,
        status: method === "NEXT_IN_LINE" ? "VOTING" : "NOMINATING",
        votingOpensAt: plan.opens,
        votingClosesAt: plan.closes,
        createdById: actor.id,
        rules: selectionRulesJson(plan.rules),
      },
    });
    // createdAt keeps pipeline order: candidates are listed, and next in line is decided, in it.
    if (pool.length) {
      await tx.electionCandidate.createMany({
        data: pool.map((p, i) => ({ electionId: e.id, userId: p.userId, nominatedById: actor.id, fromPipeline: true, createdAt: new Date(now.getTime() + i) })),
      });
    }
    return e;
  });
  await logActivity({
    actorId: actor.id,
    action: "election.created",
    entityType: "election",
    entityId: election.id,
    clubId: club.id,
    data: { title: election.title, seat: seat.name, method, candidates: pool.length },
    isPublic: true,
  });
  await announceSelection(plan, election);
  return election;
}

/** Tells the people a new selection involves, the way its mode needs. */
async function announceSelection(plan: Plan, e: { id: string; title: string; votingOpensAt: Date; votingClosesAt: Date }) {
  const { actor, club, seat, method, pool } = plan;
  const ref = { id: e.id, club };
  const pipelineIds = pool.map((p) => p.userId);

  if (method === "NEXT_IN_LINE") {
    const asked = await db.electionCandidate.findMany({ where: { electionId: e.id }, select: { id: true, userId: true } });
    for (const c of asked) {
      await createTask({
        kind: "APPROVAL",
        title: `Move up to ${seat.name}?`,
        description: `You're next in line in ${club.name}. Say yes or no by ${when(e.votingClosesAt)}; the first in line who says yes takes the seat.`,
        assignee: { type: "USER", userId: c.userId },
        clubId: club.id,
        href: memberHref(ref),
        dueAt: e.votingClosesAt,
        source: { type: "electionAnswer", id: c.id },
        createdById: actor.id,
      });
    }
    await notify({
      userIds: pipelineIds,
      exceptUserId: actor.id,
      kind: "election.next_in_line",
      title: `Move up to ${seat.name} of ${club.name}?`,
      body: `You're next in line. Say yes or no by ${when(e.votingClosesAt)}. The first in line who says yes takes the seat.`,
      href: memberHref(ref),
    });
    return;
  }

  // Everyone added from the org chart hears they're a candidate, and that they can decline.
  await notify({
    userIds: pipelineIds,
    exceptUserId: actor.id,
    kind: "election.candidate_added",
    title: `You're a candidate for ${seat.name}`,
    body: `You're on ${club.name}'s org chart below ${seat.name}, so you're a candidate automatically. ${method === "MEMBER_VOTE" ? "Add a statement, or withdraw if you'd rather not run." : "You can withdraw if you'd rather not."}`,
    href: memberHref(ref),
  });
  if (method === "MEMBER_VOTE") {
    const members = await db.membership.findMany({ where: { clubId: club.id, status: "ACTIVE", user: { status: "ACTIVE", kind: "STUDENT" } }, select: { userId: true } });
    await notify({
      userIds: members.map((m) => m.userId).filter((id) => !pipelineIds.includes(id)),
      exceptUserId: actor.id,
      kind: "election.nominations_open",
      title: `Nominations are open: ${e.title}`,
      body: `Run for ${seat.name} in ${club.name} before voting opens ${when(e.votingOpensAt)}.${plan.rules.minEvents ? ` To vote, you'll need to have been to ${plan.rules.minEvents} club event${plan.rules.minEvents === 1 ? "" : "s"} this semester by then.` : ""}`,
      href: memberHref(ref),
    });
  } else if (method === "SELF_SELECT") {
    await notify({
      userIds: (await currentLeaderIds(club.id)).filter((id) => !pipelineIds.includes(id)),
      exceptUserId: actor.id,
      kind: "election.created",
      title: `${club.name}'s leaders will choose the next ${seat.name}`,
      body: `Voting opens ${when(e.votingOpensAt)}. It has to be unanimous, and no one votes for themselves.`,
      href: memberHref(ref),
      // A heads-up: they're emailed when voting opens.
      email: false,
    });
  } else {
    const keys = await keyHolders(club.id);
    await notify({
      userIds: [...keys.presidentIds, ...keys.advisorIds],
      exceptUserId: actor.id,
      kind: "election.created",
      title: `Choose the next ${seat.name} of ${club.name}`,
      body: `The President and the advisor decide together: one proposes a candidate and the other confirms. Decide by ${when(e.votingClosesAt)}.`,
      href: manageHref(ref),
    });
  }
}

/** One selection at a time per seat. */
async function seatBusy(positionId: string) {
  return (await db.election.count({ where: { positionId, status: { in: ["NOMINATING", "VOTING", "CLOSED"] } } })) > 0;
}

/**
 * Start filling a seat, in the club's primary mode or another one for this
 * seat. The people on the org chart below it become candidates right away
 * (only the next in line for NEXT_IN_LINE).
 */
export async function createElection(actor: Actor | null, input: unknown) {
  const plan = await planSelection(actor, input);
  if (await seatBusy(plan.seat.id)) throw conflict(`${plan.seat.name} is already being filled. Finish or cancel that one first.`);
  return writeSelection(plan);
}

/**
 * "Start again" / "Use another mode": cancels an unfinished selection (say,
 * one with no unanimous choice, or where nobody said yes) and starts a new one
 * for the same seat. The new one is checked before the old one is cancelled.
 */
export async function startOver(actor: Actor | null, electionId: string, input: unknown) {
  assertSignedIn(actor);
  const e = await loadSynced(electionId);
  const plan = await planSelection(actor, { ...(input && typeof input === "object" ? input : {}), clubId: e.clubId, positionId: e.position.id });
  if (e.status === "APPLIED" || e.status === "CANCELLED") throw invalid("This one is already finished. Start a new one from the elections page.");
  await cancelSelection(actor, e, { tellCandidates: false });
  return writeSelection(plan);
}

// ─── Candidates ──────────────────────────────────────────────────────────────

const NominateInput = z.object({
  userId: z.string().optional().nullable(),
  statement: z.string().trim().max(2000, "Keep statements under 2,000 characters.").optional().nullable(),
});

/**
 * Add a candidate beyond the pipeline: members run themselves in a member
 * vote; organizers (`elections`) can add any active member in a member vote,
 * self-select or Advisor & President selection. Next-in-line rounds ask only
 * the people next in line.
 */
export async function nominateCandidate(actor: Actor | null, electionId: string, input: unknown) {
  assertSignedIn(actor);
  const v = parse(NominateInput, input);
  const e = await loadSynced(electionId);
  if (!organizersAddCandidates(e.method)) throw invalid("In a next-in-line round, only the people next in line are asked.");
  if (e.status !== "NOMINATING") throw invalid(usesBallots(e.method) ? "Nominations are closed for this election." : "This seat has already been decided.");
  const nomineeId = v.userId || actor.id;
  const self = nomineeId === actor.id;
  if (!self || !canSelfNominate(e.method)) await assertClubCap(actor, e.clubId, "elections");
  const elig = await candidateEligibility(nomineeId, e.clubId);
  if (!elig.eligible) throw invalid(self ? (elig.reason ?? "You can't be a candidate here.") : `They can't be a candidate: ${elig.reason?.toLowerCase() ?? "not eligible"}`);

  let candidate;
  try {
    candidate = await db.electionCandidate.create({
      data: { electionId: e.id, userId: nomineeId, statement: v.statement || null, nominatedById: actor.id },
      include: { user: { select: { name: true } } },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict(self ? "You're already a candidate." : "They're already a candidate.");
    throw err;
  }
  await logActivity({ actorId: actor.id, action: "election.nominated", entityType: "election", entityId: e.id, clubId: e.clubId, data: { userId: nomineeId, self } });
  if (!self) {
    await notify({
      userIds: [nomineeId],
      kind: "election.nominated",
      title: `You're a candidate for ${e.position.name}`,
      body: `${actor.name} added you in ${e.club.name}. ${e.method === "MEMBER_VOTE" ? "Add a statement, or withdraw if you'd rather not run." : "You can withdraw if you'd rather not."}`,
      href: memberHref(e),
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
  if (e.status !== "NOMINATING") throw invalid(usesBallots(e.method) ? "Statements are locked once voting opens." : "This seat has already been decided.");
  const clean = parse(z.string().trim().max(2000, "Keep statements under 2,000 characters.").nullable(), statement) || null;
  await db.electionCandidate.update({ where: { id: c.id }, data: { statement: clean } });
  await logActivity({ actorId: actor.id, action: "election.statement_updated", entityType: "election", entityId: e.id, clubId: e.clubId });
}

type CandidateRow = { id: string; userId: string; user: { name: string } };

/** Takes someone off a selection: they withdrew, said no to moving up, or an organizer removed them. */
async function removeCandidate(actor: Actor, e: SyncedElection, c: CandidateRow, how: "withdrew" | "declined" | "removed") {
  const open = e.status === "NOMINATING" || (e.method === "NEXT_IN_LINE" && e.status === "VOTING");
  if (!open) throw invalid(usesBallots(e.method) ? "Voting has started, so the ballot is locked. An organizer can cancel the election if needed." : "This seat has already been decided.");
  const wasProposed = e.method === "ADVISOR_PRESIDENT" && e.proposedCandidateId === c.id;
  const proposerId = e.proposedById;
  await db.$transaction(async (tx) => {
    if (wasProposed) await tx.election.update({ where: { id: e.id }, data: { proposedCandidateId: null, proposedById: null, proposedAt: null } });
    await tx.electionCandidate.delete({ where: { id: c.id } });
    await resolveTasks("electionAnswer", c.id, actor.id, tx, how === "declined" ? "DONE" : "CANCELLED");
    if (wasProposed) await resolveTasks("electionProposal", e.id, actor.id, tx, "CANCELLED");
  });
  await logActivity({ actorId: actor.id, action: how === "declined" ? "election.declined" : "election.withdrawn", entityType: "election", entityId: e.id, clubId: e.clubId, data: { userId: c.userId, self: how !== "removed" } });
  if (how === "removed") {
    await notify({ userIds: [c.userId], kind: "election.withdrawn", title: `You're no longer a candidate for ${e.position.name}`, body: `${actor.name} took you off the list in ${e.club.name}.`, href: memberHref(e) });
  }
  if (wasProposed) {
    const keys = await keyHolders(e.clubId);
    await notify({
      userIds: [...(proposerId ? [proposerId] : []), ...keys.presidentIds, ...keys.advisorIds],
      exceptUserId: actor.id,
      kind: "election.proposal_withdrawn",
      title: `The proposal for ${e.position.name} is off`,
      body: `${c.user.name} is no longer a candidate in ${e.club.name}. Propose someone else.`,
      href: manageHref(e),
    });
  }
}

/** Withdraw a candidacy (the candidate, or an organizer) while the selection is open. */
export async function withdrawCandidate(actor: Actor | null, candidateId: string) {
  assertSignedIn(actor);
  const c = await db.electionCandidate.findUnique({ where: { id: candidateId }, include: { user: { select: { name: true } } } });
  if (!c) throw notFound("Candidate");
  const e = await loadSynced(c.electionId);
  const self = c.userId === actor.id;
  if (!self) await assertClubCap(actor, e.clubId, "elections");
  await removeCandidate(actor, e, c, self ? "withdrew" : "removed");
}

/** NEXT_IN_LINE: the person asked says yes (acceptedAt) or no (they come off the list). A yes can still be withdrawn until answers close. */
export async function answerMoveUp(actor: Actor | null, candidateId: string, yes: boolean) {
  assertSignedIn(actor);
  const c = await db.electionCandidate.findUnique({ where: { id: candidateId }, include: { user: { select: { name: true } } } });
  if (!c) throw notFound("Your place in line");
  if (c.userId !== actor.id) throw forbidden("Only the person who was asked can answer.");
  const e = await loadSynced(c.electionId);
  if (e.method !== "NEXT_IN_LINE") throw invalid("This seat isn't being filled from the next in line.");
  if (e.status !== "VOTING") throw invalid("Answers are closed for this seat.");
  if (!yes) return removeCandidate(actor, e, c, "declined");
  if (c.acceptedAt) return;
  await db.electionCandidate.update({ where: { id: c.id }, data: { acceptedAt: new Date() } });
  await resolveTasks("electionAnswer", c.id, actor.id);
  await logActivity({ actorId: actor.id, action: "election.accepted", entityType: "election", entityId: e.id, clubId: e.clubId, data: { userId: actor.id } });
  await notify({
    userIds: [e.createdById],
    exceptUserId: actor.id,
    kind: "election.accepted",
    title: `${actor.name} said yes to moving up to ${e.position.name}`,
    body: `The first in line who says yes by ${when(e.votingClosesAt)} takes the seat.`,
    href: manageHref(e),
  });
}

// ─── Running it ──────────────────────────────────────────────────────────────

/** Close nominations early and open voting now (ballot modes). */
export async function openVoting(actor: Actor | null, electionId: string) {
  const e = await loadSynced(electionId);
  await assertClubCap(actor, e.clubId, "elections");
  if (!usesBallots(e.method)) throw invalid("This selection has no ballots.");
  if (e.status !== "NOMINATING") throw invalid("Voting is already open or finished.");
  if (e._count.candidates === 0) throw invalid("Add at least one candidate before opening voting.");
  const now = new Date();
  const rules = readSelectionRules(e.rules);
  const earliest = e.method === "MEMBER_VOTE" ? earliestVotingOpen(e.createdAt, rules.noticeDays) : null;
  if (earliest && now < earliest) throw invalid(`${e.club.name}'s bylaws give members ${rules.noticeDays} day${rules.noticeDays === 1 ? "" : "s"}' notice before a vote, so voting can open from ${when(earliest)}.`);
  if (e.votingClosesAt.getTime() - now.getTime() < HOUR) throw invalid("Voting would close within the hour. Cancel this election and start a new one with a later closing time.");
  const r = await db.election.updateMany({ where: { id: e.id, status: "NOMINATING" }, data: { status: "VOTING", votingOpensAt: now } });
  if (r.count) await onVotingOpened(e, actor!.id, now);
}

/** End voting — or, next in line, answers — now, before the scheduled close. */
export async function closeVoting(actor: Actor | null, electionId: string) {
  const e = await loadSynced(electionId);
  await assertClubCap(actor, e.clubId, "elections");
  if (e.method === "ADVISOR_PRESIDENT") throw invalid("Advisor & President selections don't close: confirm or withdraw the proposal instead.");
  if (e.status !== "VOTING") throw invalid(e.method === "NEXT_IN_LINE" ? "Answers are already closed." : "Voting isn't open.");
  const r = await db.election.updateMany({ where: { id: e.id, status: "VOTING" }, data: { status: "CLOSED", votingClosesAt: new Date() } });
  if (r.count) await onVotingClosed(e, actor!.id);
}

async function cancelSelection(actor: Actor, e: SyncedElection, opts: { tellCandidates: boolean }) {
  if (e.status === "APPLIED" || e.status === "CANCELLED") throw invalid("This one is already finished.");
  const r = await db.election.updateMany({ where: { id: e.id, status: { in: ["NOMINATING", "VOTING", "CLOSED"] } }, data: { status: "CANCELLED" } });
  if (!r.count) throw conflict("This one just finished. Reload to see how.");
  const candidates = await db.electionCandidate.findMany({ where: { electionId: e.id }, select: { id: true, userId: true } });
  await resolveTasks("electionProposal", e.id, actor.id, db, "CANCELLED");
  for (const c of candidates) await resolveTasks("electionAnswer", c.id, actor.id, db, "CANCELLED");
  await logActivity({ actorId: actor.id, action: "election.cancelled", entityType: "election", entityId: e.id, clubId: e.clubId, isPublic: true });
  if (opts.tellCandidates) {
    await notify({ userIds: candidates.map((c) => c.userId), exceptUserId: actor.id, kind: "election.cancelled", title: `${e.title} was cancelled`, href: memberHref(e) });
  }
}

/** Call a selection off. Votes already cast are kept (still secret) but never counted toward a role. */
export async function cancelElection(actor: Actor | null, electionId: string) {
  const e = await loadSynced(electionId);
  await assertClubCap(actor, e.clubId, "elections");
  await cancelSelection(actor!, e, { tellCandidates: true });
}

// ─── Voting ──────────────────────────────────────────────────────────────────

/** Whether this person may vote in this selection, and why not (under an attendance rule, counted to when voting opened). */
export async function voterEligibility(userId: string, e: BallotFacts): Promise<VoterStatus> {
  if (!usesBallots(e.method)) return { eligible: false, reason: "This selection has no ballots." };
  return voterStatusIn(await voterRoll(e), userId);
}

export async function hasVoted(electionId: string, userId: string) {
  return (await db.vote.count({ where: { electionId, voterId: userId } })) > 0;
}

/** Cast a secret ballot. One per person; it can't be changed. No one votes for themselves in a self-select. */
export async function castVote(actor: Actor | null, electionId: string, candidateId: string) {
  assertSignedIn(actor);
  const e = await loadSynced(electionId);
  if (!usesBallots(e.method)) throw invalid("This selection has no ballots.");
  if (e.status !== "VOTING") throw invalid(e.status === "NOMINATING" ? "Voting hasn't opened yet." : "Voting has closed.");
  const elig = await voterEligibility(actor.id, e);
  if (!elig.eligible) throw forbidden(elig.reason);
  const candidate = await db.electionCandidate.findUnique({ where: { id: candidateId }, select: { id: true, electionId: true, userId: true } });
  if (!candidate || candidate.electionId !== e.id) throw notFound("Candidate");
  if (e.method === "SELF_SELECT" && candidate.userId === actor.id) throw forbidden("Leaders don't vote for themselves. Choose someone else.");
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
  /** SELF_SELECT: the unanimous choice's candidate id, or null when the leaders didn't agree. Always null otherwise. */
  unanimousCandidateId: string | null;
  /** MEMBER_VOTE under a quorum rule: the ballots needed and whether they came in. Null otherwise. */
  quorum: Quorum | null;
  /** The bylaw rules the selection froze when it started. */
  rules: SelectionRules;
};

/**
 * Counts per candidate for ballot modes, only once voting has closed. A vote
 * that closed and was then started over or sent to a runoff keeps its counts;
 * one called off before it closed never has them. Null before that, and for
 * modes without ballots.
 */
export async function electionResults(electionId: string): Promise<ElectionResults | null> {
  const e = await db.election.findUnique({ where: { id: electionId }, select: { id: true, clubId: true, method: true, status: true, votingOpensAt: true, rules: true, candidates: { select: { id: true, userId: true } } } });
  if (!e || !usesBallots(e.method) || e.status === "NOMINATING" || e.status === "VOTING") return null;
  const frozenRow = await db.activityLog.findFirst({ where: { action: "election.closed", entityType: "election", entityId: e.id }, orderBy: { at: "desc" }, select: { data: true } });
  if (e.status === "CANCELLED" && !frozenRow) return null;
  const grouped = await db.vote.groupBy({ by: ["candidateId"], where: { electionId: e.id }, _count: { _all: true } });
  const counts = new Map(grouped.map((g) => [g.candidateId, g._count._all]));
  const totalVotes = grouped.reduce((n, g) => n + g._count._all, 0);
  const frozen = (frozenRow?.data ?? null) as Record<string, unknown> | null;
  const live = typeof frozen?.eligibleVoters === "number" && (e.method !== "SELF_SELECT" || (frozen && "unanimous" in frozen)) ? null : await eligibleVoterIds(e);
  const eligibleVoters = typeof frozen?.eligibleVoters === "number" ? frozen.eligibleVoters : (live ?? []).length;
  const rows = e.candidates
    .map((c) => ({ candidateId: c.id, userId: c.userId, votes: counts.get(c.id) ?? 0, share: totalVotes ? (counts.get(c.id) ?? 0) / totalVotes : null }))
    .sort((a, b) => b.votes - a.votes);
  const top = rows[0]?.votes ?? 0;
  let unanimousCandidateId: string | null = null;
  if (e.method === "SELF_SELECT") {
    unanimousCandidateId = frozen && "unanimous" in frozen ? (typeof frozen.unanimous === "string" ? frozen.unanimous : null) : await unanimousOf(e.id, live ?? []);
  }
  const rules = readSelectionRules(e.rules);
  return {
    rows,
    totalVotes,
    eligibleVoters,
    turnout: eligibleVoters ? Math.min(1, totalVotes / eligibleVoters) : null,
    leaders: rows.filter((r) => r.votes === top).map((r) => r.candidateId),
    unanimousCandidateId,
    quorum: e.method === "MEMBER_VOTE" ? quorumOf({ quorumPercent: rules.quorumPercent, eligibleVoters, votes: totalVotes }) : null,
    rules,
  };
}

/**
 * MEMBER_VOTE: how a closed result settles. "noQuorum" can't be applied
 * (start again, or use another way); "tie" names who settles it under the
 * bylaws (a runoff, or who chooses); "winner" applies in one step.
 */
export type VoteOutcome = { kind: "none" } | { kind: "noQuorum"; quorum: Quorum } | { kind: "winner"; candidateId: string } | { kind: "tie"; candidateIds: string[]; resolution: TieResolution };

export async function voteOutcome(e: { clubId: string; method: SuccessionMethod }, results: ElectionResults, candidates: { id: string; userId: string }[]): Promise<VoteOutcome> {
  if (e.method !== "MEMBER_VOTE" || results.rows.length === 0) return { kind: "none" };
  if (results.quorum && !results.quorum.met) return { kind: "noQuorum", quorum: results.quorum };
  if (results.leaders.length === 1) return { kind: "winner", candidateId: results.leaders[0] };
  const keys = await keyHolders(e.clubId);
  const tiedUserIds = candidates.filter((c) => results.leaders.includes(c.id)).map((c) => c.userId);
  return { kind: "tie", candidateIds: results.leaders, resolution: tieResolution({ tieBreak: results.rules.tieBreak, isRunoff: Boolean(results.rules.runoffOf), ...keys, tiedUserIds }) };
}

/** NEXT_IN_LINE: who was asked, in pipeline order, who said yes, and who's first in line among them. */
export async function nextInLineOutcome(electionId: string) {
  const candidates = await db.electionCandidate.findMany({ where: { electionId }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, acceptedAt: true } });
  return { candidates, firstYesId: firstToAccept(candidates)?.id ?? null };
}

// ─── Filling the seat ────────────────────────────────────────────────────────

/** The rank rule: only someone who could assign the seat's role fills it (so a VP can't fill the President's seat). */
async function assertCanSeat(actor: Actor, e: SyncedElection): Promise<ClubAccess> {
  const access = await getClubAccess(actor, e.clubId);
  if (!access) throw notFound("Club");
  if (!access.assignableRoles.includes(e.position.role)) {
    throw forbidden(access.suspended ? "Your leadership permissions are paused until you finish your overdue WSUSA requirement." : `Only someone who can assign the ${ROLE_LABEL[e.position.role]} role can fill this seat.`);
  }
  return access;
}

type SeatOpts = {
  permissions?: string[];
  fromStatus: ElectionStatus;
  claimWhere?: Prisma.ElectionWhereInput;
  claimData?: { confirmedById: string; confirmedAt: Date };
  logData?: Record<string, unknown>;
};

/**
 * Puts the chosen person in the seat through the Org Chart path
 * (roles.assignRole), replacing whoever holds it now; a holder chosen again
 * keeps their seat (and its history). Whoever moves up leaves the seat they
 * moved up from (reason SUCCEEDED), which then shows as open in the pipeline.
 */
async function seatWinner(actor: Actor, access: ClubAccess, e: SyncedElection, winner: { id: string; userId: string }, opts: SeatOpts) {
  if (e.position.archivedAt) throw invalid(`${e.position.name} is archived. Restore the seat in the org chart first.`);
  const pipeline = await clubPipeline(e.clubId);
  const movingFrom = leadersBelow(pipeline.seats, e.position.id, pipeline.clubType).find((p) => p.userId === winner.userId) ?? null;
  const full = access.viaPlatform !== null || access.isAdvisor;
  if (movingFrom && !full && !access.assignableRoles.includes(movingFrom.role)) throw forbidden(`Only someone who can assign the ${ROLE_LABEL[movingFrom.role]} role can move them up from ${movingFrom.seatName}.`);

  // Claim the selection first so two people can't fill the seat at once.
  const claimed = await db.election.updateMany({
    where: { id: e.id, status: opts.fromStatus, ...opts.claimWhere },
    data: { status: "APPLIED", winnerId: winner.userId, appliedAt: new Date(), ...opts.claimData },
  });
  if (!claimed.count) throw conflict("This seat was already filled from this selection, or the selection just changed. Reload to see it.");
  try {
    const holders = await db.roleAssignment.findMany({ where: { positionId: e.position.id, endedAt: null } });
    if (holders.some((h) => h.userId === winner.userId)) {
      for (const h of holders) if (h.userId !== winner.userId) await endRoleAssignment(actor, h.id, "TERM_ENDED", e.title);
    } else {
      await assignRole(actor, { clubId: e.clubId, userId: winner.userId, positionId: e.position.id, permissions: opts.permissions, replaceAssignmentIds: holders.map((h) => h.id) });
    }
  } catch (err) {
    await db.election.update({ where: { id: e.id }, data: { status: opts.fromStatus, winnerId: null, appliedAt: null, ...(opts.claimData ? { confirmedById: null, confirmedAt: null } : {}) } });
    throw err;
  }
  if (movingFrom) await endRoleAssignment(actor, movingFrom.assignmentId, "SUCCEEDED", `Moved up to ${e.position.name}`);

  await logActivity({
    actorId: actor.id,
    action: "election.applied",
    entityType: "election",
    entityId: e.id,
    clubId: e.clubId,
    data: { title: e.title, method: e.method, seat: e.position.name, winnerId: winner.userId, ...(movingFrom ? { movedUpFrom: movingFrom.seatName } : {}), ...opts.logData } as Prisma.InputJsonObject,
    isPublic: true,
  });
  const [others, winnerUser] = await Promise.all([
    db.electionCandidate.findMany({ where: { electionId: e.id, userId: { not: winner.userId } }, select: { userId: true } }),
    db.user.findUnique({ where: { id: winner.userId }, select: { name: true } }),
  ]);
  await notify({
    userIds: others.map((c) => c.userId),
    exceptUserId: actor.id,
    kind: "election.applied",
    title: `${winnerUser?.name ?? "Someone"} is now ${e.position.name} of ${e.club.name}`,
    body: opts.logData?.tieBroken
      ? `The vote was tied; ${opts.logData.tieBrokenBy === "wsusa" ? (await officeForClub(e.clubId)).name : (TIE_SETTLED_BY[String(opts.logData.tieBrokenBy)] ?? "the organizer")} chose between the tied candidates.`
      : undefined,
    href: memberHref(e),
  });
  return { winnerUserId: winner.userId, movedUpFrom: movingFrom?.seatName ?? null, tieBroken: Boolean(opts.logData?.tieBroken) };
}

const ApplyInput = z.object({
  winnerCandidateId: z.string().optional().nullable(),
  /** Officer / ambassador seats: what the winner may do (the same setup step as the Org Chart). Defaults to the seat's defaults. */
  permissions: z.array(z.string()).optional(),
});

/**
 * Fill the seat from a closed selection: a member vote's winner (the applier
 * picks among tied candidates, and that's recorded), a self-select's
 * unanimous choice, or the first in line who said yes. Only someone who could
 * assign the seat's role may apply it. Advisor & President selections fill
 * the seat when the proposal is confirmed instead.
 */
export async function applyElectionResult(actor: Actor | null, electionId: string, input: unknown) {
  assertSignedIn(actor);
  const v = parse(ApplyInput, input);
  const e = await loadSynced(electionId);
  if (e.method === "ADVISOR_PRESIDENT") throw invalid("Confirm the proposal instead: confirming fills the seat.");
  const access = await assertCanSeat(actor, e);
  if (e.status === "APPLIED") throw conflict("This seat was already filled from this selection.");
  if (e.status !== "CLOSED") throw invalid(e.method === "NEXT_IN_LINE" ? "Close answers before moving someone up." : "Close voting before applying the result.");

  if (e.method === "NEXT_IN_LINE") {
    const { candidates, firstYesId } = await nextInLineOutcome(e.id);
    const first = candidates.find((c) => c.id === firstYesId);
    if (!first) throw invalid("Nobody said yes, so there's no one to move up. Start again with another way to fill the seat.");
    if (v.winnerCandidateId && v.winnerCandidateId !== first.id) throw invalid("Someone ahead of them in line said yes.");
    return seatWinner(actor, access, e, first, { permissions: v.permissions, fromStatus: "CLOSED", logData: { nextInLine: true } });
  }

  const results = await electionResults(e.id);
  if (!results || results.rows.length === 0) throw invalid("No one ran in this election. Cancel it instead.");
  if (e.method === "SELF_SELECT") {
    const choice = results.rows.find((r) => r.candidateId === results.unanimousCandidateId);
    if (!choice) throw invalid("The leaders didn't choose unanimously, so this can't be applied. Start again, or use another way to fill the seat.");
    if (v.winnerCandidateId && v.winnerCandidateId !== choice.candidateId) throw invalid("That isn't who the leaders chose.");
    return seatWinner(actor, access, e, { id: choice.candidateId, userId: choice.userId }, { permissions: v.permissions, fromStatus: "CLOSED", logData: { votes: choice.votes, unanimous: true } });
  }

  // Member vote: the bylaws decide whether it counts (quorum) and who settles a tie.
  const outcome = await voteOutcome(e, results, results.rows.map((r) => ({ id: r.candidateId, userId: r.userId })));
  if (outcome.kind === "noQuorum") {
    throw invalid(`No quorum: ${results.totalVotes} of ${results.eligibleVoters} eligible voters voted, and ${e.club.name}'s bylaws need ${outcome.quorum.needed}, so the result doesn't count. Start again, or fill the seat another way.`);
  }
  if (outcome.kind === "none") throw invalid("No one ran in this election. Cancel it instead.");
  let winnerId: string;
  let tieBrokenBy: string | null = null;
  if (outcome.kind === "winner") {
    winnerId = outcome.candidateId;
    if (v.winnerCandidateId && v.winnerCandidateId !== winnerId) throw invalid("That candidate didn't win.");
  } else {
    const res = outcome.resolution;
    if (res.kind === "runoff") throw invalid(`It's a tie, and ${e.club.name}'s bylaws settle ties with a runoff between the tied candidates. Start the runoff instead.`);
    const named = res.by === "advisor" || res.by === "president";
    if (access.viaPlatform === null && (res.by === "wsusa" || (named && !res.userIds.includes(actor.id)))) {
      throw forbidden(
        res.by === "wsusa"
          ? `It's a tie, and nobody in the club can settle it under its bylaws, so ${(await officeForClub(e.clubId)).name} does.`
          : `It's a tie, and under ${e.club.name}'s bylaws the ${res.by === "advisor" ? "advisor" : "President"} casts the deciding vote.`,
      );
    }
    if (!v.winnerCandidateId) throw conflict("It's a tie. Choose the winner from the tied candidates.");
    if (!outcome.candidateIds.includes(v.winnerCandidateId)) throw invalid("Choose one of the tied candidates.");
    winnerId = v.winnerCandidateId;
    tieBrokenBy = named && res.userIds.includes(actor.id) ? res.by : access.viaPlatform !== null && res.by !== "organizer" ? "wsusa" : res.by;
  }
  const tieBroken = outcome.kind === "tie";
  const winner = results.rows.find((r) => r.candidateId === winnerId)!;
  return seatWinner(actor, access, e, { id: winner.candidateId, userId: winner.userId }, {
    permissions: v.permissions,
    fromStatus: "CLOSED",
    logData: { votes: winner.votes, tieBroken, ...(tieBroken ? { tiedCandidateIds: results.leaders, tieBrokenBy } : {}) },
  });
}

/** Who settled a tie, as the winner's notice says it. "wsusa" is the club's office (lib/offices), named at the call. */
const TIE_SETTLED_BY: Record<string, string> = { advisor: "the advisor", president: "the President", wsusa: "WSUSA", organizer: "the organizer" };

const RunoffInput = z.object({ votingClosesAt: z.coerce.date({ error: "Choose when the runoff closes." }) });

const runoffTitle = (title: string) => (title.endsWith(" — runoff") ? title : `${title.slice(0, 110)} — runoff`);

/**
 * A tied member vote whose bylaws call for a runoff: the tied candidates go
 * on a new ballot that opens right away (the vote was announced already, so
 * there's no notice period again), under the same frozen rules. The tied
 * vote ends (CANCELLED, its counts kept) and the runoff points back at it
 * (rules.runoffOf). If the runoff ties too, the advisor decides.
 */
export async function startRunoff(actor: Actor | null, electionId: string, input: unknown) {
  assertSignedIn(actor);
  const v = parse(RunoffInput, input);
  const e = await loadSynced(electionId);
  await assertClubCap(actor, e.clubId, "elections");
  if (e.method !== "MEMBER_VOTE" || e.status !== "CLOSED") throw invalid("Only a closed member vote that tied goes to a runoff.");
  const results = await electionResults(e.id);
  if (!results) throw invalid("Only a closed member vote that tied goes to a runoff.");
  const candidates = await db.electionCandidate.findMany({ where: { electionId: e.id }, orderBy: { createdAt: "asc" } });
  const outcome = await voteOutcome(e, results, candidates);
  if (outcome.kind !== "tie") throw invalid(outcome.kind === "noQuorum" ? "Too few members voted for this result to count, so there's no tie to settle. Start again instead." : "This vote isn't tied.");
  if (outcome.resolution.kind !== "runoff") throw invalid("The bylaws settle this tie by choosing between the tied candidates, not with a runoff.");
  const now = new Date();
  const closes = v.votingClosesAt;
  if (closes.getTime() - now.getTime() < HOUR) throw invalid("Keep the runoff open for at least an hour.");
  if (closes.getTime() - now.getTime() > 180 * DAY) throw invalid("Choose a date within six months.");

  const claimed = await db.election.updateMany({ where: { id: e.id, status: "CLOSED" }, data: { status: "CANCELLED" } });
  if (!claimed.count) throw conflict("This vote just changed. Reload to see it.");
  const tied = candidates.filter((c) => outcome.candidateIds.includes(c.id));
  const rules: SelectionRules = { ...results.rules, noticeDays: null, runoffOf: e.id };
  const runoff = await db.$transaction(async (tx) => {
    const r = await tx.election.create({
      data: { clubId: e.clubId, positionId: e.position.id, title: runoffTitle(e.title), method: "MEMBER_VOTE", status: "VOTING", votingOpensAt: now, votingClosesAt: closes, createdById: actor.id, rules: selectionRulesJson(rules) },
    });
    await tx.electionCandidate.createMany({
      data: tied.map((c, i) => ({ electionId: r.id, userId: c.userId, statement: c.statement, nominatedById: c.nominatedById, fromPipeline: c.fromPipeline, createdAt: new Date(now.getTime() + i) })),
    });
    return r;
  });
  await logActivity({ actorId: actor.id, action: "election.created", entityType: "election", entityId: runoff.id, clubId: e.clubId, data: { title: runoff.title, seat: e.position.name, method: "MEMBER_VOTE", candidates: tied.length, runoffOf: e.id }, isPublic: true });
  const opened = await syncElection(runoff.id);
  if (opened) await onVotingOpened(opened, actor.id, now);
  return runoff;
}

/** The runoff that settled a tied member vote, if it went to one. */
export async function runoffFor(electionId: string) {
  return db.election.findFirst({ where: { rules: { path: ["runoffOf"], equals: electionId } }, select: { id: true, title: true, status: true } });
}

// ─── Advisor & President ─────────────────────────────────────────────────────

async function loadAdvisorPresident(electionId: string) {
  const e = await loadSynced(electionId);
  if (e.method !== "ADVISOR_PRESIDENT") throw invalid("This seat isn't being filled by the advisor and the President.");
  if (e.status === "APPLIED") throw conflict("This seat was already filled from this selection.");
  if (e.status !== "NOMINATING") throw invalid("This selection is closed.");
  return e;
}

/** The candidate row a proposal points at, and who may confirm it (lib/roles/pipeline confirmersFor). */
async function proposalState(e: SyncedElection) {
  const c = e.proposedCandidateId ? await db.electionCandidate.findUnique({ where: { id: e.proposedCandidateId }, include: { user: { select: { name: true } } } }) : null;
  const keys = await keyHolders(e.clubId);
  const confirmers = c ? confirmersFor({ ...keys, proposerId: e.proposedById ?? "", candidateUserId: c.userId, seatRole: e.position.role }) : [];
  return { candidate: c, keys, confirmers };
}

/**
 * The President or an advisor (or an admin) proposes one candidate. Whoever
 * confirms it — the other side — gets an APPROVAL task. If nobody else can
 * (no advisor, say), the proposer confirms it themselves next.
 */
export async function proposeCandidate(actor: Actor | null, electionId: string, candidateId: string) {
  assertSignedIn(actor);
  const e = await loadAdvisorPresident(electionId);
  if (e.proposedCandidateId) throw conflict("Someone is already proposed. Withdraw that proposal first.");
  const access = await assertCanSeat(actor, e);
  const keys = await keyHolders(e.clubId);
  if (access.viaPlatform === null && !isKeyHolder(actor.id, keys)) throw forbidden("Only the President or an advisor can propose someone.");
  const c = await db.electionCandidate.findUnique({ where: { id: String(candidateId) }, include: { user: { select: { name: true } } } });
  if (!c || c.electionId !== e.id) throw notFound("Candidate");
  const r = await db.election.updateMany({ where: { id: e.id, status: "NOMINATING", proposedCandidateId: null }, data: { proposedCandidateId: c.id, proposedById: actor.id, proposedAt: new Date() } });
  if (!r.count) throw conflict("Someone else just made a proposal. Reload to see it.");

  const confirmers = confirmersFor({ ...keys, proposerId: actor.id, candidateUserId: c.userId, seatRole: e.position.role });
  const others = confirmers.filter((id) => id !== actor.id);
  const task = {
    kind: "APPROVAL" as const,
    title: `Confirm ${c.user.name} as ${e.position.name}`,
    description: `${actor.name} proposed ${c.user.name} for ${e.position.name} of ${e.club.name}. Confirming puts them in the seat; you can also send it back.`,
    clubId: e.clubId,
    href: manageHref(e),
    dueAt: e.votingClosesAt,
    source: { type: "electionProposal", id: e.id },
    createdById: actor.id,
  };
  for (const userId of others) await createTask({ ...task, assignee: { type: "USER", userId } });
  // Nobody in the club can confirm it (a President proposed for their own seat with no advisor): the club's office can (createTask routes it).
  if (!confirmers.length && access.viaPlatform === null) await createTask({ ...task, assignee: { type: "ADMINS" } });

  await logActivity({ actorId: actor.id, action: "election.proposed", entityType: "election", entityId: e.id, clubId: e.clubId, data: { userId: c.userId } });
  await notify({
    userIds: others,
    kind: "election.proposed",
    title: `Waiting on you: ${c.user.name} for ${e.position.name}`,
    body: `${actor.name} proposed ${c.user.name} for ${e.position.name} of ${e.club.name}. Confirm it, or send it back.`,
    href: manageHref(e),
  });
  await notify({
    userIds: [c.userId],
    exceptUserId: actor.id,
    kind: "election.proposed",
    title: `You've been proposed for ${e.position.name}`,
    body: `${actor.name} proposed you for ${e.position.name} of ${e.club.name}. It takes effect once it's confirmed. You can withdraw if you'd rather not.`,
    href: memberHref(e),
    // A heads-up for the candidate; the people who must confirm it are emailed above.
    email: false,
  });
  return { canConfirmNow: confirmers.includes(actor.id), waitingOn: others.length };
}

/**
 * Takes a proposal back before it's confirmed: the proposer (or an admin)
 * withdraws it, or whoever would confirm it sends it back. Either way the
 * selection stays open for a new proposal.
 */
export async function withdrawProposal(actor: Actor | null, electionId: string) {
  assertSignedIn(actor);
  const e = await loadAdvisorPresident(electionId);
  if (!e.proposedCandidateId) throw invalid("There's no proposal waiting.");
  const access = await getClubAccess(actor, e.clubId);
  const { candidate, confirmers } = await proposalState(e);
  const proposer = e.proposedById === actor.id;
  const admin = Boolean(access?.viaPlatform);
  const sendingBack = !proposer && confirmers.includes(actor.id);
  if (!proposer && !admin && !sendingBack) throw forbidden("Only the person who proposed it can withdraw it.");
  const r = await db.election.updateMany({ where: { id: e.id, status: "NOMINATING", proposedCandidateId: e.proposedCandidateId }, data: { proposedCandidateId: null, proposedById: null, proposedAt: null } });
  if (!r.count) throw conflict("The proposal just changed. Reload to see it.");
  await resolveTasks("electionProposal", e.id, actor.id, db, "CANCELLED");
  await logActivity({ actorId: actor.id, action: proposer ? "election.proposal_withdrawn" : "election.proposal_declined", entityType: "election", entityId: e.id, clubId: e.clubId, data: { userId: candidate?.userId ?? null } });
  const name = candidate?.user.name ?? "the candidate";
  if (proposer) {
    await notify({ userIds: confirmers, exceptUserId: actor.id, kind: "election.proposal_withdrawn", title: `${actor.name} withdrew the proposal of ${name} for ${e.position.name}`, href: manageHref(e) });
  } else if (e.proposedById) {
    await notify({
      userIds: [e.proposedById],
      exceptUserId: actor.id,
      kind: "election.proposal_declined",
      title: `${actor.name} didn't confirm ${name} for ${e.position.name}`,
      body: "Talk it over, then propose someone again. Anyone on the list can be proposed.",
      href: manageHref(e),
    });
  }
}

const ConfirmInput = z.object({
  /** Officer / ambassador seats: what they may do (pre-filled from the seat's defaults). */
  permissions: z.array(z.string()).optional(),
});

/**
 * The other side confirms the proposal, which fills the seat. Admins may
 * always confirm; the person proposed for President never confirms it.
 */
export async function confirmProposal(actor: Actor | null, electionId: string, input: unknown = {}) {
  assertSignedIn(actor);
  const v = parse(ConfirmInput, input ?? {});
  const e = await loadAdvisorPresident(electionId);
  if (!e.proposedCandidateId) throw invalid("Nobody has been proposed yet.");
  const access = await assertCanSeat(actor, e);
  const { candidate, confirmers } = await proposalState(e);
  if (!candidate || candidate.electionId !== e.id) throw conflict("The proposed candidate is no longer on the list. Propose someone else.");
  if (e.position.role === "PRESIDENT" && candidate.userId === actor.id) throw forbidden("You can't be the one to confirm your own appointment as President.");
  if (access.viaPlatform === null && !confirmers.includes(actor.id)) {
    throw forbidden(
      e.proposedById === actor.id
        ? "You proposed this, so the other side confirms it: an advisor confirms the President's proposal, and the President confirms an advisor's."
        : "Only the President or an advisor (whoever didn't propose it) can confirm.",
    );
  }
  const result = await seatWinner(actor, access, e, candidate, {
    permissions: v.permissions,
    fromStatus: "NOMINATING",
    claimWhere: { proposedCandidateId: candidate.id },
    claimData: { confirmedById: actor.id, confirmedAt: new Date() },
    logData: { proposedById: e.proposedById, confirmedById: actor.id },
  });
  await resolveTasks("electionProposal", e.id, actor.id);
  return result;
}
