import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { DomainError, assertSignedIn, parse } from "@/lib/domain/kit";
import { decideCohost } from "@/lib/domain/events";
import { decideMembership } from "@/lib/domain/memberships";
import { countOpenTasks, listTasks, setTaskDone, type TaskRow } from "@/lib/domain/tasks";
import { INSTITUTION } from "@/lib/institution";
import { decisionMessage, toMTask } from "./tasks-map";
import type { MDecisionResponse, MTaskDecision, MTaskDoneResponse, MTasks } from "../_types";

/**
 * Tasks on the phone: the web's Tasks list (lib/domain/tasks listTasks, same
 * scope and order), plus deciding join requests and co-host invitations in
 * place. Every decision goes through its domain function, which checks the
 * permission (roster for join requests, events for co-hosting), closes the
 * task for everyone and tells the people involved.
 */

/** The web's Tasks page shows this many open tasks too. */
const LIMIT = 300;

/** The sources lib/domain/memberships (joinClub) and lib/domain/events (co-host invitations) give their approval tasks. */
const JOIN_SOURCE = "membership";
const COHOST_SOURCE = "cohost";

export async function tasksView(actor: Actor | null): Promise<MTasks> {
  assertSignedIn(actor);
  const now = new Date();
  const rows = await listTasks(actor, { status: "OPEN", take: LIMIT + 1 });
  const shown = rows.slice(0, LIMIT);
  const decisions = await decisionsFor(shown);
  return { items: shown.map((t) => toMTask(t, actor.id, now, decisions.get(t.id) ?? null)), more: rows.length > LIMIT };
}

/** Join requests and co-host invitations still waiting, by task id. Anything already decided gets no buttons. */
async function decisionsFor(rows: TaskRow[]): Promise<Map<string, MTaskDecision>> {
  const approvals = rows.filter((t) => t.kind === "APPROVAL" && t.sourceId);
  const joinIds = approvals.filter((t) => t.sourceType === JOIN_SOURCE).map((t) => t.sourceId!);
  const cohostIds = approvals.filter((t) => t.sourceType === COHOST_SOURCE).map((t) => t.sourceId!);
  const [joins, cohosts] = await Promise.all([
    joinIds.length
      ? db.membership.findMany({ where: { id: { in: joinIds }, status: "PENDING" }, select: { id: true, user: { select: { name: true } }, club: { select: { name: true } } } })
      : [],
    cohostIds.length
      ? db.eventCohost.findMany({
          where: { id: { in: cohostIds }, status: "PENDING" },
          select: { id: true, club: { select: { name: true } }, event: { select: { title: true, club: { select: { name: true } } } } },
        })
      : [],
  ]);
  const joinById = new Map(joins.map((m) => [m.id, m]));
  const cohostById = new Map(cohosts.map((c) => [c.id, c]));
  const out = new Map<string, MTaskDecision>();
  for (const t of approvals) {
    const m = t.sourceType === JOIN_SOURCE ? joinById.get(t.sourceId!) : undefined;
    if (m) out.set(t.id, { kind: "JOIN", id: m.id, personName: m.user.name, clubName: m.club.name });
    const c = t.sourceType === COHOST_SOURCE ? cohostById.get(t.sourceId!) : undefined;
    if (c) out.set(t.id, { kind: "COHOST", id: c.id, eventTitle: c.event.title, hostName: c.event.club?.name ?? INSTITUTION.name, clubName: c.club.name });
  }
  return out;
}

/** "approve" | "decline" from the URL; anything else is a 404. */
export function decisionAction(action: string): boolean {
  if (action === "approve") return true;
  if (action === "decline") return false;
  throw new DomainError("NOT_FOUND", "That isn't something the app can do with a request.");
}

/** Approve or decline a join request: lib/domain/memberships decideMembership (needs the roster permission). */
export async function decideJoinRequest(actor: Actor | null, membershipId: string, approve: boolean): Promise<MDecisionResponse> {
  assertSignedIn(actor);
  const m = await decideMembership(actor, membershipId, approve);
  const row = await db.membership.findUnique({ where: { id: m.id }, select: { user: { select: { name: true } }, club: { select: { name: true } } } });
  const message = decisionMessage({ kind: "JOIN", id: m.id, personName: row?.user.name ?? "They", clubName: row?.club.name ?? "the club" }, approve);
  return { status: approve ? "APPROVED" : "DECLINED", message, openTasks: await countOpenTasks(actor) };
}

/** Accept or decline a co-host invitation: lib/domain/events decideCohost (needs the events permission in the invited club). */
export async function decideCohostRequest(actor: Actor | null, cohostId: string, approve: boolean): Promise<MDecisionResponse> {
  assertSignedIn(actor);
  const before = await db.eventCohost.findUnique({ where: { id: cohostId }, select: { status: true } });
  const c = await decideCohost(actor, cohostId, approve);
  const row = await db.eventCohost.findUnique({ where: { id: c.id }, select: { club: { select: { name: true } }, event: { select: { title: true, club: { select: { name: true } } } } } });
  const message = decisionMessage(
    { kind: "COHOST", id: c.id, eventTitle: row?.event.title ?? "the event", hostName: row?.event.club?.name ?? INSTITUTION.name, clubName: row?.club.name ?? "Your club" },
    approve,
    { leaving: before?.status === "APPROVED" && !approve },
  );
  return { status: approve ? "APPROVED" : "DECLINED", message, openTasks: await countOpenTasks(actor) };
}

/** Check off (or reopen) a personal or club to-do: lib/domain/tasks setTaskDone, which refuses tasks that close on their own. */
export async function setTaskDoneView(actor: Actor | null, taskId: string, input: unknown): Promise<MTaskDoneResponse> {
  assertSignedIn(actor);
  const { done } = parse(z.object({ done: z.boolean({ error: "Say whether the task is done." }) }), input);
  await setTaskDone(actor, taskId, done);
  return { done, openTasks: await countOpenTasks(actor) };
}
