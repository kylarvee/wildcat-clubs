import "server-only";
import type { Prisma, TaskKind } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { ALL_CAPABILITIES, CAPABILITIES, getClubAccess, isAdmin, ROLE_LABEL, ROLE_RANK, type Capability } from "@/lib/authz";
import { capabilitiesByClub, clubCapabilityHolders } from "@/lib/authz/people";
import { logActivity } from "@/lib/lake/activity";
import { notify } from "@/lib/domain/notify";
import { assertSignedIn, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { campusDate } from "@/lib/time";

/**
 * Tasks — the single "ball in your court" inbox. Approvals, requirements,
 * invoices, club assignments and personal to-dos all live here, so nobody has
 * to check five places to know what's waiting on them.
 *
 * System tasks carry a source (sourceType + sourceId). When the underlying
 * thing is decided anywhere, the deciding domain function calls resolveTasks()
 * and the task closes for everyone it was assigned to.
 *
 * People close only the kinds they own (PERSONAL, CLUB). APPROVAL,
 * REQUIREMENT and INVOICE tasks close themselves when the thing is done.
 *
 * Required tasks are the ones WSUSA requires (officer and member
 * requirements, WSUSA-assigned tests and forms). The creating domain function
 * sets `required`; every list puts them first and marks them Required.
 */

export type TaskAssignee =
  | { type: "USER"; userId: string }
  | { type: "ADMINS" }
  | { type: "CLUB"; clubId: string; capability: Capability };

export type NewTask = {
  kind: TaskKind;
  title: string;
  description?: string;
  assignee: TaskAssignee;
  href?: string;
  dueAt?: Date | null;
  clubId?: string | null;
  source?: { type: string; id: string };
  createdById?: string | null;
  /** WSUSA requires it (see the module comment). */
  required?: boolean;
};

/** Kinds that close on their own once the underlying thing is decided or done. */
export const SELF_CLOSING_KINDS: TaskKind[] = ["APPROVAL", "REQUIREMENT", "INVOICE"];
export const TASK_KINDS: TaskKind[] = ["APPROVAL", "REQUIREMENT", "INVOICE", "CLUB", "PERSONAL"];

export async function createTask(t: NewTask, tx: Tx = db) {
  return tx.task.create({
    data: {
      kind: t.kind,
      title: t.title,
      description: t.description,
      assigneeType: t.assignee.type,
      assigneeId: t.assignee.type === "USER" ? t.assignee.userId : null,
      clubId: t.assignee.type === "CLUB" ? t.assignee.clubId : (t.clubId ?? null),
      capability: t.assignee.type === "CLUB" ? t.assignee.capability : null,
      href: t.href,
      dueAt: t.dueAt ?? null,
      required: t.required ?? false,
      sourceType: t.source?.type,
      sourceId: t.source?.id,
      createdById: t.createdById ?? null,
    },
  });
}

/** Close every open task about a source (called when the thing is decided). */
export async function resolveTasks(sourceType: string, sourceId: string, completedById: string | null, tx: Tx = db, status: "DONE" | "CANCELLED" = "DONE") {
  await tx.task.updateMany({
    where: { sourceType, sourceId, status: "OPEN" },
    data: { status, completedAt: new Date(), completedById },
  });
}

/** Where clause for every task visible to this person. */
export async function taskScopeFor(actor: Actor): Promise<Prisma.TaskWhereInput> {
  // The capabilities the person's roles give them per club, once (the shared
  // authz/people rule, so paused officers and founding clubs match getClubAccess).
  const clubs = await capabilitiesByClub(actor.id);
  const or: Prisma.TaskWhereInput[] = [{ assigneeType: "USER", assigneeId: actor.id }];
  if (isAdmin(actor)) or.push({ assigneeType: "ADMINS" });
  for (const cap of ALL_CAPABILITIES) {
    const clubIds = clubs.filter(([, caps]) => caps.has(cap)).map(([clubId]) => clubId);
    if (clubIds.length) or.push({ assigneeType: "CLUB", capability: cap, clubId: { in: clubIds } });
  }
  return { OR: or };
}

const taskInclude = {
  club: { select: { name: true, slug: true, logoColor: true, logoUrl: true } },
  createdBy: { select: { name: true, handle: true } },
  completedBy: { select: { name: true } },
  assignee: { select: { name: true, handle: true } },
} satisfies Prisma.TaskInclude;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export type ListTasksOpts = {
  status?: "OPEN" | "DONE";
  take?: number;
  /** Only these kinds. */
  kind?: TaskKind | TaskKind[];
  /** Only tasks about this club. */
  clubId?: string;
};

/**
 * Your inbox. Open tasks come required first, then soonest-due (undated
 * last); done tasks come most recently finished first.
 */
export async function listTasks(actor: Actor | null, opts: ListTasksOpts = {}): Promise<TaskRow[]> {
  assertSignedIn(actor);
  const status = opts.status ?? "OPEN";
  const kinds = opts.kind ? (Array.isArray(opts.kind) ? opts.kind : [opts.kind]) : null;
  const filters: Prisma.TaskWhereInput[] = [await taskScopeFor(actor), { status }];
  if (kinds?.length) filters.push({ kind: { in: kinds } });
  if (opts.clubId) filters.push({ clubId: opts.clubId });
  return db.task.findMany({
    where: { AND: filters },
    orderBy:
      status === "OPEN"
        ? [{ required: "desc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }]
        : [{ completedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: opts.take ?? 100,
    include: taskInclude,
  });
}

export async function countOpenTasks(actor: Actor) {
  return db.task.count({ where: { AND: [await taskScopeFor(actor), { status: "OPEN" }] } });
}

/** Open tasks in your inbox, counted by kind (for tabs, filters and dashboard badges). */
export async function countOpenTasksByKind(actor: Actor | null): Promise<Record<TaskKind, number>> {
  assertSignedIn(actor);
  const rows = await db.task.groupBy({ by: ["kind"], where: { AND: [await taskScopeFor(actor), { status: "OPEN" }] }, _count: { _all: true } });
  const out = Object.fromEntries(TASK_KINDS.map((k) => [k, 0])) as Record<TaskKind, number>;
  for (const r of rows) out[r.kind] = r._count._all;
  return out;
}

// ─── Personal to-dos ─────────────────────────────────────────────────────────

/**
 * Due dates: a date-only value ("2026-10-20", from a date input) means the end
 * of that day on campus, so a task due "today" isn't overdue at 9 a.m.
 */
const DueAt = z.preprocess((v) => {
  if (v === "" || v === undefined) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return campusDate(y, m, d, 23, 59);
  }
  return v;
}, z.coerce.date().nullable().optional());

const Title = z.string().trim().min(1, "Give the task a title.").max(200, "Titles can be up to 200 characters.");
const Notes = z.string().trim().max(2000, "Notes can be up to 2,000 characters.");

const PersonalTask = z.object({
  title: Title,
  description: Notes.optional().nullable(),
  dueAt: DueAt,
});

/** Task Manager: a to-do you write for yourself. */
export async function addPersonalTask(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const t = parse(PersonalTask, input);
  const task = await createTask({ kind: "PERSONAL", title: t.title, description: t.description || undefined, dueAt: t.dueAt, assignee: { type: "USER", userId: actor.id }, createdById: actor.id });
  await logActivity({ actorId: actor.id, action: "task.created", entityType: "task", entityId: task.id });
  return task;
}

/** Edit one of your own to-dos (title, notes, due date). */
export async function updatePersonalTask(actor: Actor | null, taskId: string, input: unknown) {
  assertSignedIn(actor);
  const t = parse(PersonalTask, input);
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.status === "CANCELLED") throw notFound("Task");
  if (task.kind !== "PERSONAL" || task.assigneeId !== actor.id) throw forbidden("Only your own to-dos can be edited here.");
  const updated = await db.task.update({ where: { id: taskId }, data: { title: t.title, description: t.description || null, dueAt: t.dueAt ?? null } });
  await logActivity({ actorId: actor.id, action: "task.updated", entityType: "task", entityId: taskId });
  return updated;
}

/** Mark a task done/undone. Approval-type tasks close themselves when decided, so only manual kinds can be checked off. */
export async function setTaskDone(actor: Actor | null, taskId: string, done: boolean) {
  assertSignedIn(actor);
  const task = await db.task.findUnique({ where: { id: taskId }, include: { club: { select: { name: true } } } });
  if (!task || task.status === "CANCELLED") throw notFound("Task");
  const visible = await db.task.count({ where: { AND: [{ id: taskId }, await taskScopeFor(actor)] } });
  if (!visible) throw forbidden();
  if (SELF_CLOSING_KINDS.includes(task.kind))
    throw forbidden("This task closes on its own once it's decided or completed — open it to act on it.");
  const updated = await db.task.update({
    where: { id: taskId },
    data: done ? { status: "DONE", completedAt: new Date(), completedById: actor.id } : { status: "OPEN", completedAt: null, completedById: null },
  });
  await logActivity({ actorId: actor.id, action: done ? "task.completed" : "task.reopened", entityType: "task", entityId: taskId, clubId: task.clubId });
  // Let the leader who assigned a club task know it's done (in-app only).
  if (done && task.kind === "CLUB" && task.createdById && task.createdById !== actor.id && task.status !== "DONE") {
    await notify({
      userIds: [task.createdById],
      kind: "task.completed",
      title: `${actor.name} finished “${task.title}”`,
      body: task.club ? `A task you assigned in ${task.club.name}.` : undefined,
      href: "/tasks?view=assigned",
      email: false,
      push: false,
    });
  }
  return updated;
}

export async function deletePersonalTask(actor: Actor | null, taskId: string) {
  assertSignedIn(actor);
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw notFound("Task");
  if (task.kind !== "PERSONAL" || task.assigneeId !== actor.id) throw forbidden();
  await db.task.update({ where: { id: taskId }, data: { status: "CANCELLED" } });
  await logActivity({ actorId: actor.id, action: "task.deleted", entityType: "task", entityId: taskId });
}

// ─── Club tasks leaders assign ───────────────────────────────────────────────

/** Leadership that may assign club tasks: any active leader role whose permissions aren't paused. */
async function assertCanAssign(actor: Actor, clubId: string) {
  const access = await getClubAccess(actor, clubId);
  if (!access) throw notFound("Club");
  if (access.clubStatus === "RETIRED" || access.clubStatus === "REJECTED") throw forbidden("This club is read-only.");
  if (!access.isLeader) throw forbidden("Only club leaders can assign tasks.");
  if (access.suspended) throw forbidden("Your leadership permissions are paused until you finish your required training or test.");
  return access;
}

export type AssignableClub = { id: string; name: string; slug: string; logoColor: string; logoUrl: string | null; roleLabel: string };

/** Clubs where you hold a leadership role you can assign tasks from right now. */
export async function clubsYouCanAssignIn(actor: Actor | null): Promise<AssignableClub[]> {
  assertSignedIn(actor);
  const roles = await db.roleAssignment.findMany({
    where: { userId: actor.id, endedAt: null, role: { not: "MEMBER" }, club: { status: { notIn: ["RETIRED", "REJECTED"] } } },
    include: { club: { select: { id: true, name: true, slug: true, logoColor: true, logoUrl: true } }, position: { select: { name: true } } },
    orderBy: { club: { name: "asc" } },
  });
  const out = new Map<string, AssignableClub>();
  // Highest role first, so the label shows the seat that grants the most.
  for (const r of [...roles].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])) {
    if (out.has(r.clubId)) continue;
    const access = await getClubAccess(actor, r.clubId);
    if (!access?.isLeader || access.suspended) continue;
    out.set(r.clubId, { ...r.club, roleLabel: r.position?.name ?? ROLE_LABEL[r.role] });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type AssignablePerson = { id: string; name: string; handle: string; avatarUrl: string | null; avatarColor: string; seats: string[] };

/** Active members (and current leaders) of a club you lead, for the assign picker. */
export async function assignableMembers(actor: Actor | null, clubId: string): Promise<AssignablePerson[]> {
  assertSignedIn(actor);
  await assertCanAssign(actor, clubId);
  const personSelect = { id: true, name: true, handle: true, avatarUrl: true, avatarColor: true } as const;
  const [members, roles] = await Promise.all([
    db.membership.findMany({ where: { clubId, status: "ACTIVE", user: { status: "ACTIVE" } }, select: { user: { select: personSelect } } }),
    db.roleAssignment.findMany({ where: { clubId, endedAt: null, user: { status: "ACTIVE" } }, select: { userId: true, role: true, position: { select: { name: true } }, user: { select: personSelect } } }),
  ]);
  const people = new Map<string, AssignablePerson>();
  for (const m of members) people.set(m.user.id, { ...m.user, seats: [] });
  for (const r of roles) {
    const p = people.get(r.userId) ?? { ...r.user, seats: [] };
    if (r.role !== "MEMBER") p.seats.push(r.position?.name ?? ROLE_LABEL[r.role]);
    people.set(r.userId, p);
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const AssignInput = z.object({
  clubId: z.string().min(1, "Choose a club."),
  assignee: z.union([
    z.string().min(1, "Choose who should do it."),
    z.object({ capability: z.enum(Object.keys(CAPABILITIES) as [Capability, ...Capability[]]) }),
  ]),
  title: Title,
  description: Notes.optional().nullable(),
  dueAt: DueAt,
});

/**
 * A leader hands a club to-do to a member — or to everyone in the club who
 * holds a capability (say, all budget officers). The assignee hears about it
 * and can check it off; the leader hears when it's done.
 */
export async function assignClubTask(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const v = parse(AssignInput, input);
  await assertCanAssign(actor, v.clubId);
  const club = await db.club.findUnique({ where: { id: v.clubId }, select: { id: true, name: true, slug: true } });
  if (!club) throw notFound("Club");

  let recipients: string[];
  let assignee: TaskAssignee;
  let assigneeLabel: string;
  if (typeof v.assignee === "string") {
    const userId = v.assignee;
    const [membership, role, user] = await Promise.all([
      db.membership.findUnique({ where: { userId_clubId: { userId, clubId: club.id } }, select: { status: true } }),
      db.roleAssignment.findFirst({ where: { userId, clubId: club.id, endedAt: null }, select: { id: true } }),
      db.user.findUnique({ where: { id: userId }, select: { name: true, status: true } }),
    ]);
    if (!user) throw notFound("Person");
    if (user.status !== "ACTIVE") throw invalid(`${user.name} can't take new tasks — their account isn't active.`);
    if (membership?.status !== "ACTIVE" && !role) throw invalid(`${user.name} isn't an active member of ${club.name}.`);
    assignee = { type: "USER", userId };
    recipients = [userId];
    assigneeLabel = user.name;
  } else {
    const cap = v.assignee.capability;
    recipients = await clubCapabilityHolders(club.id, cap);
    if (!recipients.length) throw invalid(`Nobody in ${club.name} holds ${CAPABILITIES[cap].label} right now.`);
    assignee = { type: "CLUB", clubId: club.id, capability: cap };
    assigneeLabel = `everyone with ${CAPABILITIES[cap].label}`;
  }

  const task = await createTask({
    kind: "CLUB",
    title: v.title,
    description: v.description || undefined,
    assignee,
    clubId: club.id,
    dueAt: v.dueAt ?? null,
    href: "/tasks",
    createdById: actor.id,
  });
  await logActivity({ actorId: actor.id, action: "task.assigned", entityType: "task", entityId: task.id, clubId: club.id, data: { title: task.title, assignee: typeof v.assignee === "string" ? { userId: v.assignee } : v.assignee } });
  await notify({
    userIds: recipients,
    exceptUserId: actor.id,
    kind: "task.assigned",
    title: `${actor.name} assigned you a task in ${club.name}`,
    body: task.title,
    href: "/tasks",
  });
  return { task, assigneeLabel };
}

/** Club tasks you assigned to other people (open or done), newest first. */
export async function listAssignedByYou(actor: Actor | null, opts: { status?: "OPEN" | "DONE"; take?: number } = {}): Promise<TaskRow[]> {
  assertSignedIn(actor);
  return db.task.findMany({
    where: {
      kind: "CLUB",
      createdById: actor.id,
      status: opts.status ?? "OPEN",
      NOT: { assigneeType: "USER", assigneeId: actor.id },
    },
    orderBy: opts.status === "DONE" ? [{ completedAt: { sort: "desc", nulls: "last" } }] : [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: opts.take ?? 100,
    include: taskInclude,
  });
}

/** Withdraw a club task: the leader who assigned it, or any current leader of the club. */
export async function cancelClubTask(actor: Actor | null, taskId: string) {
  assertSignedIn(actor);
  const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true, kind: true, status: true, clubId: true, createdById: true, assigneeId: true, title: true } });
  if (!task || task.kind !== "CLUB" || !task.clubId) throw notFound("Task");
  if (task.status !== "OPEN") throw invalid("Only open tasks can be withdrawn.");
  if (task.createdById !== actor.id) await assertCanAssign(actor, task.clubId);
  await db.task.update({ where: { id: task.id }, data: { status: "CANCELLED", completedAt: new Date(), completedById: actor.id } });
  await logActivity({ actorId: actor.id, action: "task.cancelled", entityType: "task", entityId: task.id, clubId: task.clubId, data: { title: task.title } });
}
