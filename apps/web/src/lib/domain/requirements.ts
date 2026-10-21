import "server-only";
import type { AssignmentStatus, ClubRole, Prisma, RoleRequirement } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { adminScope, ALL_CAPABILITIES, can, canAdminClub, CAPABILITIES, getClubAccess, ROLE_RANK, type Capability } from "@/lib/authz";
import { loadRequirementBatch, periodStartFor, REQUIREMENT_ORDER, requirementStatus, tasksAwaitingGrade, type RequirementBatch } from "@/lib/authz/requirements";
import { heldCapabilities, requirementReaches, seatDueAt, type Holdings, type RequirementState } from "@/lib/authz/requirement-rules";
import { missingDetails } from "@/lib/details/rules";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notifyEach, type NotifyInput } from "@/lib/domain/notify";
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
 *
 * Who a requirement reaches follows lib/authz/requirement-rules
 * requirementReaches: an office's requirement only that office's clubs, a
 * single-permission one only the leaders holding that permission (from their
 * roles and seat permissions), so gaining or losing the permission — a new
 * role, an ended one, a seat's permissions changed — opens or cancels the
 * task on the next sync of that person. Overdue, a single-permission
 * requirement pauses only its permission.
 */
export function requirementSourceId(requirementId: string, userId: string) {
  return `${requirementId}:${userId}`;
}

/** The leader roles a requirement can gate. */
export const REQUIREMENT_ROLES: ClubRole[] = ["AMBASSADOR", "OFFICER", "VP", "PRESIDENT"];
/** Everyone a requirement can apply to: members plus the leader roles. */
export const REQUIREMENT_AUDIENCE: ClubRole[] = ["MEMBER", ...REQUIREMENT_ROLES];

type NotifyMode = "new-role" | "due" | false;

/** One place a requirement can reach someone: a leader role, or (as MEMBER) a membership, with its club's office and what they hold there. */
type Seat = { role: ClubRole; startedAt: Date; clubId: string; clubApprovedAt: Date | null; clubOfficeId: string | null; holds: Holdings | null };

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
      if (!requirementReaches(r, s)) continue;
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

type OpenTask = { id: string; assigneeId: string | null; sourceId: string | null; dueAt: Date | null; title: string; href: string | null; clubId: string | null; required: boolean; officeId: string | null };
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
  /** Names of the offices that own requirements (notices name them instead of WSUSA). */
  officeNames: Map<string, string>;
};

/** Who's asking, as notices say it: WSUSA, or the office that owns every one of these requirements. Null when they're from different offices. */
function ownerName(reqs: readonly Pick<RoleRequirement, "officeId">[], officeNames: ReadonlyMap<string, string>): string | null {
  const ids = [...new Set(reqs.map((r) => r.officeId ?? null))];
  if (ids.length !== 1) return null;
  return ids[0] === null ? "WSUSA" : (officeNames.get(ids[0]) ?? "Your club's office");
}

/** "Events" or "Events and Budget & funding": the permissions single-permission requirements keep on. */
function capabilityNames(caps: readonly string[]): string {
  const labels = [...new Set(caps)].map((c) => (c in CAPABILITIES ? CAPABILITIES[c as Capability].label : c));
  return labels.length <= 2 ? labels.join(" and ") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Office names for these requirements' owners (only read when an office owns one). */
async function loadOfficeNames(reqs: readonly Pick<RoleRequirement, "officeId">[]): Promise<Map<string, string>> {
  const ids = [...new Set(reqs.map((r) => r.officeId).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  return new Map((await db.office.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
}

async function loadSyncInputs(scope: { userIds: readonly string[] } | "everyone", now: Date): Promise<SyncInputs> {
  const requirements = await db.roleRequirement.findMany({ where: { active: true }, orderBy: REQUIREMENT_ORDER });
  const forMembers = requirements.some((r) => r.appliesTo.includes("MEMBER"));
  const only = scope === "everyone" ? {} : { userId: { in: [...scope.userIds] } };
  const [roles, memberships, open] = await Promise.all([
    db.roleAssignment.findMany({
      where: { endedAt: null, role: { in: REQUIREMENT_ROLES }, club: { status: "APPROVED" }, user: { status: "ACTIVE" }, ...only },
      select: { userId: true, role: true, permissions: true, startedAt: true, clubId: true, club: { select: { approvedAt: true, officeId: true } } },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    }),
    // Memberships only matter while a requirement applies to members; students only.
    forMembers
      ? db.membership.findMany({
          where: { status: "ACTIVE", club: { status: "APPROVED" }, user: { status: "ACTIVE", kind: "STUDENT" }, ...only },
          select: { userId: true, clubId: true, joinedAt: true, requestedAt: true, club: { select: { approvedAt: true, officeId: true } } },
        })
      : [],
    db.task.findMany({
      where: { sourceType: "requirement", status: "OPEN", assigneeId: scope === "everyone" ? { not: null } : { in: [...scope.userIds] } },
      select: { id: true, assigneeId: true, sourceId: true, dueAt: true, title: true, href: true, clubId: true, required: true, officeId: true },
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
  // What each person's roles give them in each club, for single-permission requirements.
  const rolesIn = new Map<string, { role: ClubRole; permissions: string[] }[]>();
  for (const a of roles) rolesIn.set(`${a.userId}:${a.clubId}`, [...(rolesIn.get(`${a.userId}:${a.clubId}`) ?? []), a]);
  const holdings = new Map([...rolesIn].map(([key, list]) => [key, heldCapabilities(list)]));
  for (const a of roles) {
    seatsOf(a.userId).push({ role: a.role, startedAt: a.startedAt, clubId: a.clubId, clubApprovedAt: a.club.approvedAt, clubOfficeId: a.club.officeId ?? null, holds: holdings.get(`${a.userId}:${a.clubId}`) ?? null });
  }
  const memberSeats = memberships
    .map((m) => ({ userId: m.userId, seat: { role: "MEMBER" as const, startedAt: m.joinedAt ?? m.requestedAt, clubId: m.clubId, clubApprovedAt: m.club.approvedAt, clubOfficeId: m.club.officeId ?? null, holds: null } }))
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
  const [batch, inactive, forms, officeNames] = await Promise.all([
    loadRequirementBatch([...people.keys()], { at: now, requirements }),
    elsewhere.length ? db.roleRequirement.findMany({ where: { id: { in: elsewhere } }, select: { id: true, kind: true, testId: true } }) : [],
    testIds.length ? db.test.findMany({ where: { id: { in: testIds }, isForm: true }, select: { id: true } }) : [],
    loadOfficeNames(requirements),
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
    officeNames,
  };
}

/** The writes that bring everyone's inbox in line, and the notices to send after them. */
type SyncPlan = {
  done: string[];
  cancelled: string[];
  /** testId → people whose open assignment is excused. */
  excuse: Map<string, string[]>;
  updates: { id: string; data: { dueAt: Date; title: string; href: string; clubId: string | null; required: true; officeId?: string | null } }[];
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
    // Who requires it, for the task's badge ("Required by Campus Rec"); null is WSUSA.
    const officeId = w.requirement.officeId ?? null;
    const t = existing.get(reqId);
    if (t) {
      const officeChanged = (t.officeId ?? null) !== officeId;
      if (t.dueAt?.getTime() !== w.dueAt.getTime() || t.title !== title || t.href !== href || t.clubId !== clubId || !t.required || officeChanged) {
        plan.updates.push({ id: t.id, data: { dueAt: w.dueAt, title, href, clubId, required: true, ...(officeChanged ? { officeId } : {}) } });
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
        officeId,
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
    // WSUSA's, or the office's that owns them all ("Campus Recreation"); requirements from different owners just say requirements.
    const who = ownerName(opened.map((w) => w.requirement), inputs.officeNames);
    const kept = opened.filter((w) => w.gates);
    // Single-permission requirements keep that permission on, not every one.
    const what = kept.every((w) => w.requirement.gatesCapability) ? `your ${capabilityNames(kept.map((w) => w.requirement.gatesCapability!))} permission${new Set(kept.map((w) => w.requirement.gatesCapability)).size === 1 ? "" : "s"}` : "your permissions";
    const owned = who ? `${who} requirement` : "requirement";
    plan.notices.push({
      userIds: [userId],
      kind: "requirement.assigned",
      title: !gates
        ? who
          ? `Required by ${who}`
          : "Required for your clubs"
        : notifyMode === "new-role"
          ? `Your new role has ${owned}s`
          : opened.length === 1
            ? `${/^[AEIOU]/.test(owned) ? "An" : "A"} ${owned} to finish`
            : `${owned.charAt(0).toUpperCase()}${owned.slice(1)}s to finish`,
      body: !gates
        ? `${who === "WSUSA" ? "WSUSA asks every club member" : who ? `${who} asks every member of its clubs` : "Your clubs' offices ask every member"} to finish ${names}${soonest > now ? ` by ${fmtDate(soonest, "MMM d")}` : ""}.`
        : soonest <= now
          ? `Finish ${names} to turn ${what} back on.`
          : `Finish ${names} by ${fmtDate(soonest, "MMM d")} to keep ${what} on.`,
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
  // Together, so a requirement every member owes queues its emails instead of sending hundreds at once (lib/domain/notify).
  await notifyEach({ kind: "requirement.assigned", notices: plan.notices });
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

type GatingRequirement = { id: string; appliesTo: ClubRole[]; officeId: string | null; gatesCapability: string | null };

/**
 * Which (requirement, person) pairs reach the person through a current leader
 * role in an approved club (requirementReaches: its office's clubs, its one
 * permission's holders), so being overdue pauses their permissions. Keys
 * are `${requirementId}:${userId}`; `requirements` says what each one gates.
 */
async function gatingPairs(pairs: readonly { requirementId: string; userId: string }[]): Promise<{ keys: Set<string>; requirements: Map<string, GatingRequirement> }> {
  const keys = new Set<string>();
  if (!pairs.length) return { keys, requirements: new Map() };
  const [reqs, roles] = await Promise.all([
    db.roleRequirement.findMany({ where: { id: { in: [...new Set(pairs.map((p) => p.requirementId))] } }, select: { id: true, appliesTo: true, officeId: true, gatesCapability: true } }),
    db.roleAssignment.findMany({
      where: { userId: { in: [...new Set(pairs.map((p) => p.userId))] }, endedAt: null, club: { status: "APPROVED" } },
      select: { userId: true, role: true, permissions: true, clubId: true, club: { select: { officeId: true } } },
    }),
  ]);
  const byId = new Map(reqs.map((r) => [r.id, r]));
  // Every leader seat per person, with what they hold in its club.
  const inClub = new Map<string, typeof roles>();
  for (const a of roles) inClub.set(`${a.userId}:${a.clubId}`, [...(inClub.get(`${a.userId}:${a.clubId}`) ?? []), a]);
  const seats = new Map<string, { role: ClubRole; clubOfficeId: string | null; holds: Holdings }[]>();
  for (const [key, list] of inClub) {
    const holds = heldCapabilities(list);
    const userId = key.split(":")[0];
    for (const a of list) if (a.role !== "MEMBER") seats.set(userId, [...(seats.get(userId) ?? []), { role: a.role, clubOfficeId: a.club.officeId ?? null, holds }]);
  }
  for (const p of pairs) {
    const r = byId.get(p.requirementId);
    if (!r) continue;
    const leaderOnly = { ...r, appliesTo: r.appliesTo.filter((role) => role !== "MEMBER") };
    if ((seats.get(p.userId) ?? []).some((s) => requirementReaches(leaderOnly, s))) keys.add(`${p.requirementId}:${p.userId}`);
  }
  return { keys, requirements: new Map(reqs.map((r) => [r.id, { ...r, officeId: r.officeId ?? null, gatesCapability: r.gatesCapability ?? null }])) };
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
  const officeNames = await loadOfficeNames([...gating.requirements.values()]);
  const toldBy = new Map<string, { href: string | null; createdAt: Date }[]>();
  for (const n of told) toldBy.set(n.userId, [...(toldBy.get(n.userId) ?? []), n]);
  const notices: Omit<NotifyInput, "kind">[] = [];
  for (const t of late) {
    const from = t.dueAt ?? t.createdAt;
    const mine = toldBy.get(t.assigneeId!) ?? [];
    if (mine.some((n) => n.href === t.href && n.createdAt >= from)) continue;
    const name = t.title.replace(ACTION_PREFIX, "");
    const reqId = t.sourceId?.split(":")[0] ?? "";
    const gates = gating.keys.has(`${reqId}:${t.assigneeId}`);
    const r = gating.requirements.get(reqId);
    const who = r ? ownerName([r], officeNames) : "WSUSA";
    // A single-permission requirement pauses just that permission; the rest of the role keeps working.
    const cap = r?.gatesCapability ? capabilityNames([r.gatesCapability]) : null;
    notices.push({
      userIds: [t.assigneeId!],
      title: gates ? `${cap ?? "Permissions"} paused${t.club ? ` in ${t.club.name}` : ""}` : `A${who && /^[AEIOU]/.test(who) ? "n" : ""} ${who ?? "club"} requirement is overdue`,
      body: gates
        ? cap
          ? `${name} is overdue, so ${cap} is paused. Your title and your other permissions stay, and ${cap} comes back as soon as it's done.`
          : `${name} is overdue. Your title stays, and your permissions come back as soon as it's done.`
        : `${name} was due ${fmtDate(t.dueAt ?? now, "MMM d")}. ${who ?? "Your club's office"} requires it, so please finish it as soon as you can.`,
      href: t.href ?? "/tasks",
    });
    // Later tasks in this run see it, as they would have in the database.
    mine.push({ href: t.href ?? "/tasks", createdAt: new Date() });
    toldBy.set(t.assigneeId!, mine);
  }
  // Together, so a deadline every member shares queues its emails instead of sending hundreds at once.
  await notifyEach({ kind: "requirement.overdue", notices });
  return { notified: notices.length };
}

// ─── Admin: Requirements (/admin/requirements) ───────────────────────────────

function assertRequirementAdmin(actor: Actor | null): asserts actor is Actor {
  assertSignedIn(actor);
  if (!can(actor, "admin.tests") && !can(actor, "admin.trainings")) throw forbidden();
}

/**
 * Whose requirements someone manages: WSUSA's admins manage every office's
 * (and WSUSA's own, officeId null); an office's staff only their office's.
 * The same rule as administering that office's clubs (canAdminClub).
 */
function managesRequirementsOf(actor: Actor, officeId: string | null): boolean {
  return canAdminClub(actor, { officeId });
}

/** Requirements this person may see and manage (Admin → Requirements). */
function requirementScopeWhere(actor: Actor): Prisma.RoleRequirementWhereInput {
  const s = adminScope(actor);
  return s.all ? {} : { officeId: { in: s.officeIds } };
}

/**
 * Which office a saved requirement belongs to. WSUSA's admins choose (an
 * office's id, or empty for WSUSA's own); an office's staff always save their
 * own office's (the one they chose when they staff several).
 */
async function requirementOffice(actor: Actor, chosen: string | null | undefined): Promise<string | null> {
  const s = adminScope(actor);
  const id = chosen || null;
  if (!s.all) {
    if (id && s.officeIds.includes(id)) return id;
    if (!id && s.officeIds.length === 1) return s.officeIds[0];
    throw forbidden("You can add requirements for your own office's clubs only.");
  }
  if (!id) return null;
  const office = await db.office.findUnique({ where: { id }, select: { id: true, umbrella: true } });
  if (!office) throw invalid("That office doesn't exist anymore. Choose another.");
  return office.umbrella ? null : office.id;
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
    /** "Only people with the ___ permission": reaches only leaders who hold it, and overdue pauses only it. Empty = every leader permission. */
    gatesCapability: z
      .enum(ALL_CAPABILITIES as [Capability, ...Capability[]], { error: "Choose one of the club permissions." })
      .nullish()
      .or(z.literal("").transform(() => null)),
    /** Whose requirement it is (an office's id); empty = WSUSA's, for every club. */
    officeId: z.string().nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "TEST" && !v.testId) ctx.addIssue({ code: "custom", path: ["testId"], message: "Choose the test or form people must complete." });
    if (v.kind === "TRAINING" && !v.trainingEventId) ctx.addIssue({ code: "custom", path: ["trainingEventId"], message: "Choose the training people must attend." });
    if (v.gatesCapability && v.appliesTo.includes("MEMBER")) {
      ctx.addIssue({ code: "custom", path: ["appliesTo"], message: "Members don't hold club permissions, so choose leader roles for a requirement about one permission." });
    }
  });

export type RequirementInput = z.input<typeof RequirementInput>;

/**
 * Create (id null) or edit a requirement. Holders' tasks catch up via
 * syncAllRequirementHolders (the action runs it after responding). An
 * office's requirement reaches only its clubs and uses the office's own tests
 * and forms (Test.officeId); WSUSA's uses WSUSA's. Member details and
 * trainings (university events) are WSUSA's.
 */
export async function saveRequirement(actor: Actor | null, id: string | null, input: unknown): Promise<{ id: string }> {
  assertRequirementAdmin(actor);
  const v = parse(RequirementInput, input);
  const prev = id ? await db.roleRequirement.findUnique({ where: { id } }) : null;
  if (id && !prev) throw notFound("Requirement");
  if (prev && !managesRequirementsOf(actor, prev.officeId)) throw forbidden("This requirement belongs to another office.");
  const officeId = await requirementOffice(actor, v.officeId === undefined && prev ? prev.officeId : v.officeId);
  if (officeId && v.kind !== "TEST") throw invalid("An office's requirement is a test or form the office owns. Trainings and member details are WSUSA's.");
  if (v.kind === "PROFILE") {
    // Met from Settings → Member details; nothing to point at.
  } else if (v.kind === "TEST") {
    const test = await db.test.findUnique({ where: { id: v.testId! }, select: { clubId: true, status: true, audience: true, officeId: true } });
    if (!test || test.clubId !== null) throw invalid("Choose a university test or form (club tests and forms can't be WSUSA requirements).");
    if ((test.officeId ?? null) !== officeId) throw invalid(officeId ? "Choose one of your office's own tests or forms." : "Choose one of WSUSA's tests or forms. Another office's tests stay with its own requirements.");
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
    gatesCapability: v.gatesCapability ?? null,
    officeId,
  };
  const dupe = await db.roleRequirement.findFirst({ where: { name: { equals: v.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
  if (dupe) throw invalid("Another requirement already has that name.");

  let row: RoleRequirement;
  if (id) {
    row = await db.roleRequirement.update({ where: { id }, data });
    await logActivity({ actorId: actor.id, action: "requirement.updated", entityType: "roleRequirement", entityId: id, data: { name: row.name, active: row.active, graceDays: row.graceDays, renewal: row.renewal, gatesCapability: row.gatesCapability, officeId: row.officeId } });
  } else {
    row = await db.roleRequirement.create({ data });
    await logActivity({ actorId: actor.id, action: "requirement.created", entityType: "roleRequirement", entityId: row.id, data: { name: row.name, kind: row.kind, gatesCapability: row.gatesCapability, officeId: row.officeId } });
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
  if (!managesRequirementsOf(actor, prev.officeId)) throw forbidden("This requirement belongs to another office.");
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

/** The requirements this person manages (every one for WSUSA's admins, their office's for office staff), with what they point at and whose they are. */
export async function listRequirementsForAdmin(actor: Actor | null) {
  assertRequirementAdmin(actor);
  return db.roleRequirement.findMany({
    where: requirementScopeWhere(actor),
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    include: {
      test: { select: { id: true, title: true, status: true, audience: true, isForm: true } },
      trainingEvent: { select: { id: true, title: true, status: true, _count: { select: { occurrences: true } } } },
      office: { select: { id: true, name: true, shortName: true } },
    },
  });
}

/** Whether this person may open (and edit) one requirement. */
export async function requirementForAdmin(actor: Actor | null, id: string) {
  assertRequirementAdmin(actor);
  const r = await db.roleRequirement.findUnique({ where: { id } });
  return r && managesRequirementsOf(actor, r.officeId) ? r : null;
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

/**
 * What a requirement can point at, for this person: university tests and
 * forms (their office's, for office staff; each says whose), and scheduled
 * university events, trainings first (WSUSA's admins only). Also the offices
 * they can file a requirement under.
 */
export async function requirementTargets(actor: Actor | null) {
  assertRequirementAdmin(actor);
  const s = adminScope(actor);
  const [tests, events, offices] = await Promise.all([
    db.test.findMany({
      where: { clubId: null, status: { not: "ARCHIVED" }, ...(s.all ? {} : { officeId: { in: s.officeIds } }) },
      orderBy: { title: "asc" },
      select: { id: true, title: true, status: true, audience: true, isForm: true, officeId: true },
    }),
    s.all ? db.event.findMany({ where: { clubId: null, status: "SCHEDULED" }, orderBy: { title: "asc" }, select: { id: true, title: true, kind: true } }) : Promise.resolve([]),
    db.office.findMany({ where: { umbrella: false, ...(s.all ? {} : { id: { in: s.officeIds } }) }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { tests, events: [...events.filter((e) => e.kind === "TRAINING"), ...events.filter((e) => e.kind !== "TRAINING")], offices, umbrella: s.all };
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
  /** By requirement id; requirements that don't reach the seat are absent. */
  cells: Record<string, ComplianceCell>;
  /** Overdue → this person's capabilities in this club are paused (same rule as getClubAccess). */
  paused: boolean;
  /** Only these permissions are paused (overdue single-permission requirements); absent otherwise. */
  pausedCapabilities?: string[];
};

const ROLE_ORDER: Record<ClubRole, number> = { MEMBER: 0, AMBASSADOR: 1, OFFICER: 1, VP: 2, PRESIDENT: 3, ADVISOR: 4 };

/**
 * Every current student leader of an approved club (or of `opts.clubIds`, or
 * the clubs `opts.clubWhere` picks: an office's), one row per person per club
 * (their highest role there — exactly what getClubAccess checks), with each
 * requirement's status. The batch evaluator answers for all of them at once:
 * requirementStatus's rule, one load. Read-only.
 */
export async function requirementCompliance(now: Date = new Date(), opts: { clubIds?: string[]; clubWhere?: Prisma.ClubWhereInput } = {}): Promise<ComplianceRow[]> {
  const assignments = await db.roleAssignment.findMany({
    where: { endedAt: null, role: { in: REQUIREMENT_ROLES }, club: { ...opts.clubWhere, status: "APPROVED" }, user: { status: "ACTIVE" }, ...(opts.clubIds ? { clubId: { in: opts.clubIds } } : {}) },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      role: true,
      permissions: true,
      startedAt: true,
      position: { select: { name: true } },
      club: { select: { id: true, name: true, slug: true, approvedAt: true, officeId: true } },
      user: { select: { id: true, name: true, email: true, handle: true, avatarUrl: true, avatarColor: true } },
    },
  });
  // Highest role per person per club, like getClubAccess; what all their seats there give them.
  const top = new Map<string, (typeof assignments)[number]>();
  const seatsIn = new Map<string, (typeof assignments)[number][]>();
  for (const a of assignments) {
    const k = `${a.user.id}:${a.club.id}`;
    const prev = top.get(k);
    if (!prev || ROLE_ORDER[a.role] > ROLE_ORDER[prev.role]) top.set(k, a);
    seatsIn.set(k, [...(seatsIn.get(k) ?? []), a]);
  }
  const list = [...top.entries()];
  const batch = await loadRequirementBatch([...new Set(list.map(([, a]) => a.user.id))], { at: now });
  const rows = list.map(([key, a]): ComplianceRow => {
    const status = batch.status(a.user.id, a.role, { startedAt: a.startedAt, clubApprovedAt: a.club.approvedAt, clubOfficeId: a.club.officeId ?? null, holds: heldCapabilities(seatsIn.get(key)!) });
    const cells: Record<string, ComplianceCell> = {};
    for (const it of status.items) cells[it.requirement.id] = { state: it.state, dueAt: it.dueAt };
    const row: ComplianceRow = { key, person: a.user, club: { id: a.club.id, name: a.club.name, slug: a.club.slug }, role: a.role, seat: a.position?.name ?? null, startedAt: a.startedAt, cells, paused: status.pause.all };
    if (status.pause.capabilities.length) row.pausedCapabilities = status.pause.capabilities;
    return row;
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
  /** The one permission it pauses (a single-permission requirement); null = every leader permission. */
  capability: Capability | null;
};

/**
 * What's overdue for the actor in one club, through their highest role there
 * (the role getClubAccess checks): why their permissions are paused, all of
 * them or one. Empty when nothing is. Read-only.
 */
export async function pauseReasons(actor: Actor | null, clubId: string, now: Date = new Date()): Promise<PauseReason[]> {
  assertSignedIn(actor);
  const club = await db.club.findUnique({ where: { id: clubId }, select: { status: true, approvedAt: true, officeId: true } });
  if (club?.status !== "APPROVED") return [];
  const roles = await db.roleAssignment.findMany({ where: { clubId, userId: actor.id, endedAt: null } });
  const top = [...roles].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])[0];
  if (!top || ROLE_RANK[top.role] < 1 || top.role === "ADVISOR") return [];
  const status = await requirementStatus(actor.id, top.role, { assignmentStartedAt: top.startedAt, clubApprovedAt: club.approvedAt, at: now, clubOfficeId: club.officeId, holds: heldCapabilities(roles) });
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
      capability: r.gatesCapability && r.gatesCapability in CAPABILITIES ? (r.gatesCapability as Capability) : null,
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
  const reqs = await db.roleRequirement.findMany({ where: { active: true, ...requirementScopeWhere(actor) }, orderBy: { createdAt: "asc" }, include: { test: { select: { isForm: true } } } });
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
  // Paused = overdue on a requirement that reaches them through a leader role (getClubAccess's rule): every permission, or its one.
  const gating = await gatingPairs(overdueLeaderTasks.map((t) => ({ requirementId: t.reqId, userId: t.userId })));
  const paused = new Set(overdueLeaderTasks.filter((t) => gating.keys.has(`${t.reqId}:${t.userId}`)).map((t) => t.userId));
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
