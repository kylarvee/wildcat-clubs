import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { assertSignedIn, notFound, parse } from "@/lib/domain/kit";
import type { ActionCard, ActionStatus, ConversationSummary, NoticeTone } from "@/lib/ai/types";

/**
 * The assistant's conversation store (AiConversation / AiMessage) — the write
 * path for these two tables, private to their owner.
 *
 * Rows with role user / assistant / system are Anthropic messages, stored
 * verbatim and only ever appended, so prompt caching and thinking blocks stay
 * valid on the next request. Three more row kinds are our own bookkeeping and
 * are never sent to the model:
 *   tools    labels for the "Looked up Wildcat Robotics" chips of one tool round
 *   actions  a round that includes write tools waiting for Confirm / Cancel
 *   notice   an error, refusal or limit message shown in the chat
 *
 * Chat text isn't written to the activity log: it's private, and every action
 * the assistant takes is logged by the domain function it calls.
 */

export type RowRole = "user" | "assistant" | "system" | "tools" | "actions" | "notice";

export type StoredRow = {
  id: string;
  role: RowRole;
  content: Prisma.JsonValue;
  model: string | null;
  createdAt: Date;
};

export type ChipRecord = { id: string; name: string; label: string; ok: boolean };
export type ToolsContent = { items: ChipRecord[] };

export type ActionRecord = {
  id: string;
  name: string;
  input: unknown;
  card: ActionCard;
  /** See Prepared.fingerprint in lib/ai/tool-kit. */
  fingerprint: string | null;
  status: ActionStatus | "running";
  outcome: string | null;
  href: string | null;
  /** Set once decided: what the model reads back. */
  result: Anthropic.ToolResultBlockParam | null;
};

export type ActionsContent = {
  /** tool_use ids of the round, in the order the model wrote them. */
  order: string[];
  /** Results of the round's other calls (lookups), held until every action is decided. */
  results: Anthropic.ToolResultBlockParam[];
  actions: ActionRecord[];
};

export type NoticeContent = { tone: NoticeTone; text: string; retry: boolean; retryLabel?: string };

export const DEFAULT_TITLE = "New conversation";
const TITLE_MAX = 80;

const rowSelect = { id: true, role: true, content: true, model: true, createdAt: true } satisfies Prisma.AiMessageSelect;

const asRow = (r: Prisma.AiMessageGetPayload<{ select: typeof rowSelect }>): StoredRow => ({ ...r, role: r.role as RowRole });

const Id = z.string().min(1).max(64);

/** A conversation and its rows, in order, held in memory while a turn runs. */
export class Thread {
  private lastAt: number;

  constructor(
    public readonly id: string,
    public title: string,
    public readonly userId: string,
    public readonly rows: StoredRow[],
  ) {
    this.lastAt = rows.length ? rows[rows.length - 1].createdAt.getTime() : 0;
  }

  /** Appends rows with strictly increasing timestamps, so their order never depends on the clock's resolution. */
  async append(items: { role: RowRole; content: unknown; model?: string | null; inputTokens?: number | null; outputTokens?: number | null }[]): Promise<StoredRow[]> {
    const created: StoredRow[] = [];
    for (const item of items) {
      this.lastAt = Math.max(Date.now(), this.lastAt + 1);
      const row = await db.aiMessage.create({
        data: {
          conversationId: this.id,
          role: item.role,
          content: item.content as Prisma.InputJsonValue,
          model: item.model ?? null,
          inputTokens: item.inputTokens ?? null,
          outputTokens: item.outputTokens ?? null,
          createdAt: new Date(this.lastAt),
        },
        select: rowSelect,
      });
      created.push(asRow(row));
    }
    this.rows.push(...created);
    await db.aiConversation.update({ where: { id: this.id }, data: { updatedAt: new Date() } });
    return created;
  }

  async setTitle(title: string) {
    this.title = title;
    await db.aiConversation.update({ where: { id: this.id }, data: { title } });
  }

  /** Replaces an internal row's content (actions are decided one at a time). */
  async updateRow(rowId: string, content: unknown) {
    await db.aiMessage.update({ where: { id: rowId }, data: { content: content as Prisma.InputJsonValue } });
    const row = this.rows.find((r) => r.id === rowId);
    if (row) row.content = content as Prisma.JsonValue;
  }

  /** The latest action round, if it still has actions waiting. */
  pendingActions(): { row: StoredRow; content: ActionsContent } | null {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      if (r.role === "user" || r.role === "assistant") return null;
      if (r.role === "actions") {
        const content = r.content as unknown as ActionsContent;
        return content.actions.some((a) => a.status === "pending" || a.status === "running") ? { row: r, content } : null;
      }
    }
    return null;
  }

  /** The last row the model sees (user, assistant or system). */
  lastApiRow(): StoredRow | null {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      if (r.role === "user" || r.role === "assistant" || r.role === "system") return r;
    }
    return null;
  }

  /**
   * The newest context note the model actually read (one followed by an
   * answer), so a fresh note is appended only when it changed — or when the
   * last one was dropped because its request failed.
   */
  lastAnsweredNote(): string | null {
    let answered = false;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      if (r.role === "assistant") answered = true;
      else if (r.role === "user") answered = false;
      else if (r.role === "system") return answered ? (r.content as string) : null;
    }
    return null;
  }

  /** The model that wrote the latest answer (continuations after Confirm stay on it). */
  lastModel(): string | null {
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].role === "assistant" && this.rows[i].model) return this.rows[i].model;
    return null;
  }
}

export async function createThread(actor: Actor): Promise<Thread> {
  const c = await db.aiConversation.create({ data: { userId: actor.id, title: DEFAULT_TITLE }, select: { id: true, title: true } });
  return new Thread(c.id, c.title, actor.id, []);
}

/** Loads a conversation the actor owns. Someone else's looks exactly like a missing one. */
export async function loadThread(actor: Actor | null, conversationId: string): Promise<Thread> {
  assertSignedIn(actor);
  const id = parse(Id, conversationId);
  const c = await db.aiConversation.findUnique({
    where: { id },
    select: { id: true, title: true, userId: true, messages: { select: rowSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!c || c.userId !== actor.id) throw notFound("Conversation");
  return new Thread(c.id, c.title, c.userId, c.messages.map(asRow));
}

export async function listConversations(actor: Actor | null, take = 50): Promise<ConversationSummary[]> {
  assertSignedIn(actor);
  const rows = await db.aiConversation.findMany({
    where: { userId: actor.id, messages: { some: {} } },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }));
}

export async function deleteConversation(actor: Actor | null, conversationId: string): Promise<void> {
  assertSignedIn(actor);
  const id = parse(Id, conversationId);
  const { count } = await db.aiConversation.deleteMany({ where: { id, userId: actor.id } });
  if (!count) throw notFound("Conversation");
}

/** A short title from the first message. */
export function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= TITLE_MAX) return t || DEFAULT_TITLE;
  const cut = t.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > 40 ? cut.slice(0, space) : cut}…`;
}

/**
 * Claims one waiting action (pending → running) under a row lock, so a double
 * click or a second tab can't run it twice. Returns the round, or null when
 * the action was already handled.
 */
export async function claimAction(thread: Thread, toolUseId: string): Promise<{ row: StoredRow; content: ActionsContent } | null> {
  const claimed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "AiMessage"
      WHERE "conversationId" = ${thread.id} AND role = 'actions'
      ORDER BY "createdAt" DESC, id DESC
      LIMIT 1
      FOR UPDATE`;
    if (!rows.length) return null;
    const row = await tx.aiMessage.findUnique({ where: { id: rows[0].id }, select: rowSelect });
    if (!row) return null;
    const content = row.content as unknown as ActionsContent;
    const action = content.actions.find((a) => a.id === toolUseId);
    if (!action || action.status !== "pending") return null;
    action.status = "running";
    await tx.aiMessage.update({ where: { id: row.id }, data: { content: content as unknown as Prisma.InputJsonValue } });
    return { row: asRow({ ...row, content: content as unknown as Prisma.JsonValue }), content };
  });
  if (claimed) {
    const local = thread.rows.find((r) => r.id === claimed.row.id);
    if (local) local.content = claimed.row.content;
  }
  return claimed;
}

/** Model calls (assistant rows) this person made in the last hour, for the usage limit. */
export async function modelCallsSince(userId: string, since: Date): Promise<number> {
  return db.aiMessage.count({ where: { role: "assistant", createdAt: { gte: since }, conversation: { userId } } });
}

/**
 * The rows the model sees, as API messages. A context note whose request never
 * got an answer (the next message is the person's again) is left out: a
 * mid-conversation system message must be followed by an answer or be last.
 * The rule is deterministic, so every request rebuilds the same prefix.
 */
export function apiMessages(rows: StoredRow[]): Anthropic.MessageParam[] {
  const api = rows.filter((r) => r.role === "user" || r.role === "assistant" || r.role === "system");
  const out: Anthropic.MessageParam[] = [];
  for (let i = 0; i < api.length; i++) {
    const r = api[i];
    if (r.role === "system") {
      const next = api[i + 1];
      if (next && next.role !== "assistant") continue;
      if (out[out.length - 1]?.role !== "user") continue;
      out.push({ role: "system", content: r.content as string });
      continue;
    }
    out.push({ role: r.role as "user" | "assistant", content: r.content as unknown as Anthropic.ContentBlockParam[] });
  }
  return out;
}
