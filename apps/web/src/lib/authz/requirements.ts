import "server-only";
import { cache } from "react";
import type { ClubRole, Prisma, RenewalPeriod, RoleRequirement, Term } from "@prisma/client";
import { db } from "@/lib/db";
import { getTerms } from "@/lib/terms";
import {
  awaitingGrade,
  fulfillmentOf,
  periodStartIn,
  requirementState,
  seatDueAt,
  seatStatus,
  type Fulfillment,
  type RequirementEvidence,
  type RequirementState,
  type SeatClock,
  type TermLike,
} from "@/lib/authz/requirement-rules";

/**
 * Requirements (tests, forms and trainings WSUSA sets for members and
 * student leaders). Fulfillment is computed from the Test Tool (passed
 * attempts; a submitted form counts as passed) and the Attendance Tool
 * (training check-ins) — never stored separately, so the gate can't disagree
 * with the records it's based on.
 *
 * Each requirement must be met within `graceDays` of the latest of: taking
 * the role (or joining, for MEMBER), the club's approval, the start of the
 * renewal period, and the day the requirement was added (so a new one never
 * starts out overdue). Past that a leader role's capabilities pause until
 * it's done (graceDays = 0 makes it a hard gate); members have nothing to pause.
 * A test handed in by the deadline that's waiting for a grader isn't overdue
 * (lib/authz/requirement-rules): nobody is paused over a grader's delay.
 *
 * One evaluator answers for one person (requirementStatus, for getClubAccess)
 * and for everyone at once (loadRequirementBatch, for the sweep and the admin
 * views): it loads what the rule reads in one query per kind, then decides
 * with the pure rule in requirement-rules. "Met" depends only on the person
 * and the period, so it's decided once per person and requirement; the
 * deadline, and with it due, overdue or waiting for grading, per seat.
 */

export type RequirementItem = {
  requirement: Pick<RoleRequirement, "id" | "name" | "description" | "kind" | "testId" | "trainingEventId" | "renewal" | "graceDays">;
  met: boolean;
  /** Handed in by the deadline and waiting for a grader: not met yet, but not overdue either. */
  awaitingGrade: boolean;
  /** An attempt this period is waiting for a grader, on time or not. */
  gradingPending: boolean;
  periodStart: Date;
  dueAt: Date;
  overdue: boolean;
  state: RequirementState;
};

export type RequirementStatus = { items: RequirementItem[]; overdue: boolean; allMet: boolean };

/** Requirements in the order the rule walks them (and task notices name them): oldest first, then by name. */
export const REQUIREMENT_ORDER = [{ createdAt: "asc" }, { name: "asc" }, { id: "asc" }] satisfies Prisma.RoleRequirementOrderByWithRelationInput[];

/** Active requirements, in REQUIREMENT_ORDER (read once per request). */
const activeRequirements = cache(async () => db.roleRequirement.findMany({ where: { active: true }, orderBy: REQUIREMENT_ORDER }));

/** Only semester and academic-year periods read the calendar. */
const readsTerms = (renewal: RenewalPeriod) => renewal === "SEMESTER" || renewal === "ACADEMIC_YEAR";

export async function periodStartFor(renewal: RenewalPeriod, at: Date): Promise<Date> {
  return periodStartIn(renewal, at, readsTerms(renewal) ? await getTerms() : []);
}

/**
 * Each renewal period's start at `at`, and how far back each kind of
 * evidence counts: the earliest period among the requirements that read it
 * (member details aren't dated by period, so they don't push it back).
 */
function periodStarts(requirements: readonly RoleRequirement[], at: Date, terms: readonly TermLike[]) {
  const starts = new Map<RenewalPeriod, Date>();
  for (const r of requirements) if (!starts.has(r.renewal)) starts.set(r.renewal, periodStartIn(r.renewal, at, terms));
  const earliest = (kind: RoleRequirement["kind"]) => Math.min(Number.MAX_SAFE_INTEGER, ...requirements.filter((r) => r.kind === kind).map((r) => starts.get(r.renewal)!.getTime()));
  return { starts, since: { tests: earliest("TEST"), trainings: earliest("TRAINING") } };
}

/** Evidence cut-offs, as epoch ms (primitive, so per-request caching can key on them). */
type EvidenceSince = { tests: number; trainings: number };

type EvidenceRows = { attempts: RequirementEvidence["attempts"][number][]; lastCheckIn: Map<string, Date>; person: RequirementEvidence["person"] };

const NO_CHECK_INS: ReadonlyMap<string, Date> = new Map();

/** Above this many people, evidence is read for whole periods instead of by person (one long id list costs more). */
const BULK_PEOPLE = 200;

/**
 * The evidence for `userIds`, in one query per kind: attempts on requirement
 * tests that passed or wait for a grader, check-ins at training events (each
 * since its cut-off), and member details (only while a PROFILE requirement is on).
 */
async function loadEvidence(userIds: readonly string[], requirements: readonly RoleRequirement[], since: EvidenceSince): Promise<Map<string, RequirementEvidence>> {
  const out = new Map<string, EvidenceRows>();
  if (!userIds.length || !requirements.length) return out;
  const testIds = [...new Set(requirements.flatMap((r) => (r.kind === "TEST" && r.testId ? [r.testId] : [])))];
  const eventIds = [...new Set(requirements.flatMap((r) => (r.kind === "TRAINING" && r.trainingEventId ? [r.trainingEventId] : [])))];
  const profile = requirements.some((r) => r.kind === "PROFILE");
  const who = userIds.length > BULK_PEOPLE ? {} : { userId: { in: [...userIds] } };
  const [attempts, checkIns, people] = await Promise.all([
    testIds.length
      ? db.testAttempt.findMany({
          where: { testId: { in: testIds }, submittedAt: { gte: new Date(since.tests) }, OR: [{ passed: true }, { status: "NEEDS_REVIEW" }], ...who },
          select: { userId: true, testId: true, status: true, passed: true, submittedAt: true },
        })
      : [],
    eventIds.length
      ? db.attendance.findMany({ where: { checkedInAt: { gte: new Date(since.trainings) }, occurrence: { eventId: { in: eventIds } }, ...who }, select: { userId: true, checkedInAt: true, occurrence: { select: { eventId: true } } } })
      : [],
    profile ? db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, kind: true, details: true } }) : [],
  ]);
  const wanted = new Set(userIds);
  const evidence = (userId: string) => {
    let e = out.get(userId);
    if (!e) out.set(userId, (e = { attempts: [], lastCheckIn: new Map(), person: null }));
    return e;
  };
  for (const a of attempts) if (wanted.has(a.userId)) evidence(a.userId).attempts.push(a);
  for (const c of checkIns) {
    if (!wanted.has(c.userId)) continue;
    const last = evidence(c.userId).lastCheckIn;
    const prev = last.get(c.occurrence.eventId);
    if (!prev || c.checkedInAt > prev) last.set(c.occurrence.eventId, c.checkedInAt);
  }
  for (const p of people) evidence(p.id).person = { kind: p.kind, details: p.details };
  return out;
}

const emptyEvidence = (): RequirementEvidence => ({ attempts: [], lastCheckIn: NO_CHECK_INS, person: null });

/**
 * The rule for many people at once (the sweep, admin compliance, advisor
 * dashboards): everything is loaded up front, so answering for 800 people
 * costs the same handful of queries as answering for one.
 */
export type RequirementBatch = {
  readonly at: Date;
  /** The requirements it decides (the active ones unless given), in REQUIREMENT_ORDER. */
  readonly requirements: readonly RoleRequirement[];
  /** The academic calendar, when a requirement renews by it (for renewalCycle). */
  readonly terms: Term[];
  /** When a batch requirement's current renewal period started. */
  periodStart(r: RoleRequirement): Date;
  /** Met this period? Decided once per person and requirement. */
  fulfillment(userId: string, r: RoleRequirement): Fulfillment;
  /** Kind and member details (loaded while a PROFILE requirement is on; null otherwise). */
  person(userId: string): RequirementEvidence["person"];
  /** One requirement through one seat (requirementStatus's item). */
  item(userId: string, r: RoleRequirement, seat: SeatClock): RequirementItem;
  /** requirementStatus for one person in a role. */
  status(userId: string, role: ClubRole, seat: SeatClock): RequirementStatus;
};

function makeBatch(at: Date, requirements: readonly RoleRequirement[], terms: Term[], starts: Map<RenewalPeriod, Date>, evidence: Map<string, RequirementEvidence>): RequirementBatch {
  const met = new Map<string, Fulfillment>();
  const fulfillment = (userId: string, r: RoleRequirement) => {
    const key = `${userId}:${r.id}`;
    let f = met.get(key);
    if (!f) met.set(key, (f = fulfillmentOf(r, starts.get(r.renewal)!, evidence.get(userId) ?? emptyEvidence())));
    return f;
  };
  const item = (userId: string, r: RoleRequirement, seat: SeatClock): RequirementItem => ({ requirement: r, ...seatStatus(r, starts.get(r.renewal)!, fulfillment(userId, r), seat, at) });
  return {
    at,
    requirements,
    terms,
    periodStart: (r) => starts.get(r.renewal) ?? periodStartIn(r.renewal, at, terms),
    fulfillment,
    person: (userId) => evidence.get(userId)?.person ?? null,
    item,
    status(userId, role, seat) {
      const items = requirements.filter((r) => r.appliesTo.includes(role)).map((r) => item(userId, r, seat));
      return { items, overdue: items.some((i) => i.overdue), allMet: items.every((i) => i.met) };
    },
  };
}

/** Loads the rule's inputs for these people (and these requirements: the active ones unless given). */
export async function loadRequirementBatch(userIds: readonly string[], opts: { at?: Date; requirements?: RoleRequirement[] } = {}): Promise<RequirementBatch> {
  const at = opts.at ?? new Date();
  const requirements = opts.requirements ?? (await activeRequirements());
  const terms = requirements.some((r) => readsTerms(r.renewal)) ? await getTerms() : [];
  const { starts, since } = periodStarts(requirements, at, terms);
  return makeBatch(at, requirements, terms, starts, await loadEvidence(userIds, requirements, since));
}

/** One person's evidence, read once per request however many clubs and roles ask (getClubAccess asks per club). */
const personEvidence = cache(async (userId: string, tests: number, trainings: number) => (await loadEvidence([userId], await activeRequirements(), { tests, trainings })).get(userId) ?? emptyEvidence());

export async function requirementStatus(userId: string, role: ClubRole, ctx: { assignmentStartedAt: Date; clubApprovedAt: Date | null; at?: Date }): Promise<RequirementStatus> {
  const at = ctx.at ?? new Date();
  const all = await activeRequirements();
  if (!all.some((r) => r.appliesTo.includes(role))) return { items: [], overdue: false, allMet: true };
  const terms = all.some((r) => readsTerms(r.renewal)) ? await getTerms() : [];
  const { starts, since } = periodStarts(all, at, terms);
  const evidence = new Map([[userId, await personEvidence(userId, since.tests, since.trainings)]]);
  return makeBatch(at, all, terms, starts, evidence).status(userId, role, { startedAt: ctx.assignmentStartedAt, clubApprovedAt: ctx.clubApprovedAt });
}

type TaskLike = { id: string; status: string; sourceType: string | null; sourceId: string | null; assigneeId: string | null; dueAt: Date | null };

/**
 * Open requirement and test tasks whose attempt was handed in by the task's
 * deadline and is waiting for a grader (the rule above, and
 * tests.markMissedAssignments for test assignments). They aren't overdue:
 * every list shows them as "Submitted — waiting for grading". Returns their ids.
 */
export async function tasksAwaitingGrade(tasks: readonly TaskLike[], at: Date = new Date()): Promise<Set<string>> {
  const out = new Set<string>();
  const open = tasks.filter((t) => t.status === "OPEN" && t.assigneeId && t.sourceId && (t.sourceType === "requirement" || t.sourceType === "testAssignment"));
  if (!open.length) return out;
  const attempts = await db.testAttempt.findMany({
    where: { status: "NEEDS_REVIEW", userId: { in: [...new Set(open.map((t) => t.assigneeId!))] } },
    select: { testId: true, userId: true, cycleKey: true, status: true, submittedAt: true },
  });
  if (!attempts.length) return out;
  const waitingUsers = new Set(attempts.map((a) => a.userId));
  const candidates = open.filter((t) => waitingUsers.has(t.assigneeId!));
  const reqIds = [...new Set(candidates.filter((t) => t.sourceType === "requirement").map((t) => t.sourceId!.split(":")[0]))];
  const assignmentIds = candidates.filter((t) => t.sourceType === "testAssignment").map((t) => t.sourceId!);
  const [reqs, assignments] = await Promise.all([
    reqIds.length ? db.roleRequirement.findMany({ where: { id: { in: reqIds }, kind: "TEST", testId: { not: null } }, select: { id: true, testId: true, renewal: true } }) : [],
    assignmentIds.length ? db.testAssignment.findMany({ where: { id: { in: assignmentIds } }, select: { id: true, testId: true, cycleKey: true, dueAt: true } }) : [],
  ]);
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const starts = new Map<RenewalPeriod, Date>();
  for (const t of candidates) {
    if (t.sourceType === "requirement") {
      const r = reqById.get(t.sourceId!.split(":")[0]);
      if (!r) continue;
      if (!starts.has(r.renewal)) starts.set(r.renewal, await periodStartFor(r.renewal, at));
      const since = starts.get(r.renewal)!;
      const mine = attempts.filter((a) => a.userId === t.assigneeId && a.testId === r.testId && a.submittedAt && a.submittedAt >= since);
      if (awaitingGrade(mine, t.dueAt)) out.add(t.id);
    } else {
      const a = assignmentById.get(t.sourceId!);
      if (!a) continue;
      const mine = attempts.filter((x) => x.userId === t.assigneeId && x.testId === a.testId && x.cycleKey === a.cycleKey);
      if (awaitingGrade(mine, a.dueAt)) out.add(t.id);
    }
  }
  return out;
}

/** A person's top role in one approved club, when it's a student leader role (the role getClubAccess checks). */
export type LeaderSeat = SeatClock & { clubId: string; role: ClubRole };

/**
 * getClubAccess's pause, read from the person's open required tasks instead
 * of re-checking the evidence. It's for the header's task count, which
 * renders on every page. In a club, the person is paused when a requirement
 * on their top role there is still owed (its task is open), is past that
 * seat's deadline, and isn't waiting for a grader. The sweep and the event
 * path keep tasks in step with the evidence, so this matches getClubAccess.
 * Anything that acts on a permission asks getClubAccess itself.
 */
export async function pausedClubsFromTasks(userId: string, seats: readonly LeaderSeat[], at: Date = new Date()): Promise<Set<string>> {
  const paused = new Set<string>();
  if (!seats.length) return paused;
  // A task is due at the earliest of the person's deadlines, so every pause has a task past due.
  const late = await db.task.findMany({ where: { assigneeId: userId, sourceType: "requirement", status: "OPEN", dueAt: { lt: at } }, select: { sourceId: true } });
  if (!late.length) return paused;
  const owed = new Set(late.map((t) => t.sourceId?.split(":")[0]));
  const reqs = (await activeRequirements()).filter((r) => owed.has(r.id) && seats.some((s) => r.appliesTo.includes(s.role)));
  if (!reqs.length) return paused;
  const terms = reqs.some((r) => readsTerms(r.renewal)) ? await getTerms() : [];
  const testIds = [...new Set(reqs.flatMap((r) => (r.kind === "TEST" && r.testId ? [r.testId] : [])))];
  const waiting = testIds.length ? await db.testAttempt.findMany({ where: { userId, status: "NEEDS_REVIEW", testId: { in: testIds } }, select: { testId: true, status: true, submittedAt: true } }) : [];
  for (const s of seats) {
    for (const r of reqs) {
      if (!r.appliesTo.includes(s.role)) continue;
      const start = periodStartIn(r.renewal, at, terms);
      const dueAt = seatDueAt(r, start, s);
      const mine = waiting.filter((a) => a.testId === r.testId && a.submittedAt !== null && a.submittedAt >= start);
      if (requirementState({ met: false, awaitingGrade: awaitingGrade(mine, dueAt), dueAt, at }) === "overdue") {
        paused.add(s.clubId);
        break;
      }
    }
  }
  return paused;
}
