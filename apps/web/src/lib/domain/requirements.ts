import "server-only";
import type { AssignmentStatus, ClubRole, Prisma, RoleRequirement } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { can, getClubAccess, ROLE_RANK } from "@/lib/authz";
import { loadRequirementBatch, periodStartFor, REQUIREMENT_ORDER, requirementStatus, tasksAwaitingGrade, type RequirementBatch } from "@/lib/authz/requirements";
import { seatDueAt, type RequirementState } from "@/lib/authz/requirement-rules";
import { missingDetails } from "@/lib/details/rules";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify, type NotifyInput } from "@/lib/domain/notify";
import { fmtDate } from "@/lib/time";
import { renewalCycle } from "@/lib/tests/cycles";

/**
 * Requirements: the tests, forms and trainings WSUSA requires of club
 * members and student leaders (RoleRequirement.appliesTo lists the roles;
 * MEMBER means every student in an approved club).
 *
 * Whether someone has MET a requirement is computed in lib/authz/requirements
 * from passed test attempts (a submitted form counts as passed) and training
 * check-ins — never stored. This module keeps the inbox in step with that:
 * one required REQUIREMENT task per person per requirement (source
 * `${requirementId}:${userId}`), plus a TestAssignment for TEST requirements
 * so the Test Tool can track the cycle. The Test Tool (on a pass or a
 * submitted form) and the Attendance Tool (on a training check-in) close the
 * task with resolveTasks("requirement", requirementSourceId(...)).
 *
 * One batch evaluator keeps the inbox in step. loadSyncInputs reads
 * everything once, planSync decides with the rule in lib/authz, and
 * applySync writes only what changed. syncUserRequirements runs it for one
 * person (joins, role changes, passes, check-ins, details saves).
 * syncAllRequirementHolders runs it for everyone: once a day
 * (lib/jobs/requirements) and right after an admin saves a requirement.
 *
 * Requirements bind students in APPROVED clubs only. Only leader roles
 * (Ambassador and up, never advisors) are gated: overdue, their capabilities
 * pause — the rule getClubAccess uses. Members have nothing to pause, so an
 * overdue member requirement just stays on their list, marked overdue.
 */
export function requirementSourceId(requirementId: string, userId: string) {
  return `${requirementId}:${userId}`;
}

/** The leader roles a requirement can gate. */
export const REQUIREMENT_ROLES: ClubRole[] = ["AMBASSADOR", "OFFICER", "VP", "PRESIDENT"];
/** Everyone a requirement can apply to: members plus the leader roles. */
export const REQUIREMENT_AUDIENCE: ClubRole[] = ["MEMBER", ...REQUIREMENT_ROLES];

type NotifyMode = "new-role" | "due" | false;

/** One place a requirement can reach someone: a leader role, or (as MEMBER) a membership. */
type Seat = { role: ClubRole; startedAt: Date; clubId: string; clubApprovedAt: Date | null };

/** A requirement someone still owes. */
type Want = {
  requirement: RoleRequirement;
  /** The earliest deadline across the seats it reaches them through. */
  dueAt: Date;
  /** The club of the seat with that deadline (the first, in seat order, when several tie). */
  clubId: string;
  /** Applies through one of their leader roles, so being overdue pauses permissions. */
  gates: boolean;
};

function requirementHref(r: Pick<RoleRequirement, "kind" | "testId" | "trainingEventId">) {
  if (r.kind === "PROFILE") return "/settings/details";
  if (r.kind === "TEST" && r.testId) return `/tests/${r.testId}`;
  if (r.trainingEventId) return `/events/${r.trainingEventId}`;
  return "/tasks";
}

/** What to do, as the task title says it. Member details still missing a field are filled in; complete ones are confirmed. */
function requirementTitle(r: Pick<RoleRequirement, "kind" | "name">, isForm: boolean, detailsMissing = false) {
  if (r.kind === "TRAINING") return `Attend: ${r.name}`;
  if (r.kind === "PROFILE") return `${detailsMissing ? "Fill in" : "Confirm"}: ${r.name}`;
  return isForm ? `Fill out: ${r.name}` : `Pass: ${r.name}`;
}

/** Task titles start with what to do; notifications drop it. */
const ACTION_PREFIX = /^(Pass|Attend|Fill out|Fill in|Confirm): /;

/**
 * What one person owes, from the batch evaluator. Whether a requirement is
 * met is decided once per person and requirement. It's owed when it reaches
 * them through any seat and isn't met, and it's due at the earliest of those
 * seats' deadlines. Seats come in order: leader roles, oldest first, then
 * memberships.
 */
function decideRequirements(batch: RequirementBatch, userId: string, seats: readonly Seat[]): { met: Set<string>; wants: Map<string, Want> } {
  const wants = new Map<string, Want>();
  const met = new Set<string>();
  for (const s of seats) {
    const gates = s.role !== "MEMBER";
    for (const r of batch.requirements) {
      if (!r.appliesTo.includes(s.role)) continue;
      if (batch.fulfillment(userId, r).met) {
        met.add(r.id);
        continue;
      }
      const dueAt = seatDueAt(r, batch.periodStart(r), s);
      const prev = wants.get(r.id);
      if (!prev || dueAt < prev.dueAt) wants.set(r.id, { requirement: r, dueAt, clubId: s.clubId, gates: gates || Boolean(prev?.gates) });
      else if (gates) prev.gates = true;
    }
  }
  return { met, wants };
}

type OpenTask = { id: string; assigneeId: string | null; sourceId: string | null; dueAt: Date | null; title: string; href: string | null; clubId: string | null; required: boolean };
type AssignmentRow = { id: string; testId: string; userId: string; cycleKey: string; status: AssignmentStatus; dueAt: Date; resolvedAt: Date | null };

/** What a sync reads, for some people or for everyone (the sweep), loaded once. */
type SyncInputs = {
  now: Date;
  batch: RequirementBatch;
  /** Everyone to bring in line, with their seats in order. */
  people: Map<string, Seat[]>;
  /** Their open requirement tasks, oldest first. */
  openTasks: Map<string, OpenTask[]>;
  /** Kind and test of every requirement an open task points at (turned-off ones too). */
  requirementOf: Map<string, { kind: RoleRequirement["kind"]; testId: string | null }>;
  /** Requirement tests that are forms ("Fill out:" instead of "Pass:"). */
  forms: Set<string>;
  /** This renewal cycle's assignments for requirement tests, by person. */
  assignments: Map<string, AssignmentRow[]>;
};

async function loadSyncInputs(scope: { userIds: readonly string[] } | "everyone", now: Date): Promise<SyncInputs> {
  const requirements = await db.roleRequirement.findMany({ where: { active: true }, orderBy: REQUIREMENT_ORDER });
  const forMembers = requirements.some((r) => r.appliesTo.includes("MEMBER"));
  const only = scope === "everyone" ? {} : { userId: { in: [...scope.userIds] } };
  const [roles, memberships, open] = await Promise.all([
    db.roleAssignment.findMany({
      where: { endedAt: null, role: { in: REQUIREMENT_ROLES }, club: { status: "APPROVED" }, user: { status: "ACTIVE" }, ...only },
      select: { userId: true, role: true, startedAt: true, clubId: true, club: { select: { approvedAt: true } } },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    }),
    // Memberships only matter while a requirement applies to members; students only.
    forMembers
      ? db.membership.findMany({
          where: { status: "ACTIVE", club: { status: "APPROVED" }, user: { status: "ACTIVE", kind: "STUDENT" }, ...only },
          select: { userId: true, clubId: true, joinedAt: true, requestedAt: true, club: { select: { approvedAt: true } } },
        })
      : [],
    db.task.findMany({
      where: { sourceType: "requirement", status: "OPEN", assigneeId: scope === "everyone" ? { not: null } : { in: [...scope.userIds] } },
      select: { id: true, assigneeId: true, sourceId: true, dueAt: true, title: true, href: true, clubId: true, required: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  // Everyone who may need attention: the people asked about, or (the sweep) current leaders,
  // members while a requirement applies to members, and anyone with an open requirement task.
  const people = new Map<string, Seat[]>();
  const seatsOf = (userId: string) => {
    let list = people.get(userId);
    if (!list) people.set(userId, (list = []));
    return list;
  };
  if (scope !== "everyone") for (const id of scope.userIds) seatsOf(id);
  for (const a of roles) seatsOf(a.userId).push({ role: a.role, startedAt: a.startedAt, clubId: a.clubId, clubApprovedAt: a.club.approvedAt });
  const memberSeats = memberships
    .map((m) => ({ userId: m.userId, seat: { role: "MEMBER" as const, startedAt: m.joinedAt ?? m.requestedAt, clubId: m.clubId, clubApprovedAt: m.club.approvedAt } }))
    .sort((a, b) => a.seat.startedAt.getTime() - b.seat.startedAt.getTime() || a.seat.clubId.localeCompare(b.seat.clubId));
  for (const m of memberSeats) seatsOf(m.userId).push(m.seat);
  const openTasks = new Map<string, OpenTask[]>();
  for (const t of open) {
    seatsOf(t.assigneeId!);
    openTasks.set(t.assigneeId!, [...(openTasks.get(t.assigneeId!) ?? []), t]);
  }

  const active = new Map(requirements.map((r) => [r.id, r]));
  const elsewhere = [...new Set(open.map((t) => t.sourceId?.split(":")[0] ?? ""))].filter((id) => id && !active.has(id));
  const testIds = [...new Set(requirements.flatMap((r) => (r.kind === "TEST" && r.testId ? [r.testId] : [])))];
  const [batch, inactive, forms] = await Promise.all([
    loadRequirementBatch([...people.keys()], { at: now, requirements }),
    elsewhere.length ? db.roleRequirement.findMany({ where: { id: { in: elsewhere } }, select: { id: true, kind: true, testId: true } }) : [],
    testIds.length ? db.test.findMany({ where: { id: { in: testIds }, isForm: true }, select: { id: true } }) : [],
  ]);
  // Requirement tests and forms also get an assignment per renewal cycle (below); this cycle's rows.
  const cycles = requirements.flatMap((r) => (r.kind === "TEST" && r.testId ? [{ testId: r.testId, cycleKey: renewalCycle(r.renewal, now, batch.terms).key }] : []));
  const rows = cycles.length
    ? await db.testAssignment.findMany({
        where: { OR: cycles, ...(scope === "everyone" ? {} : only) },
        select: { id: true, testId: true, userId: true, cycleKey: true, status: true, dueAt: true, resolvedAt: true },
      })
    : [];
  const assignments = new Map<string, AssignmentRow[]>();
  for (const a of rows) assignments.set(a.userId, [...(assignments.get(a.userId) ?? []), a]);
  return {
    now,
    batch,
    people,
    openTasks,
    requirementOf: new Map([...requirements, ...inactive].map((r) => [r.id, { kind: r.kind, testId: r.testId }])),
    forms: new Set(forms.map((t) => t.id)),
    assignments,
  };
}

/** The writes that bring everyone's inbox in line, and the notices to send after them. */
type SyncPlan = {
  done: string[];
  cancelled: string[];
  /** testId → people whose open assignment is excused. */
  excuse: Map<string, string[]>;
  updates: { id: string; data: { dueAt: Date; title: string; href: string; clubId: string | null; required: true } }[];
  creates: Prisma.TaskCreateManyInput[];
  assignmentCreates: Prisma.TestAssignmentCreateManyInput[];
  assignmentUpdates: { id: string; data: Prisma.TestAssignmentUpdateManyMutationInput }[];
  notices: NotifyInput[];
  /** Per person: names of requirements that got a new task, and how many they owe. */
  results: Map<string, { opened: string[]; open: number }>;
};

/**
 * One person's part of the plan, exactly the old per-person rule:
 *   unmet + applies  → an open task due at the earliest deadline across their seats
 *   met              → open task closed (DONE)
 *   no longer applies (role ended, requirement turned off) → open task cancelled,
 *                      and its test assignment excused unless another requirement still asks for that test
 * A second open copy of a task still owed is cancelled (only a race could make one).
 */
function planPerson(inputs: SyncInputs, userId: string, seats: Seat[], plan: SyncPlan, notifyMode: NotifyMode | undefined) {
  const { batch, now } = inputs;
  const { met, wants } = decideRequirements(batch, userId, seats);
  const wantedTests = new Set([...wants.values()].map((w) => w.requirement.testId).filter(Boolean));

  const existing = new Map<string, OpenTask>();
  for (const t of inputs.openTasks.get(userId) ?? []) {
    const reqId = t.sourceId?.split(":")[0] ?? "";
    if (wants.has(reqId)) {
      if (existing.has(reqId)) plan.cancelled.push(t.id);
      else existing.set(reqId, t);
      continue;
    }
    if (met.has(reqId)) {
      plan.done.push(t.id);
      continue;
    }
    plan.cancelled.push(t.id);
    const req = inputs.requirementOf.get(reqId);
    if (req?.kind === "TEST" && req.testId && !wantedTests.has(req.testId)) {
      const list = plan.excuse.get(req.testId) ?? [];
      if (!list.includes(userId)) list.push(userId);
      plan.excuse.set(req.testId, list);
    }
  }

  // Member details still missing a field read "Fill in", complete ones "Confirm".
  const person = [...wants.values()].some((w) => w.requirement.kind === "PROFILE") ? batch.person(userId) : null;
  const detailsMissing = Boolean(person && missingDetails(person.details, person.kind).length);
  // This cycle's assignments, kept as the step-by-step upkeep below leaves them: `id` null for a new one, `data` what changed.
  type CycleRow = { id: string | null; testId: string; cycleKey: string; status: AssignmentStatus; dueAt: Date; data: Prisma.TestAssignmentUpdateManyMutationInput | null };
  const cycle = new Map<string, CycleRow>((inputs.assignments.get(userId) ?? []).map((a) => [`${a.testId}|${a.cycleKey}`, { id: a.id, testId: a.testId, cycleKey: a.cycleKey, status: a.status, dueAt: a.dueAt, data: null }]));
  const opened: Want[] = [];
  for (const [reqId, w] of wants) {
    const href = requirementHref(w.requirement);
    const title = requirementTitle(w.requirement, Boolean(w.requirement.testId && inputs.forms.has(w.requirement.testId)), detailsMissing);
    // A leader's task names the club whose permissions it gates; a member-wide one is WSUSA's, not any club's.
    const clubId = w.gates ? w.clubId : null;
    const t = existing.get(reqId);
    if (t) {
      if (t.dueAt?.getTime() !== w.dueAt.getTime() || t.title !== title || t.href !== href || t.clubId !== clubId || !t.required) {
        plan.updates.push({ id: t.id, data: { dueAt: w.dueAt, title, href, clubId, required: true } });
      }
    } else {
      plan.creates.push({
        kind: "REQUIREMENT",
        title,
        description: w.requirement.description,
        assigneeType: "USER",
        assigneeId: userId,
        clubId,
        dueAt: w.dueAt,
        href,
        sourceType: "requirement",
        sourceId: requirementSourceId(reqId, userId),
        required: true,
      });
      opened.push(w);
    }
    // Requirement tests and forms also get an assignment for this renewal cycle, so the Test Tool tracks due dates and misses.
    if (w.requirement.kind === "TEST" && w.requirement.testId) {
      const testId = w.requirement.testId;
      const cycleKey = renewalCycle(w.requirement.renewal, now, batch.terms).key;
      const key = `${testId}|${cycleKey}`;
      const a = cycle.get(key);
      if (!a) cycle.set(key, { id: null, testId, cycleKey, status: "ASSIGNED", dueAt: w.dueAt, data: null });
      else if (a.status === "ASSIGNED" && a.dueAt.getTime() !== w.dueAt.getTime()) {
        a.dueAt = w.dueAt;
        a.data = { ...a.data, dueAt: w.dueAt };
      } else if (a.status === "EXCUSED") {
        // Owed again: back on, due with the task.
        Object.assign(a, { status: "ASSIGNED", dueAt: w.dueAt });
        a.data = { ...a.data, status: "ASSIGNED", dueAt: w.dueAt, resolvedAt: null };
      }
    }
  }
  for (const a of cycle.values()) {
    if (a.id === null) plan.assignmentCreates.push({ testId: a.testId, userId, cycleKey: a.cycleKey, dueAt: a.dueAt });
    else if (a.data) plan.assignmentUpdates.push({ id: a.id, data: a.data });
  }

  if (opened.length && notifyMode) {
    const names = opened.map((w) => w.requirement.name).join(", ");
    const soonest = opened.reduce((d, w) => (w.dueAt < d ? w.dueAt : d), opened[0].dueAt);
    const gates = opened.some((w) => w.gates);
    plan.notices.push({
      userIds: [userId],
      kind: "requirement.assigned",
      title: !gates ? "Required by WSUSA" : notifyMode === "new-role" ? "Your new role has WSUSA requirements" : opened.length === 1 ? "A WSUSA requirement to finish" : "WSUSA requirements to finish",
      body: !gates
        ? `WSUSA asks every club member to finish ${names}${soonest > now ? ` by ${fmtDate(soonest, "MMM d")}` : ""}.`
        : soonest <= now
          ? `Finish ${names} to turn your permissions back on.`
          : `Finish ${names} by ${fmtDate(soonest, "MMM d")} to keep your permissions on.`,
      href: "/tasks",
    });
  }
  plan.results.set(userId, { opened: opened.map((w) => w.requirement.name), open: wants.size });
}

function planSync(inputs: SyncInputs, notifyMode: NotifyMode | undefined): SyncPlan {
  const plan: SyncPlan = { done: [], cancelled: [], excuse: new Map(), updates: [], creates: [], assignmentCreates: [], assignmentUpdates: [], notices: [], results: new Map() };
  for (const [userId, seats] of inputs.people) planPerson(inputs, userId, seats, plan, notifyMode);
  return plan;
}

const chunks = <T,>(list: readonly T[], size = 1000): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Same change for many rows: grouped so each distinct change is one statement. */
function grouped<T extends { id: string; data: object }>(list: readonly T[]): [T["data"], string[]][] {
  const out = new Map<string, [T["data"], string[]]>();
  for (const u of list) {
    const key = JSON.stringify(u.data);
    const g = out.get(key) ?? ([u.data, []] as [T["data"], string[]]);
    g[1].push(u.id);
    out.set(key, g);
  }
  return [...out.values()];
}

/** Writes the plan in one transaction (only differences: in-sync people cost nothing), then sends its notices. */
async function applySync(plan: SyncPlan, now: Date) {
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  // Closing and updating skip tasks something else closed meanwhile (a pass, a check-in).
  for (const ids of chunks(plan.done)) writes.push(db.task.updateMany({ where: { id: { in: ids }, status: "OPEN" }, data: { status: "DONE", completedAt: now } }));
  for (const ids of chunks(plan.cancelled)) writes.push(db.task.updateMany({ where: { id: { in: ids }, status: "OPEN" }, data: { status: "CANCELLED", completedAt: now } }));
  for (const [testId, userIds] of plan.excuse)
    for (const ids of chunks(userIds))
      writes.push(db.testAssignment.updateMany({ where: { testId, userId: { in: ids }, status: "ASSIGNED", test: { audience: "ROLE_REQUIREMENT" } }, data: { status: "EXCUSED", resolvedAt: now } }));
  for (const [data, all] of grouped(plan.updates)) for (const ids of chunks(all)) writes.push(db.task.updateMany({ where: { id: { in: ids }, status: "OPEN" }, data }));
  for (const rows of chunks(plan.creates)) writes.push(db.task.createMany({ data: rows }));
  for (const rows of chunks(plan.assignmentCreates)) writes.push(db.testAssignment.createMany({ data: rows, skipDuplicates: true }));
  for (const [data, all] of grouped(plan.assignmentUpdates)) for (const ids of chunks(all)) writes.push(db.testAssignment.updateMany({ where: { id: { in: ids } }, data }));
  if (writes.length) await db.$transaction(writes);
  for (const n of plan.notices) await notify(n);
}

/**
 * Brings one person's requirement tasks (and requirement-test assignments) in
 * line with their current roles and memberships: the event-driven path (joins,
 * role changes, passes, check-ins, details saves), on the same evaluator as
 * the sweep. Idempotent and self-healing. Returns the names of requirements
 * that got a NEW task, and how many they owe.
 */
export async function syncUserRequirements(userId: string, opts: { notify?: NotifyMode; now?: Date } = {}): Promise<{ opened: string[]; open: number }> {
  const now = opts.now ?? new Date();
  const plan = planSync(await loadSyncInputs({ userIds: [userId] }, now), opts.notify);
  await applySync(plan, now);
  return plan.results.get(userId) ?? { opened: [], open: 0 };
}

/**
 * Opens REQUIREMENT tasks when someone takes a role that requires tests or
 * trainings (called by roles.grantRole). Kept for its callers; it now syncs
 * every current role of the person, so the earliest deadline wins.
 */
export async function openRequirementTasks(userId: string, role: ClubRole, ctx: { clubId: string; assignmentStartedAt: Date; clubApprovedAt: Date | null }) {
  void role;
  void ctx;
  return syncUserRequirements(userId, { notify: "new-role" });
}

/**
 * Re-opens requirement tasks after something un-met a requirement (e.g. the
 * Attendance Tool removed a training check-in). Quiet: no "new role" notice.
 */
export async function reopenRequirementTasks(userId: string) {
  return syncUserRequirements(userId, { notify: false });
}

export type SweepResult = { people: number; opened: number; closed: number; updated: number };

/** The ReminderLog row that says the full sweep ran on this campus day (lib/jobs/requirements). */
export function fullSweepKey(at: Date) {
  return `job:requirements:full:${fmtDate(at, "yyyy-MM-dd")}`;
}

// One full sweep at a time per server: a second one waits for the first, then sees its writes.
let sweeping: Promise<unknown> = Promise.resolve();

/**
 * The full sweep: everyone's requirement inbox brought in line in one batch.
 * Who's checked: current student leaders, every student in an approved club
 * while a requirement applies to members, and anyone with an open requirement
 * task. Runs once a day (lib/jobs/requirements) and right after an admin
 * creates or edits a requirement; either one marks the day swept.
 */
export function syncAllRequirementHolders(opts: { notify?: NotifyMode; now?: Date } = {}): Promise<SweepResult> {
  const run = sweeping.then(async () => {
    const now = opts.now ?? new Date();
    const inputs = await loadSyncInputs("everyone", now);
    const plan = planSync(inputs, opts.notify);
    await applySync(plan, now);
    await db.reminderLog.createMany({ data: [{ key: fullSweepKey(now), sentAt: now }], skipDuplicates: true });
    return { people: inputs.people.size, opened: plan.creates.length, closed: plan.done.length + plan.cancelled.length, updated: plan.updates.length };
  });
  sweeping = run.catch(() => undefined);
  return run;
}

/**
 * Which (requirement, person) pairs reach the person through a current leader
 * role in an approved club, so being overdue pauses their permissions. Keys
 * are `${requirementId}:${userId}`.
 */
async function gatingPairs(pairs: readonly { requirementId: string; userId: string }[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!pairs.length) return out;
  const [reqs, roles] = await Promise.all([
    db.roleRequirement.findMany({ where: { id: { in: [...new Set(pairs.map((p) => p.requirementId))] } }, select: { id: true, appliesTo: true } }),
    db.roleAssignment.findMany({ where: { userId: { in: [...new Set(pairs.map((p) => p.userId))] }, endedAt: null, club: { status: "APPROVED" } }, select: { userId: true, role: true } }),
  ]);
  const leaderRoles = new Map(reqs.map((r) => [r.id, r.appliesTo.filter((role) => role !== "MEMBER")]));
  const held = new Map<string, Set<ClubRole>>();
  for (const a of roles) held.set(a.userId, (held.get(a.userId) ?? new Set()).add(a.role));
  for (const p of pairs) if ((leaderRoles.get(p.requirementId) ?? []).some((role) => held.get(p.userId)?.has(role))) out.add(`${p.requirementId}:${p.userId}`);
  return out;
}

/**
 * Tells people once when a requirement deadline passes: leaders that their
 * permissions paused, members that it's overdue. Idempotent: skips anyone
 * already told about that task. A test handed in on time that's still
 * waiting for a grader isn't overdue, so nobody hears about it. The
 * time-sensitive part of the scheduled job, so it reads in bulk.
 */
export async function notifyOverdueRequirements(now: Date = new Date()): Promise<{ notified: number }> {
  const overdue = await db.task.findMany({
    where: { sourceType: "requirement", status: "OPEN", dueAt: { lt: now }, assigneeId: { not: null } },
    select: { id: true, status: true, sourceType: true, assigneeId: true, title: true, href: true, createdAt: true, dueAt: true, sourceId: true, club: { select: { name: true } } },
  });
  if (!overdue.length) return { notified: 0 };
  const waiting = await tasksAwaitingGrade(overdue, now);
  const late = overdue.filter((t) => !waiting.has(t.id));
  if (!late.length) return { notified: 0 };
  const since = new Date(Math.min(...late.map((t) => (t.dueAt ?? t.createdAt).getTime())));
  const [told, gating] = await Promise.all([
    db.notification.findMany({ where: { kind: "requirement.overdue", userId: { in: [...new Set(late.map((t) => t.assigneeId!))] }, createdAt: { gte: since } }, select: { userId: true, href: true, createdAt: true } }),
    gatingPairs(late.map((t) => ({ requirementId: t.sourceId?.split(":")[0] ?? "", userId: t.assigneeId! }))),
  ]);
  const toldBy = new Map<string, { href: string | null; createdAt: Date }[]>();
  for (const n of told) toldBy.set(n.userId, [...(toldBy.get(n.userId) ?? []), n]);
  let notified = 0;
  for (const t of late) {
    const from = t.dueAt ?? t.createdAt;
    const mine = toldBy.get(t.assigneeId!) ?? [];
    if (mine.some((n) => n.href === t.href && n.createdAt >= from)) continue;
    const name = t.title.replace(ACTION_PREFIX, "");
    const gates = gating.has(`${t.sourceId?.split(":")[0] ?? ""}:${t.assigneeId}`);
    await notify({
      userIds: [t.assigneeId!],
      kind: "requirement.overdue",
      title: gates ? `Permissions paused${t.club ? ` in ${t.club.name}` : ""}` : "A WSUSA requirement is overdue",
      body: gates ? `${name} is overdue. Your title stays, and your permissions come back as soon as it's done.` : `${name} was due ${fmtDate(t.dueAt ?? now, "MMM d")}. WSUSA requires it, so please finish it as soon as you can.`,
      href: t.href ?? "/tasks",
    });
    // Later tasks in this run see it, as they would have in the database.
    mine.push({ href: t.href ?? "/tasks", createdAt: new Date() });
    toldBy.set(t.assigneeId!, mine);
    notified++;
  }
  return { notified };
}

// ─── Admin: Requirements (/admin/requirements) ───────────────────────────────

function assertRequirementAdmin(actor: Actor | null): asserts actor is Actor {
  assertSignedIn(actor);
  if (!can(actor, "admin.tests") && !can(actor, "admin.trainings")) throw forbidden();
}

const RequirementInput = z
  .object({
    name: z.string().trim().min(3, "Give the requirement a name (at least 3 characters).").max(120, "Names can be up to 120 characters."),
    description: z
      .string()
      .trim()
      .max(1000, "Keep the description under 1,000 characters.")
      .nullish()
      .transform((v) => v || null),
    kind: z.enum(["TEST", "TRAINING", "PROFILE"]),
    testId: z.string().nullish(),
    trainingEventId: z.string().nullish(),
    appliesTo: z.array(z.enum(["MEMBER", "AMBASSADOR", "OFFICER", "VP", "PRESIDENT"])).min(1, "Choose who this applies to: members, one or more leader roles, or both."),
    renewal: z.enum(["NONE", "SEMESTER", "ACADEMIC_YEAR", "ANNUAL"]),
    graceDays: z.coerce.number({ error: "Enter the number of days." }).int("Use whole days.").min(0, "Grace days can't be negative.").max(365, "Grace periods can be up to 365 days."),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "TEST" && !v.testId) ctx.addIssue({ code: "custom", path: ["testId"], message: "Choose the test or form people must complete." });
    if (v.kind === "TRAINING" && !v.trainingEventId) ctx.addIssue({ code: "custom", path: ["trainingEventId"], message: "Choose the training people must attend." });
  });

export type RequirementInput = z.input<typeof RequirementInput>;

/** Create (id null) or edit a requirement. Holders' tasks catch up via syncAllRequirementHolders (the action runs it after responding). */
export async function saveRequirement(actor: Actor | null, id: string | null, input: unknown): Promise<{ id: string }> {
  assertRequirementAdmin(actor);
  const v = parse(RequirementInput, input);
  if (v.kind === "PROFILE") {
    // Met from Settings → Member details; nothing to point at.
  } else if (v.kind === "TEST") {
    const test = await db.test.findUnique({ where: { id: v.testId! }, select: { clubId: true, status: true, audience: true } });
    if (!test || test.clubId !== null) throw invalid("Choose a university test or form (club tests and forms can't be WSUSA requirements).");
    if (test.status !== "PUBLISHED") throw invalid("That test or form isn't published yet. Publish it in Admin → Tests first.");
    if (test.audience !== "ROLE_REQUIREMENT") throw invalid("Set its audience to “WSUSA requirement (set in Admin → Requirements)” first, so it isn't also assigned to everyone else.");
  } else {
    const ev = await db.event.findUnique({ where: { id: v.trainingEventId! }, select: { clubId: true, status: true } });
    if (!ev || ev.clubId !== null) throw invalid("Choose a university training from Admin → Trainings & events.");
    if (ev.status !== "SCHEDULED") throw invalid("That training is cancelled or still an idea. Choose a scheduled training.");
  }
  const data = {
    name: v.name,
    description: v.description,
    kind: v.kind,
    testId: v.kind === "TEST" ? v.testId! : null,
    trainingEventId: v.kind === "TRAINING" ? v.trainingEventId! : null,
    appliesTo: [...new Set(v.appliesTo)],
    renewal: v.renewal,
    graceDays: v.graceDays,
    active: v.active,
  };
  const dupe = await db.roleRequirement.findFirst({ where: { name: { equals: v.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
  if (dupe) throw invalid("Another requirement already has that name.");

  let row: RoleRequirement;
  if (id) {
    const prev = await db.roleRequirement.findUnique({ where: { id } });
    if (!prev) throw notFound("Requirement");
    row = await db.roleRequirement.update({ where: { id }, data });
    await logActivity({ actorId: actor.id, action: "requirement.updated", entityType: "roleRequirement", entityId: id, data: { name: row.name, active: row.active, graceDays: row.graceDays, renewal: row.renewal } });
  } else {
    row = await db.roleRequirement.create({ data });
    await logActivity({ actorId: actor.id, action: "requirement.created", entityType: "roleRequirement", entityId: row.id, data: { name: row.name, kind: row.kind } });
  }
  return { id: row.id };
}

/**
 * Turn a requirement on or off without editing it. Turning on checks what it
 * points at the same way saving does: a requirement nobody can meet would
 * pause every leader it applies to once their grace period ends.
 */
export async function setRequirementActive(actor: Actor | null, id: string, active: boolean): Promise<{ id: string }> {
  assertRequirementAdmin(actor);
  const prev = await db.roleRequirement.findUnique({ where: { id } });
  if (!prev) throw notFound("Requirement");
  if (active && prev.kind === "TEST") {
    const t = prev.testId ? await db.test.findUnique({ where: { id: prev.testId }, select: { status: true, audience: true } }) : null;
    if (!t) throw invalid("Its test or form was deleted, so it can't be turned on. Edit it to choose one first.");
    if (t.status !== "PUBLISHED") throw invalid("Its test or form isn't published, so it can't be turned on. Publish it first.");
    // While the requirement was off, the test's audience was free to change.
    if (t.audience !== "ROLE_REQUIREMENT") throw invalid("Set its audience back to “WSUSA requirement (set in Admin → Requirements)” first, so it isn't also assigned to everyone else.");
  }
  if (active && prev.kind === "TRAINING") {
    // Deleting an event sets trainingEventId to null.
    const ev = prev.trainingEventId ? await db.event.findUnique({ where: { id: prev.trainingEventId }, select: { status: true } }) : null;
    if (!ev) throw invalid("Its training was deleted, so it can't be turned on. Edit it to choose a training first.");
    if (ev.status !== "SCHEDULED") throw invalid("Its training is cancelled or still an idea, so it can't be turned on. Choose a scheduled training first.");
  }
  await db.roleRequirement.update({ where: { id }, data: { active } });
  await logActivity({ actorId: actor.id, action: active ? "requirement.activated" : "requirement.deactivated", entityType: "roleRequirement", entityId: id, data: { name: prev.name } });
  return { id };
}

// ─── Admin reads: requirements and compliance ────────────────────────────────

/** Every requirement with what it points at, for the admin list. */
export async function listRequirementsForAdmin() {
  return db.roleRequirement.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    include: {
      test: { select: { id: true, title: true, status: true, audience: true, isForm: true } },
      trainingEvent: { select: { id: true, title: true, status: true, _count: { select: { occurrences: true } } } },
    },
  });
}

/**
 * Open requirement tasks per requirement, across everyone it applies to
 * (members included): how many people still owe it, how many are late, and
 * how many handed it in on time and are waiting for grading (not late).
 */
export async function openRequirementCounts(now: Date = new Date()): Promise<Map<string, { open: number; overdue: number; waiting: number }>> {
  const rows = await db.task.findMany({ where: { sourceType: "requirement", status: "OPEN" }, select: { id: true, status: true, sourceType: true, sourceId: true, assigneeId: true, dueAt: true } });
  const waiting = await tasksAwaitingGrade(rows, now);
  const out = new Map<string, { open: number; overdue: number; waiting: number }>();
  for (const r of rows) {
    const id = r.sourceId?.split(":")[0];
    if (!id) continue;
    const c = out.get(id) ?? { open: 0, overdue: 0, waiting: 0 };
    c.open++;
    if (waiting.has(r.id)) c.waiting++;
    else if (r.dueAt && r.dueAt < now) c.overdue++;
    out.set(id, c);
  }
  return out;
}

/** What a requirement can point at: published university tests and forms, and scheduled university events (trainings first). */
export async function requirementTargets() {
  const [tests, events] = await Promise.all([
    db.test.findMany({ where: { clubId: null, status: { not: "ARCHIVED" } }, orderBy: { title: "asc" }, select: { id: true, title: true, status: true, audience: true, isForm: true } }),
    db.event.findMany({ where: { clubId: null, status: "SCHEDULED" }, orderBy: { title: "asc" }, select: { id: true, title: true, kind: true } }),
  ]);
  return { tests, events: [...events.filter((e) => e.kind === "TRAINING"), ...events.filter((e) => e.kind !== "TRAINING")] };
}

/** "review": handed in on time and waiting for grading (not met yet, not overdue). */
export type ComplianceState = RequirementState;
export type ComplianceCell = { state: ComplianceState; dueAt: Date };
export type ComplianceRow = {
  key: string;
  person: { id: string; name: string; email: string; handle: string; avatarUrl: string | null; avatarColor: string };
  club: { id: string; name: string; slug: string };
  role: ClubRole;
  seat: string | null;
  startedAt: Date;
  /** By requirement id; requirements that don't apply to the role are absent. */
  cells: Record<string, ComplianceCell>;
  /** Overdue → this person's capabilities in this club are paused (same rule as getClubAccess). */
  paused: boolean;
};

const ROLE_ORDER: Record<ClubRole, number> = { MEMBER: 0, AMBASSADOR: 1, OFFICER: 1, VP: 2, PRESIDENT: 3, ADVISOR: 4 };

/**
 * Every current student leader of an approved club (or of `opts.clubIds`),
 * one row per person per club (their highest role there — exactly what
 * getClubAccess checks), with each requirement's status. The batch evaluator
 * answers for all of them at once: requirementStatus's rule, one load.
 * Read-only.
 */
export async function requirementCompliance(now: Date = new Date(), opts: { clubIds?: string[] } = {}): Promise<ComplianceRow[]> {
  const assignments = await db.roleAssignment.findMany({
    where: { endedAt: null, role: { in: REQUIREMENT_ROLES }, club: { status: "APPROVED" }, user: { status: "ACTIVE" }, ...(opts.clubIds ? { clubId: { in: opts.clubIds } } : {}) },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      role: true,
      startedAt: true,
      position: { select: { name: true } },
      club: { select: { id: true, name: true, slug: true, approvedAt: true } },
      user: { select: { id: true, name: true, email: true, handle: true, avatarUrl: true, avatarColor: true } },
    },
  });
  // Highest role per person per club, like getClubAccess.
  const top = new Map<string, (typeof assignments)[number]>();
  for (const a of assignments) {
    const k = `${a.user.id}:${a.club.id}`;
    const prev = top.get(k);
    if (!prev || ROLE_ORDER[a.role] > ROLE_ORDER[prev.role]) top.set(k, a);
  }
  const list = [...top.entries()];
  const batch = await loadRequirementBatch([...new Set(list.map(([, a]) => a.user.id))], { at: now });
  const rows = list.map(([key, a]): ComplianceRow => {
    const status = batch.status(a.user.id, a.role, { startedAt: a.startedAt, clubApprovedAt: a.club.approvedAt });
    const cells: Record<string, ComplianceCell> = {};
    for (const it of status.items) cells[it.requirement.id] = { state: it.state, dueAt: it.dueAt };
    return { key, person: a.user, club: { id: a.club.id, name: a.club.name, slug: a.club.slug }, role: a.role, seat: a.position?.name ?? null, startedAt: a.startedAt, cells, paused: status.overdue };
  });
  return rows.sort((a, b) => Number(b.paused) - Number(a.paused) || a.person.name.localeCompare(b.person.name) || a.club.name.localeCompare(b.club.name));
}

// ─── Why someone's permissions are paused ────────────────────────────────────

export type PauseReason = {
  id: string;
  name: string;
  /** What to do, worded like the task ("Pass: Club Officer Policy Test"). */
  title: string;
  href: string;
  kind: "TEST" | "FORM" | "TRAINING" | "PROFILE";
  dueAt: Date;
  /** Handed in after the deadline and still waiting for a grader. */
  gradingPending: boolean;
};

/**
 * What's overdue for the actor in one club, through their highest role there
 * (the role getClubAccess checks): why their permissions are paused. Empty
 * when they aren't. Read-only.
 */
export async function pauseReasons(actor: Actor | null, clubId: string, now: Date = new Date()): Promise<PauseReason[]> {
  assertSignedIn(actor);
  const club = await db.club.findUnique({ where: { id: clubId }, select: { status: true, approvedAt: true } });
  if (club?.status !== "APPROVED") return [];
  const roles = await db.roleAssignment.findMany({ where: { clubId, userId: actor.id, endedAt: null } });
  const top = [...roles].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])[0];
  if (!top || ROLE_RANK[top.role] < 1 || top.role === "ADVISOR") return [];
  const status = await requirementStatus(actor.id, top.role, { assignmentStartedAt: top.startedAt, clubApprovedAt: club.approvedAt, at: now });
  const late = status.items.filter((i) => i.overdue);
  if (!late.length) return [];
  const testIds = late.map((i) => i.requirement.testId).filter((id): id is string => Boolean(id));
  const forms = new Set(testIds.length ? (await db.test.findMany({ where: { id: { in: testIds }, isForm: true }, select: { id: true } })).map((t) => t.id) : []);
  const detailsMissing = late.some((i) => i.requirement.kind === "PROFILE")
    ? missingDetails(await db.personalDetails.findUnique({ where: { userId: actor.id } }), actor.kind).length > 0
    : false;
  return late.map((i) => {
    const r = i.requirement;
    const isForm = Boolean(r.testId && forms.has(r.testId));
    return {
      id: r.id,
      name: r.name,
      title: requirementTitle(r, isForm, detailsMissing),
      href: requirementHref(r),
      kind: r.kind === "TRAINING" ? "TRAINING" : r.kind === "PROFILE" ? "PROFILE" : isForm ? "FORM" : "TEST",
      dueAt: i.dueAt,
      gradingPending: i.gradingPending,
    } satisfies PauseReason;
  });
}

// ─── Dashboards ──────────────────────────────────────────────────────────────

export type RequirementOverviewRow = {
  id: string;
  name: string;
  kind: "TEST" | "FORM" | "TRAINING" | "PROFILE";
  appliesTo: ClubRole[];
  /** Finished this renewal period. */
  done: number;
  /** Still owed (open required tasks). */
  open: number;
  overdue: number;
  /** Handed in on time and waiting for grading (part of `open`, never overdue). */
  waiting: number;
  /** The soonest deadline still ahead, among open tasks. */
  nextDue: Date | null;
};

/**
 * The admin dashboard's "WSUSA requirements": each active requirement's
 * progress this renewal period, counted from its required tasks (one per
 * person), and how many student leaders are paused right now.
 */
export async function requirementsOverview(actor: Actor | null, now: Date = new Date()): Promise<{ rows: RequirementOverviewRow[]; pausedLeaders: number }> {
  assertRequirementAdmin(actor);
  const reqs = await db.roleRequirement.findMany({ where: { active: true }, orderBy: { createdAt: "asc" }, include: { test: { select: { isForm: true } } } });
  if (!reqs.length) return { rows: [], pausedLeaders: 0 };
  const starts = new Map<string, Date>();
  for (const r of reqs) starts.set(r.id, await periodStartFor(r.renewal, now));
  const earliest = new Date(Math.min(...[...starts.values()].map((d) => d.getTime())));
  const tasks = await db.task.findMany({
    where: { sourceType: "requirement", OR: [{ status: "OPEN" }, { status: "DONE", completedAt: { gte: earliest } }] },
    select: { id: true, sourceType: true, sourceId: true, status: true, dueAt: true, completedAt: true, assigneeId: true },
  });
  const waiting = await tasksAwaitingGrade(tasks, now);
  const byReq = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const id = t.sourceId?.split(":")[0];
    if (id) byReq.set(id, [...(byReq.get(id) ?? []), t]);
  }

  const rows: RequirementOverviewRow[] = [];
  const overdueLeaderTasks: { reqId: string; userId: string }[] = [];
  for (const r of reqs) {
    const mine = byReq.get(r.id) ?? [];
    const start = starts.get(r.id)!;
    const open = mine.filter((t) => t.status === "OPEN");
    const late = open.filter((t) => t.dueAt && t.dueAt < now && !waiting.has(t.id));
    const ahead = open.filter((t) => !waiting.has(t.id)).map((t) => t.dueAt).filter((d): d is Date => Boolean(d && d >= now));
    rows.push({
      id: r.id,
      name: r.name,
      kind: r.kind === "TRAINING" ? "TRAINING" : r.kind === "PROFILE" ? "PROFILE" : r.test?.isForm ? "FORM" : "TEST",
      appliesTo: r.appliesTo,
      done: mine.filter((t) => t.status === "DONE" && t.completedAt && t.completedAt >= start).length,
      open: open.length,
      overdue: late.length,
      waiting: open.filter((t) => waiting.has(t.id)).length,
      nextDue: ahead.length ? new Date(Math.min(...ahead.map((d) => d.getTime()))) : null,
    });
    if (r.appliesTo.some((role) => role !== "MEMBER")) for (const t of late) if (t.assigneeId) overdueLeaderTasks.push({ reqId: r.id, userId: t.assigneeId });
  }
  // Paused = overdue on a requirement that reaches them through a leader role (getClubAccess's rule).
  const gating = await gatingPairs(overdueLeaderTasks.map((t) => ({ requirementId: t.reqId, userId: t.userId })));
  const paused = new Set(overdueLeaderTasks.filter((t) => gating.has(`${t.reqId}:${t.userId}`)).map((t) => t.userId));
  return { rows, pausedLeaders: paused.size };
}

export type ClubLeaderCompliance = {
  club: { id: string; name: string; slug: string };
  leaders: number;
  /** Leaders whose permissions are paused (overdue). */
  paused: number;
  /** The soonest requirement leaders still owe inside its grace period, and how many owe it. */
  due: { name: string; dueAt: Date; people: number } | null;
};

/**
 * The advisor dashboard's "WSUSA requirements": where the student leaders
 * of each club stand, for clubs the actor advises (or any club, for admins).
 * Every club's leaders come from one batch (requirementCompliance). Someone
 * waiting for a grade owes nothing right now, so they aren't "due".
 */
export async function clubLeaderCompliance(actor: Actor | null, clubIds: string[], now: Date = new Date()): Promise<ClubLeaderCompliance[]> {
  assertSignedIn(actor);
  const access = await Promise.all(clubIds.map((id) => getClubAccess(actor, id)));
  const allowed = clubIds.filter((_, i) => access[i]?.isAdvisor || access[i]?.viaPlatform);
  if (!allowed.length) return [];
  const [rows, names, clubs] = await Promise.all([
    requirementCompliance(now, { clubIds: allowed }),
    db.roleRequirement.findMany({ select: { id: true, name: true } }),
    db.club.findMany({ where: { id: { in: allowed } }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
  ]);
  const nameOf = new Map(names.map((r) => [r.id, r.name]));
  return clubs.map((club) => {
    const mine = rows.filter((r) => r.club.id === club.id);
    const due = new Map<string, { dueAt: Date; people: number }>();
    for (const r of mine) {
      if (r.paused) continue;
      for (const [reqId, cell] of Object.entries(r.cells)) {
        if (cell.state !== "due") continue;
        const cur = due.get(reqId);
        due.set(reqId, { dueAt: cur && cur.dueAt < cell.dueAt ? cur.dueAt : cell.dueAt, people: (cur?.people ?? 0) + 1 });
      }
    }
    const soonest = [...due.entries()].sort((a, b) => a[1].dueAt.getTime() - b[1].dueAt.getTime())[0];
    return {
      club,
      leaders: mine.length,
      paused: mine.filter((r) => r.paused).length,
      due: soonest ? { name: nameOf.get(soonest[0]) ?? "A requirement", dueAt: soonest[1].dueAt, people: soonest[1].people } : null,
    };
  });
}
