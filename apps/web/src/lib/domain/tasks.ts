import "server-only";
import type { Prisma, TaskKind } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { isAdmin, type Capability } from "@/lib/authz";
import { clubsWhereUserHolds } from "@/lib/authz/people";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, forbidden, notFound, parse } from "@/lib/domain/kit";

/**
 * Tasks — the single "ball in your court" inbox. Approvals, requirements,
 * invoices, club assignments and personal to-dos all live here, so nobody has
 * to check five places to know what's waiting on them.
 *
 * System tasks carry a source (sourceType + sourceId). When the underlying
 * thing is decided anywhere, the deciding domain function calls resolveTasks()
 * and the task closes for everyone it was assigned to.
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
};

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
  const caps: Capability[] = ["profile", "roster", "orgchart", "events", "attendance", "budget", "files", "announcements", "elections", "constitution", "tests"];
  const clubCaps = await Promise.all(caps.map(async (cap) => ({ cap, clubIds: await clubsWhereUserHolds(actor.id, cap) })));
  const or: Prisma.TaskWhereInput[] = [{ assigneeType: "USER", assigneeId: actor.id }];
  if (isAdmin(actor)) or.push({ assigneeType: "ADMINS" });
  for (const { cap, clubIds } of clubCaps) if (clubIds.length) or.push({ assigneeType: "CLUB", capability: cap, clubId: { in: clubIds } });
  return { OR: or };
}

export async function listTasks(actor: Actor | null, opts: { status?: "OPEN" | "DONE"; take?: number } = {}) {
  assertSignedIn(actor);
  return db.task.findMany({
    where: { AND: [await taskScopeFor(actor), { status: opts.status ?? "OPEN" }] },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: opts.take ?? 100,
    include: { club: { select: { name: true, slug: true, logoColor: true } } },
  });
}

export async function countOpenTasks(actor: Actor) {
  return db.task.count({ where: { AND: [await taskScopeFor(actor), { status: "OPEN" }] } });
}

const PersonalTask = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueAt: z.coerce.date().optional().nullable(),
});

/** Task Manager: a to-do you write for yourself. */
export async function addPersonalTask(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const t = parse(PersonalTask, input);
  const task = await createTask({ kind: "PERSONAL", title: t.title, description: t.description, dueAt: t.dueAt, assignee: { type: "USER", userId: actor.id }, createdById: actor.id });
  return task;
}

/** Mark a task done/undone. Approval-type tasks close themselves when decided, so only manual kinds can be checked off. */
export async function setTaskDone(actor: Actor | null, taskId: string, done: boolean) {
  assertSignedIn(actor);
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw notFound("Task");
  const visible = await db.task.count({ where: { AND: [{ id: taskId }, await taskScopeFor(actor)] } });
  if (!visible) throw forbidden();
  if (task.kind === "APPROVAL" || task.kind === "REQUIREMENT" || task.kind === "INVOICE")
    throw forbidden("This task closes on its own once it's decided or completed — open it to act on it.");
  const updated = await db.task.update({
    where: { id: taskId },
    data: done ? { status: "DONE", completedAt: new Date(), completedById: actor.id } : { status: "OPEN", completedAt: null, completedById: null },
  });
  await logActivity({ actorId: actor.id, action: done ? "task.completed" : "task.reopened", entityType: "task", entityId: taskId, clubId: task.clubId });
  return updated;
}

export async function deletePersonalTask(actor: Actor | null, taskId: string) {
  assertSignedIn(actor);
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw notFound("Task");
  if (task.kind !== "PERSONAL" || task.assigneeId !== actor.id) throw forbidden();
  await db.task.update({ where: { id: taskId }, data: { status: "CANCELLED" } });
}
