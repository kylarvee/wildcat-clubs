/**
 * The requirement rule as it was before the batch evaluator: one person at a
 * time, one query per requirement per seat. Kept verbatim (from
 * lib/authz/requirements and lib/domain/requirements) only so the equivalence
 * tests can run it against the same data as the batch evaluator and compare.
 * Nothing in the app imports this.
 */
import { cache } from "react";
import type { ClubRole, RenewalPeriod, RoleRequirement } from "@prisma/client";
import { TZDate } from "@date-fns/tz";
import { db } from "@/lib/db";
import { getTerms, currentOrLastTerm, academicYearAt } from "@/lib/terms";
import { fmtDate, TZ } from "@/lib/time";
import { detailsCurrent, missingDetails } from "@/lib/details/rules";
import { awaitingGrade, requirementState, type RequirementState } from "@/lib/authz/requirement-rules";
import { createTask } from "@/lib/domain/tasks";
import { notify } from "@/lib/domain/notify";
import { renewalCycle } from "@/lib/tests/cycles";

// ─── lib/authz/requirements (before) ─────────────────────────────────────────

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

const activeRequirements = cache(async () => db.roleRequirement.findMany({ where: { active: true } }));

export async function periodStartFor(renewal: RenewalPeriod, at: Date): Promise<Date> {
  if (renewal === "NONE") return new Date(0);
  if (renewal === "ANNUAL") return new TZDate(new TZDate(at, TZ).getFullYear(), 0, 1, TZ);
  const terms = await getTerms();
  if (renewal === "SEMESTER") return currentOrLastTerm(terms, at)?.startsOn ?? new Date(0);
  return academicYearAt(terms, at)?.start ?? new Date(0);
}

export async function requirementStatus(
  userId: string,
  role: ClubRole,
  ctx: { assignmentStartedAt: Date; clubApprovedAt: Date | null; at?: Date },
): Promise<{ items: RequirementItem[]; overdue: boolean; allMet: boolean }> {
  const at = ctx.at ?? new Date();
  const reqs = (await activeRequirements()).filter((r) => r.appliesTo.includes(role));
  const items: RequirementItem[] = [];
  for (const r of reqs) {
    const periodStart = await periodStartFor(r.renewal, at);
    const clock = Math.max(ctx.assignmentStartedAt.getTime(), ctx.clubApprovedAt?.getTime() ?? 0, periodStart.getTime(), r.createdAt.getTime());
    const dueAt = new Date(clock + r.graceDays * 86_400_000);
    let met = false;
    let waiting = false;
    let gradingPending = false;
    if (r.kind === "TEST" && r.testId) {
      // Passed this period, or handed in and waiting for a grader.
      const attempts = await db.testAttempt.findMany({
        where: { testId: r.testId, userId, submittedAt: { gte: periodStart }, OR: [{ passed: true }, { status: "NEEDS_REVIEW" }] },
        select: { status: true, passed: true, submittedAt: true },
      });
      met = attempts.some((a) => a.passed);
      gradingPending = !met && attempts.some((a) => a.status === "NEEDS_REVIEW");
      waiting = !met && awaitingGrade(attempts, dueAt);
    } else if (r.kind === "TRAINING" && r.trainingEventId) {
      met =
        (await db.attendance.count({
          where: { userId, checkedInAt: { gte: periodStart }, occurrence: { eventId: r.trainingEventId } },
        })) > 0;
    } else if (r.kind === "PROFILE") {
      // Member details: complete and confirmed this period (Settings → Member details).
      const u = await db.user.findUnique({ where: { id: userId }, select: { kind: true, details: true } });
      met = Boolean(u && detailsCurrent(u.details, u.kind, periodStart));
    }
    const state = requirementState({ met, awaitingGrade: waiting, dueAt, at });
    items.push({ requirement: r, met, awaitingGrade: waiting, gradingPending, periodStart, dueAt, overdue: state === "overdue", state });
  }
  return { items, overdue: items.some((i) => i.overdue), allMet: items.every((i) => i.met) };
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

// ─── lib/domain/requirements: sync, holders, overdue notices (before) ────────

export function requirementSourceId(requirementId: string, userId: string) {
  return `${requirementId}:${userId}`;
}

/** The leader roles a requirement can gate. */
export const REQUIREMENT_ROLES: ClubRole[] = ["AMBASSADOR", "OFFICER", "VP", "PRESIDENT"];
/** Everyone a requirement can apply to: members plus the leader roles. */
export const REQUIREMENT_AUDIENCE: ClubRole[] = ["MEMBER", ...REQUIREMENT_ROLES];

type NotifyMode = "new-role" | "due" | false;

type Want = {
  requirement: Pick<RoleRequirement, "id" | "name" | "description" | "kind" | "testId" | "trainingEventId" | "renewal">;
  dueAt: Date;
  clubId: string;
  /** Applies through one of their leader roles, so being overdue pauses permissions. */
  gates: boolean;
};

/** One place a requirement can reach someone: a leader role, or (as MEMBER) a membership. */
type Seat = { role: ClubRole; startedAt: Date; clubId: string; clubApprovedAt: Date | null };

function requirementHref(r: Want["requirement"]) {
  if (r.kind === "PROFILE") return "/settings/details";
  if (r.kind === "TEST" && r.testId) return `/tests/${r.testId}`;
  if (r.trainingEventId) return `/events/${r.trainingEventId}`;
  return "/tasks";
}

/** What to do, as the task title says it. Member details still missing a field are filled in; complete ones are confirmed. */
function requirementTitle(r: Want["requirement"], isForm: boolean, detailsMissing = false) {
  if (r.kind === "TRAINING") return `Attend: ${r.name}`;
  if (r.kind === "PROFILE") return `${detailsMissing ? "Fill in" : "Confirm"}: ${r.name}`;
  return isForm ? `Fill out: ${r.name}` : `Pass: ${r.name}`;
}

/** Task titles start with what to do; notifications drop it. */
const ACTION_PREFIX = /^(Pass|Attend|Fill out|Fill in|Confirm): /;

/** A person's current seats a requirement can reach: leader roles, plus memberships (students only). */
async function seatsFor(userId: string): Promise<Seat[]> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { status: true, kind: true } });
  if (user?.status !== "ACTIVE") return [];
  const [roles, memberships] = await Promise.all([
    db.roleAssignment.findMany({
      where: { userId, endedAt: null, role: { in: REQUIREMENT_ROLES }, club: { status: "APPROVED" } },
      select: { role: true, startedAt: true, clubId: true, club: { select: { approvedAt: true } } },
    }),
    user.kind === "STUDENT"
      ? db.membership.findMany({ where: { userId, status: "ACTIVE", club: { status: "APPROVED" } }, select: { clubId: true, joinedAt: true, requestedAt: true, club: { select: { approvedAt: true } } } })
      : [],
  ]);
  return [
    ...roles.map((a) => ({ role: a.role, startedAt: a.startedAt, clubId: a.clubId, clubApprovedAt: a.club.approvedAt })),
    ...memberships.map((m) => ({ role: "MEMBER" as const, startedAt: m.joinedAt ?? m.requestedAt, clubId: m.clubId, clubApprovedAt: m.club.approvedAt })),
  ];
}

/**
 * Brings one person's requirement tasks (and requirement-test assignments) in
 * line with their current roles and memberships. Idempotent and self-healing:
 *   unmet + applies  → an open task due at the earliest deadline across their roles
 *   met              → open task closed (DONE)
 *   no longer applies (role ended, requirement turned off) → open task cancelled
 * Returns the names of requirements that got a NEW task.
 */
export async function syncUserRequirements(userId: string, opts: { notify?: NotifyMode; now?: Date } = {}): Promise<{ opened: string[]; open: number }> {
  const now = opts.now ?? new Date();
  const seats = await seatsFor(userId);

  const wants = new Map<string, Want>();
  const met = new Set<string>();
  for (const s of seats) {
    const status = await requirementStatus(userId, s.role, { assignmentStartedAt: s.startedAt, clubApprovedAt: s.clubApprovedAt, at: now });
    const gates = s.role !== "MEMBER";
    for (const item of status.items) {
      if (item.met) {
        met.add(item.requirement.id);
        continue;
      }
      const prev = wants.get(item.requirement.id);
      if (!prev || item.dueAt < prev.dueAt) wants.set(item.requirement.id, { requirement: item.requirement, dueAt: item.dueAt, clubId: s.clubId, gates: gates || Boolean(prev?.gates) });
      else if (gates) prev.gates = true;
    }
  }
  for (const id of met) wants.delete(id);

  const testIds = [...new Set([...wants.values()].map((w) => w.requirement.testId).filter((id): id is string => Boolean(id)))];
  const forms = new Set(testIds.length ? (await db.test.findMany({ where: { id: { in: testIds }, isForm: true }, select: { id: true } })).map((t) => t.id) : []);
  // Member details still missing a field read "Fill in", complete ones "Confirm".
  const person = [...wants.values()].some((w) => w.requirement.kind === "PROFILE") ? await db.user.findUnique({ where: { id: userId }, select: { kind: true, details: true } }) : null;
  const detailsMissing = Boolean(person && missingDetails(person.details, person.kind).length);

  const openTasks = await db.task.findMany({
    where: { sourceType: "requirement", assigneeId: userId, status: "OPEN" },
    select: { id: true, sourceId: true, dueAt: true, title: true, href: true, clubId: true, required: true },
  });
  const openByReq = new Map(openTasks.map((t) => [t.sourceId?.split(":")[0] ?? "", t]));

  // Close what's done or no longer applies.
  const stillWantedTests = new Set([...wants.values()].map((w) => w.requirement.testId).filter(Boolean));
  for (const t of openTasks) {
    const reqId = t.sourceId?.split(":")[0] ?? "";
    if (wants.has(reqId)) continue;
    const done = met.has(reqId);
    await db.task.update({ where: { id: t.id }, data: { status: done ? "DONE" : "CANCELLED", completedAt: now } });
    if (!done) await excuseRequirementAssignments(reqId, userId, now, stillWantedTests);
  }

  const terms = await getTerms();
  const opened: Want[] = [];
  for (const [reqId, w] of wants) {
    const href = requirementHref(w.requirement);
    const title = requirementTitle(w.requirement, Boolean(w.requirement.testId && forms.has(w.requirement.testId)), detailsMissing);
    // A leader's task names the club whose permissions it gates; a member-wide one is WSUSA's, not any club's.
    const clubId = w.gates ? w.clubId : null;
    const existing = openByReq.get(reqId);
    if (existing) {
      if (existing.dueAt?.getTime() !== w.dueAt.getTime() || existing.title !== title || existing.href !== href || existing.clubId !== clubId || !existing.required) {
        await db.task.update({ where: { id: existing.id }, data: { dueAt: w.dueAt, title, href, clubId, required: true } });
      }
    } else {
      await createTask({
        kind: "REQUIREMENT",
        title,
        description: w.requirement.description ?? undefined,
        assignee: { type: "USER", userId },
        clubId,
        dueAt: w.dueAt,
        href,
        source: { type: "requirement", id: requirementSourceId(reqId, userId) },
        required: true,
      });
      opened.push(w);
    }
    // Requirement tests and forms also get an assignment for this renewal cycle, so the Test Tool tracks due dates and misses.
    if (w.requirement.kind === "TEST" && w.requirement.testId) {
      const cycleKey = renewalCycle(w.requirement.renewal, now, terms).key;
      const key = { testId_userId_cycleKey: { testId: w.requirement.testId, userId, cycleKey } };
      const a = await db.testAssignment.findUnique({ where: key, select: { status: true, dueAt: true } });
      if (!a) await db.testAssignment.create({ data: { testId: w.requirement.testId, userId, cycleKey, dueAt: w.dueAt } });
      else if (a.status === "ASSIGNED" && a.dueAt.getTime() !== w.dueAt.getTime()) await db.testAssignment.update({ where: key, data: { dueAt: w.dueAt } });
      else if (a.status === "EXCUSED") await db.testAssignment.update({ where: key, data: { status: "ASSIGNED", dueAt: w.dueAt, resolvedAt: null } });
    }
  }

  if (opened.length && opts.notify) {
    const names = opened.map((w) => w.requirement.name).join(", ");
    const soonest = opened.reduce((d, w) => (w.dueAt < d ? w.dueAt : d), opened[0].dueAt);
    const gates = opened.some((w) => w.gates);
    await notify({
      userIds: [userId],
      kind: "requirement.assigned",
      title: !gates ? "Required by WSUSA" : opts.notify === "new-role" ? "Your new role has WSUSA requirements" : opened.length === 1 ? "A WSUSA requirement to finish" : "WSUSA requirements to finish",
      body: !gates
        ? `WSUSA asks every club member to finish ${names}${soonest > now ? ` by ${fmtDate(soonest, "MMM d")}` : ""}.`
        : soonest <= now
          ? `Finish ${names} to turn your permissions back on.`
          : `Finish ${names} by ${fmtDate(soonest, "MMM d")} to keep your permissions on.`,
      href: "/tasks",
    });
  }
  return { opened: opened.map((w) => w.requirement.name), open: wants.size };
}

/** The person no longer owes an officer test (role ended, requirement off): their open assignment is excused. */
async function excuseRequirementAssignments(requirementId: string, userId: string, now: Date, stillWantedTests: Set<string | null>) {
  const req = await db.roleRequirement.findUnique({ where: { id: requirementId }, select: { kind: true, testId: true } });
  if (req?.kind !== "TEST" || !req.testId) return;
  if (stillWantedTests.has(req.testId)) return; // another requirement still asks for the same test
  await db.testAssignment.updateMany({ where: { testId: req.testId, userId, status: "ASSIGNED", test: { audience: "ROLE_REQUIREMENT" } }, data: { status: "EXCUSED", resolvedAt: now } });
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

/**
 * Everyone whose requirement inbox may need attention: current student
 * leaders, every student in an approved club while any requirement applies
 * to members, and anyone with an open requirement task.
 */
export async function requirementHolderIds(): Promise<string[]> {
  const memberRequirements = await db.roleRequirement.count({ where: { active: true, appliesTo: { has: "MEMBER" } } });
  const [holders, members, open] = await Promise.all([
    db.roleAssignment.findMany({
      where: { endedAt: null, role: { in: REQUIREMENT_ROLES }, club: { status: "APPROVED" }, user: { status: "ACTIVE" } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    memberRequirements
      ? db.membership.findMany({ where: { status: "ACTIVE", club: { status: "APPROVED" }, user: { status: "ACTIVE", kind: "STUDENT" } }, select: { userId: true }, distinct: ["userId"] })
      : [],
    db.task.findMany({ where: { sourceType: "requirement", status: "OPEN" }, select: { assigneeId: true }, distinct: ["assigneeId"] }),
  ]);
  return [...new Set([...holders.map((h) => h.userId), ...members.map((m) => m.userId), ...open.map((t) => t.assigneeId).filter((id): id is string => Boolean(id))])];
}

/** Scheduled job + admin changes: re-check every holder (renewals, new requirements, ended roles). */
export async function syncAllRequirementHolders(opts: { notify?: NotifyMode; now?: Date } = {}): Promise<{ people: number; opened: number }> {
  const ids = await requirementHolderIds();
  let opened = 0;
  for (const id of ids) opened += (await syncUserRequirements(id, opts)).opened.length;
  return { people: ids.length, opened };
}

/** True when a requirement reaches this person through a leader role, so being overdue pauses their permissions. */
async function requirementGates(requirementId: string, userId: string): Promise<boolean> {
  const req = await db.roleRequirement.findUnique({ where: { id: requirementId }, select: { appliesTo: true } });
  const roles = (req?.appliesTo ?? []).filter((r) => r !== "MEMBER");
  if (!roles.length) return false;
  return (await db.roleAssignment.count({ where: { userId, endedAt: null, role: { in: roles }, club: { status: "APPROVED" } } })) > 0;
}

/**
 * Tells people once when a requirement deadline passes: leaders that their
 * permissions paused, members that it's overdue. Idempotent: skips anyone
 * already told about that task. A test handed in on time that's still
 * waiting for a grader isn't overdue, so nobody hears about it.
 */
export async function notifyOverdueRequirements(now: Date = new Date()): Promise<{ notified: number }> {
  const overdue = await db.task.findMany({
    where: { sourceType: "requirement", status: "OPEN", dueAt: { lt: now }, assigneeId: { not: null } },
    select: { id: true, status: true, sourceType: true, assigneeId: true, title: true, href: true, createdAt: true, dueAt: true, sourceId: true, club: { select: { name: true } } },
  });
  const waiting = await tasksAwaitingGrade(overdue, now);
  let notified = 0;
  for (const t of overdue) {
    if (waiting.has(t.id)) continue;
    const already = await db.notification.count({ where: { userId: t.assigneeId!, kind: "requirement.overdue", href: t.href, createdAt: { gte: t.dueAt ?? t.createdAt } } });
    if (already) continue;
    const name = t.title.replace(ACTION_PREFIX, "");
    const gates = await requirementGates(t.sourceId?.split(":")[0] ?? "", t.assigneeId!);
    await notify({
      userIds: [t.assigneeId!],
      kind: "requirement.overdue",
      title: gates ? `Permissions paused${t.club ? ` in ${t.club.name}` : ""}` : "A WSUSA requirement is overdue",
      body: gates ? `${name} is overdue. Your title stays, and your permissions come back as soon as it's done.` : `${name} was due ${fmtDate(t.dueAt ?? now, "MMM d")}. WSUSA requires it, so please finish it as soon as you can.`,
      href: t.href ?? "/tasks",
    });
    notified++;
  }
  return { notified };
}


// ─── lib/domain/requirements: compliance (before) ────────────────────────────

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
 * getClubAccess checks), with each requirement's status from
 * requirementStatus. Read-only.
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
  const rows: ComplianceRow[] = [];
  // A few at a time keeps the page quick without flooding the connection pool.
  for (let i = 0; i < list.length; i += 12) {
    const chunk = await Promise.all(
      list.slice(i, i + 12).map(async ([key, a]) => {
        const status = await requirementStatus(a.user.id, a.role, { assignmentStartedAt: a.startedAt, clubApprovedAt: a.club.approvedAt, at: now });
        const cells: Record<string, ComplianceCell> = {};
        for (const it of status.items) cells[it.requirement.id] = { state: it.state, dueAt: it.dueAt };
        return { key, person: a.user, club: { id: a.club.id, name: a.club.name, slug: a.club.slug }, role: a.role, seat: a.position?.name ?? null, startedAt: a.startedAt, cells, paused: status.overdue } satisfies ComplianceRow;
      }),
    );
    rows.push(...chunk);
  }
  return rows.sort((a, b) => Number(b.paused) - Number(a.paused) || a.person.name.localeCompare(b.person.name) || a.club.name.localeCompare(b.club.name));
}
