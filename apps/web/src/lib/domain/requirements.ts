import "server-only";
import type { ClubRole, RoleRequirement } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { requirementStatus } from "@/lib/authz/requirements";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { createTask } from "@/lib/domain/tasks";
import { notify } from "@/lib/domain/notify";
import { getTerms } from "@/lib/terms";
import { fmtDate } from "@/lib/time";
import { renewalCycle } from "@/lib/tests/cycles";

/**
 * Officer requirements (tests and trainings WSUSA attaches to roles).
 *
 * Whether someone has MET a requirement is computed in lib/authz/requirements
 * from passed test attempts and training check-ins — never stored. This
 * module keeps the inbox in step with that: one REQUIREMENT task per person
 * per requirement (source `${requirementId}:${userId}`), plus a
 * TestAssignment for TEST requirements so the Test Tool can track the cycle.
 * The Test Tool (on a pass) and the Attendance Tool (on a training check-in)
 * close the task with resolveTasks("requirement", requirementSourceId(...)).
 *
 * Requirements bind student leaders (Ambassador and up, not advisors) of
 * APPROVED clubs only — the same rule getClubAccess uses for pausing.
 */
export function requirementSourceId(requirementId: string, userId: string) {
  return `${requirementId}:${userId}`;
}

export const REQUIREMENT_ROLES: ClubRole[] = ["AMBASSADOR", "OFFICER", "VP", "PRESIDENT"];

type NotifyMode = "new-role" | "due" | false;

type Want = {
  requirement: Pick<RoleRequirement, "id" | "name" | "description" | "kind" | "testId" | "trainingEventId" | "renewal">;
  dueAt: Date;
  clubId: string;
};

function requirementHref(r: Want["requirement"]) {
  if (r.kind === "TEST" && r.testId) return `/tests/${r.testId}`;
  if (r.trainingEventId) return `/events/${r.trainingEventId}`;
  return "/tasks";
}

function requirementTitle(r: Want["requirement"]) {
  return r.kind === "TEST" ? `Pass: ${r.name}` : `Attend: ${r.name}`;
}

/**
 * Brings one person's requirement tasks (and officer-test assignments) in line
 * with their current roles. Idempotent and self-healing:
 *   unmet + applies  → an open task due at the earliest deadline across their roles
 *   met              → open task closed (DONE)
 *   no longer applies (role ended, requirement turned off) → open task cancelled
 * Returns the names of requirements that got a NEW task.
 */
export async function syncUserRequirements(userId: string, opts: { notify?: NotifyMode; now?: Date } = {}): Promise<{ opened: string[]; open: number }> {
  const now = opts.now ?? new Date();
  const user = await db.user.findUnique({ where: { id: userId }, select: { status: true } });
  const assignments =
    user?.status === "ACTIVE"
      ? await db.roleAssignment.findMany({
          where: { userId, endedAt: null, role: { in: REQUIREMENT_ROLES }, club: { status: "APPROVED" } },
          select: { role: true, startedAt: true, clubId: true, club: { select: { approvedAt: true } } },
        })
      : [];

  const wants = new Map<string, Want>();
  const met = new Set<string>();
  for (const a of assignments) {
    const status = await requirementStatus(userId, a.role, { assignmentStartedAt: a.startedAt, clubApprovedAt: a.club.approvedAt, at: now });
    for (const item of status.items) {
      if (item.met) {
        met.add(item.requirement.id);
        continue;
      }
      const prev = wants.get(item.requirement.id);
      if (!prev || item.dueAt < prev.dueAt) wants.set(item.requirement.id, { requirement: item.requirement, dueAt: item.dueAt, clubId: a.clubId });
    }
  }
  for (const id of met) wants.delete(id);

  const openTasks = await db.task.findMany({
    where: { sourceType: "requirement", assigneeId: userId, status: "OPEN" },
    select: { id: true, sourceId: true, dueAt: true, title: true, href: true, clubId: true },
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
    const title = requirementTitle(w.requirement);
    const existing = openByReq.get(reqId);
    if (existing) {
      if (existing.dueAt?.getTime() !== w.dueAt.getTime() || existing.title !== title || existing.href !== href || existing.clubId !== w.clubId) {
        await db.task.update({ where: { id: existing.id }, data: { dueAt: w.dueAt, title, href, clubId: w.clubId } });
      }
    } else {
      await createTask({
        kind: "REQUIREMENT",
        title,
        description: w.requirement.description ?? undefined,
        assignee: { type: "USER", userId },
        clubId: w.clubId,
        dueAt: w.dueAt,
        href,
        source: { type: "requirement", id: requirementSourceId(reqId, userId) },
      });
      opened.push(w);
    }
    // Officer tests also get an assignment for this renewal cycle, so the Test Tool tracks due dates and misses.
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
    await notify({
      userIds: [userId],
      kind: "requirement.assigned",
      title: opts.notify === "new-role" ? "Your new role has required training" : "Officer requirement to finish",
      body:
        soonest <= now
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

/** Everyone whose requirement inbox may need attention: current student leaders + anyone with an open requirement task. */
export async function requirementHolderIds(): Promise<string[]> {
  const [holders, open] = await Promise.all([
    db.roleAssignment.findMany({
      where: { endedAt: null, role: { in: REQUIREMENT_ROLES }, club: { status: "APPROVED" }, user: { status: "ACTIVE" } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    db.task.findMany({ where: { sourceType: "requirement", status: "OPEN" }, select: { assigneeId: true }, distinct: ["assigneeId"] }),
  ]);
  return [...new Set([...holders.map((h) => h.userId), ...open.map((t) => t.assigneeId).filter((id): id is string => Boolean(id))])];
}

/** Scheduled job + admin changes: re-check every holder (renewals, new requirements, ended roles). */
export async function syncAllRequirementHolders(opts: { notify?: NotifyMode; now?: Date } = {}): Promise<{ people: number; opened: number }> {
  const ids = await requirementHolderIds();
  let opened = 0;
  for (const id of ids) opened += (await syncUserRequirements(id, opts)).opened.length;
  return { people: ids.length, opened };
}

/**
 * Tells people once when a requirement deadline passes and their leadership
 * permissions pause. Idempotent: skips anyone already told about that task.
 */
export async function notifyOverdueRequirements(now: Date = new Date()): Promise<{ notified: number }> {
  const overdue = await db.task.findMany({
    where: { sourceType: "requirement", status: "OPEN", dueAt: { lt: now }, assigneeId: { not: null } },
    select: { id: true, assigneeId: true, title: true, href: true, createdAt: true, dueAt: true },
  });
  let notified = 0;
  for (const t of overdue) {
    const already = await db.notification.count({ where: { userId: t.assigneeId!, kind: "requirement.overdue", href: t.href, createdAt: { gte: t.dueAt ?? t.createdAt } } });
    if (already) continue;
    await notify({
      userIds: [t.assigneeId!],
      kind: "requirement.overdue",
      title: "Your leadership permissions are paused",
      body: `${t.title.replace(/^(Pass|Attend): /, "")} is overdue. Your title stays; your permissions come back as soon as it's done.`,
      href: t.href ?? "/tasks",
    });
    notified++;
  }
  return { notified };
}

// ─── Admin: Officer requirements (/admin/requirements) ───────────────────────

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
    appliesTo: z.array(z.enum(["AMBASSADOR", "OFFICER", "VP", "PRESIDENT"])).min(1, "Choose at least one role this applies to."),
    renewal: z.enum(["NONE", "SEMESTER", "ACADEMIC_YEAR", "ANNUAL"]),
    graceDays: z.coerce.number({ error: "Enter the number of days." }).int("Use whole days.").min(0, "Grace days can't be negative.").max(365, "Grace periods can be up to 365 days."),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "TEST" && !v.testId) ctx.addIssue({ code: "custom", path: ["testId"], message: "Choose the test officers must pass." });
    if (v.kind === "TRAINING" && !v.trainingEventId) ctx.addIssue({ code: "custom", path: ["trainingEventId"], message: "Choose the training officers must attend." });
  });

export type RequirementInput = z.input<typeof RequirementInput>;

/** Create (id null) or edit an officer requirement. Holders' tasks catch up via syncAllRequirementHolders (the action runs it after responding). */
export async function saveRequirement(actor: Actor | null, id: string | null, input: unknown): Promise<{ id: string }> {
  assertRequirementAdmin(actor);
  const v = parse(RequirementInput, input);
  if (v.kind === "TEST") {
    const test = await db.test.findUnique({ where: { id: v.testId! }, select: { clubId: true, status: true, audience: true } });
    if (!test || test.clubId !== null) throw invalid("Choose a university test (club tests can't be officer requirements).");
    if (test.status !== "PUBLISHED") throw invalid("That test isn't published yet. Publish it in Admin → Tests first.");
    if (test.audience !== "ROLE_REQUIREMENT") throw invalid("Set that test's audience to “Student leaders (officer requirement)” first, so it isn't also assigned to everyone else.");
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
    if (!t) throw invalid("Its test was deleted, so it can't be turned on. Edit it to choose a test first.");
    if (t.status !== "PUBLISHED") throw invalid("Its test isn't published, so it can't be turned on. Publish the test first.");
    // While the requirement was off, the test's audience was free to change.
    if (t.audience !== "ROLE_REQUIREMENT") throw invalid("Set its test's audience back to “Student leaders (officer requirement)” first, so it isn't also assigned to everyone else.");
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
      test: { select: { id: true, title: true, status: true, audience: true } },
      trainingEvent: { select: { id: true, title: true, status: true, _count: { select: { occurrences: true } } } },
    },
  });
}

/** What a requirement can point at: published university tests and scheduled university events (trainings first). */
export async function requirementTargets() {
  const [tests, events] = await Promise.all([
    db.test.findMany({ where: { clubId: null, status: { not: "ARCHIVED" } }, orderBy: { title: "asc" }, select: { id: true, title: true, status: true, audience: true } }),
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
 * Every current student leader of an approved club, one row per person per
 * club (their highest role there — exactly what getClubAccess checks), with
 * each requirement's status from requirementStatus. Read-only.
 */
export async function requirementCompliance(now: Date = new Date()): Promise<ComplianceRow[]> {
  const assignments = await db.roleAssignment.findMany({
    where: { endedAt: null, role: { in: REQUIREMENT_ROLES }, club: { status: "APPROVED" }, user: { status: "ACTIVE" } },
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
