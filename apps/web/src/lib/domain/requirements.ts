import "server-only";
import type { ClubRole, RoleRequirement } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { can, getClubAccess } from "@/lib/authz";
import { periodStartFor, requirementStatus } from "@/lib/authz/requirements";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { createTask } from "@/lib/domain/tasks";
import { notify } from "@/lib/domain/notify";
import { getTerms } from "@/lib/terms";
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
  if (r.kind === "TEST" && r.testId) return `/tests/${r.testId}`;
  if (r.trainingEventId) return `/events/${r.trainingEventId}`;
  return "/tasks";
}

function requirementTitle(r: Want["requirement"], isForm: boolean) {
  if (r.kind === "TRAINING") return `Attend: ${r.name}`;
  return isForm ? `Fill out: ${r.name}` : `Pass: ${r.name}`;
}

/** Task titles start with what to do; notifications drop it. */
const ACTION_PREFIX = /^(Pass|Attend|Fill out): /;

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
    const title = requirementTitle(w.requirement, Boolean(w.requirement.testId && forms.has(w.requirement.testId)));
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
      title: !gates ? "Required by WSUSA" : opts.notify === "new-role" ? "Your new role has required training" : "Officer requirement to finish",
      body: !gates
        ? `WSUSA asks every club member to finish ${names}${soonest > now ? ` by ${fmtDate(soonest, "MMM d")}` : ""}.`
        : soonest <= now
          ? `Finish ${names} to turn your leadership permissions back on.`
          : `Finish ${names} by ${fmtDate(soonest, "MMM d")} to keep your leadership permissions active.`,
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
 * already told about that task.
 */
export async function notifyOverdueRequirements(now: Date = new Date()): Promise<{ notified: number }> {
  const overdue = await db.task.findMany({
    where: { sourceType: "requirement", status: "OPEN", dueAt: { lt: now }, assigneeId: { not: null } },
    select: { id: true, assigneeId: true, title: true, href: true, createdAt: true, dueAt: true, sourceId: true },
  });
  let notified = 0;
  for (const t of overdue) {
    const already = await db.notification.count({ where: { userId: t.assigneeId!, kind: "requirement.overdue", href: t.href, createdAt: { gte: t.dueAt ?? t.createdAt } } });
    if (already) continue;
    const name = t.title.replace(ACTION_PREFIX, "");
    const gates = await requirementGates(t.sourceId?.split(":")[0] ?? "", t.assigneeId!);
    await notify({
      userIds: [t.assigneeId!],
      kind: "requirement.overdue",
      title: gates ? "Your leadership permissions are paused" : "A WSUSA requirement is overdue",
      body: gates ? `${name} is overdue. Your title stays; your permissions come back as soon as it's done.` : `${name} was due ${fmtDate(t.dueAt ?? now, "MMM d")}. WSUSA requires it, so please finish it as soon as you can.`,
      href: t.href ?? "/tasks",
    });
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
    kind: z.enum(["TEST", "TRAINING"]),
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
  if (v.kind === "TEST") {
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
 * (members included): how many people still owe it and how many are late.
 */
export async function openRequirementCounts(now: Date = new Date()): Promise<Map<string, { open: number; overdue: number }>> {
  const rows = await db.task.findMany({ where: { sourceType: "requirement", status: "OPEN" }, select: { sourceId: true, dueAt: true } });
  const out = new Map<string, { open: number; overdue: number }>();
  for (const r of rows) {
    const id = r.sourceId?.split(":")[0];
    if (!id) continue;
    const c = out.get(id) ?? { open: 0, overdue: 0 };
    c.open++;
    if (r.dueAt && r.dueAt < now) c.overdue++;
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

export type ComplianceState = "met" | "due" | "overdue";
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
        for (const it of status.items) cells[it.requirement.id] = { state: it.met ? "met" : it.overdue ? "overdue" : "due", dueAt: it.dueAt };
        return { key, person: a.user, club: { id: a.club.id, name: a.club.name, slug: a.club.slug }, role: a.role, seat: a.position?.name ?? null, startedAt: a.startedAt, cells, paused: status.overdue } satisfies ComplianceRow;
      }),
    );
    rows.push(...chunk);
  }
  return rows.sort((a, b) => Number(b.paused) - Number(a.paused) || a.person.name.localeCompare(b.person.name) || a.club.name.localeCompare(b.club.name));
}

// ─── Dashboards ──────────────────────────────────────────────────────────────

export type RequirementOverviewRow = {
  id: string;
  name: string;
  kind: "TEST" | "FORM" | "TRAINING";
  appliesTo: ClubRole[];
  /** Finished this renewal period. */
  done: number;
  /** Still owed (open required tasks). */
  open: number;
  overdue: number;
  /** The soonest deadline still ahead, among open tasks. */
  nextDue: Date | null;
};

/**
 * The admin dashboard's "What WSUSA requires": each active requirement's
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
    select: { sourceId: true, status: true, dueAt: true, completedAt: true, assigneeId: true },
  });
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
    const late = open.filter((t) => t.dueAt && t.dueAt < now);
    const ahead = open.map((t) => t.dueAt).filter((d): d is Date => Boolean(d && d >= now));
    rows.push({
      id: r.id,
      name: r.name,
      kind: r.kind === "TRAINING" ? "TRAINING" : r.test?.isForm ? "FORM" : "TEST",
      appliesTo: r.appliesTo,
      done: mine.filter((t) => t.status === "DONE" && t.completedAt && t.completedAt >= start).length,
      open: open.length,
      overdue: late.length,
      nextDue: ahead.length ? new Date(Math.min(...ahead.map((d) => d.getTime()))) : null,
    });
    if (r.appliesTo.some((role) => role !== "MEMBER")) for (const t of late) if (t.assigneeId) overdueLeaderTasks.push({ reqId: r.id, userId: t.assigneeId });
  }
  // Paused = overdue on a requirement that reaches them through a leader role (getClubAccess's rule).
  const paused = new Set<string>();
  for (const t of overdueLeaderTasks) if (!paused.has(t.userId) && (await requirementGates(t.reqId, t.userId))) paused.add(t.userId);
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
 * The advisor dashboard's "Officer requirements": where the student leaders
 * of each club stand, for clubs the actor advises (or any club, for admins).
 */
export async function clubLeaderCompliance(actor: Actor | null, clubIds: string[], now: Date = new Date()): Promise<ClubLeaderCompliance[]> {
  assertSignedIn(actor);
  const allowed: string[] = [];
  for (const id of clubIds) {
    const access = await getClubAccess(actor, id);
    if (access?.isAdvisor || access?.viaPlatform) allowed.push(id);
  }
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
