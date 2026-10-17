import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The turn loop end to end, with a scripted Claude and an in-memory store:
 * lookups run and loop, actions stop for Confirm, the history sent to the API
 * stays valid (every tool_use answered, notes placed after a user turn), and
 * confirming continues the turn.
 */

type Row = { id: string; conversationId: string; role: string; content: unknown; model: string | null; createdAt: Date };
/** `calls` is what the hourly-limit count returns. */
const store: { rows: Row[]; n: number; calls: number } = { rows: [], n: 0, calls: 0 };

vi.mock("@/lib/db", () => {
  const pick = (r: Row) => ({ id: r.id, role: r.role, content: structuredClone(r.content), model: r.model, createdAt: r.createdAt });
  return {
    db: {
      aiMessage: {
        create: async ({ data }: { data: Omit<Row, "id"> }) => {
          const row = { ...data, id: `m${++store.n}`, content: structuredClone(data.content) } as Row;
          store.rows.push(row);
          return pick(row);
        },
        update: async ({ where, data }: { where: { id: string }; data: { content: unknown } }) => {
          const row = store.rows.find((r) => r.id === where.id)!;
          row.content = structuredClone(data.content);
          return pick(row);
        },
        findUnique: async ({ where }: { where: { id: string } }) => {
          const row = store.rows.find((r) => r.id === where.id);
          return row ? pick(row) : null;
        },
      },
      aiUsage: { createMany: async () => ({ count: 0 }), count: async () => store.calls },
      aiConversation: { update: async () => ({}) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: async () => {
            const rows = store.rows.filter((r) => r.role === "actions");
            return rows.length ? [{ id: rows[rows.length - 1].id }] : [];
          },
          aiMessage: {
            findUnique: async ({ where }: { where: { id: string } }) => {
              const row = store.rows.find((r) => r.id === where.id);
              return row ? pick(row) : null;
            },
            update: async ({ where, data }: { where: { id: string }; data: { content: unknown } }) => {
              store.rows.find((r) => r.id === where.id)!.content = structuredClone(data.content);
            },
          },
        }),
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/ai/context", () => ({ buildContextNote: async () => "CONTEXT NOTE" }));

const executed: string[] = [];
vi.mock("@/lib/ai/tools", () => {
  const read = { kind: "read", name: "get_club", running: "Looking up the club" };
  const write = { kind: "write", name: "join_club", running: "Preparing to join" };
  const card = { title: "Join Chess Club", details: ["You'll become a member right away."], confirmLabel: "Join club" };
  const find = (n: string) => (n === "get_club" ? read : n === "join_club" ? write : null);
  return {
    API_TOOLS: [],
    findTool: find,
    toolErrorText: () => null,
    validateCall: (name: string, input: unknown) => {
      const tool = find(name);
      return tool ? { ok: true, tool, input } : { ok: false, error: `no tool ${name}` };
    },
    runRead: async () => ({ ok: true, content: JSON.stringify({ name: "Chess Club" }), label: "Looked up Chess Club" }),
    prepareWrite: async () => ({
      ok: true,
      prepared: {
        card,
        execute: async () => {
          executed.push("join_club");
          return { data: { result: "joined" }, outcome: "You're now a member of Chess Club.", href: "/clubs/chess-club" };
        },
      },
    }),
  };
});

import { Thread } from "@/lib/ai/conversations";
import { decideAction, runTurn } from "@/lib/ai/loop";
import { buildView } from "@/lib/ai/view";
import type { StreamEvent } from "@/lib/ai/types";

type Msg = { content: unknown[]; stop_reason: string };
function scriptedClient(script: Msg[]) {
  const requests: { messages: { role: string; content: unknown }[]; model: string }[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: { messages: { role: string; content: unknown }[]; model: string }) => {
          requests.push(structuredClone(params));
          const next = script.shift();
          if (!next) throw new Error("script ran out");
          const message = { id: "msg", type: "message", role: "assistant", model: params.model, content: next.content, stop_reason: next.stop_reason, usage: { input_tokens: 10, output_tokens: 5 } };
          return {
            async *[Symbol.asyncIterator]() {
              for (const b of next.content as { type: string; text?: string; id?: string; name?: string }[]) {
                if (b.type === "text") yield { type: "content_block_delta", delta: { type: "text_delta", text: b.text } };
                if (b.type === "tool_use") yield { type: "content_block_start", content_block: b };
              }
            },
            finalMessage: async () => message,
          };
        },
      },
    },
  };
  return { client: client as never, requests };
}

/** Every assistant tool_use must be answered by the next user message, and system notes must follow a user turn. */
function assertValidHistory(messages: { role: string; content: unknown }[]) {
  messages.forEach((m, i) => {
    if (m.role === "system") expect(messages[i - 1]?.role).toBe("user");
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const ids = (m.content as { type: string; id?: string }[]).filter((b) => b.type === "tool_use").map((b) => b.id);
      if (!ids.length) return;
      const next = messages[i + 1];
      const answered = new Set(((next?.content as { type: string; tool_use_id?: string }[]) ?? []).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id));
      for (const id of ids) expect(answered.has(id)).toBe(true);
    }
  });
}

const actor = { id: "u1", email: "sam@mail.weber.edu", name: "Sam Rivera", handle: "sam", kind: "STUDENT", platformRole: "USER", status: "ACTIVE", avatarColor: "#000", avatarUrl: null } as never;

beforeEach(() => {
  store.rows = [];
  store.calls = 0;
  executed.length = 0;
});

describe("runTurn", () => {
  it("runs lookups, stops at an action, and continues after Confirm", async () => {
    const { client, requests } = scriptedClient([
      { content: [{ type: "thinking", thinking: "", signature: "s1" }, { type: "tool_use", id: "t1", name: "get_club", input: { club: "chess" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Chess Club meets Mondays." }, { type: "tool_use", id: "t2", name: "join_club", input: { club: "chess" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "You're in! See you Monday." }], stop_reason: "end_turn" },
    ]);
    const events: StreamEvent[] = [];
    const thread = new Thread("c1", "New conversation", "u1", []);
    await runTurn({ client, actor, thread, mode: { kind: "message", text: "Join the chess club" }, emit: (e) => events.push(e) });

    expect(requests).toHaveLength(2);
    expect(requests[0].messages.map((m) => m.role)).toEqual(["user", "system"]);
    assertValidHistory(requests[1].messages);
    expect(events.some((e) => e.type === "action")).toBe(true);
    expect(executed).toEqual([]);
    expect(thread.title).toBe("Join the chess club");

    let view = buildView(thread);
    expect(view.pending).toBe(1);

    const roundDone = await decideAction({ actor, thread, toolUseId: "t2", approve: true, emit: (e) => events.push(e) });
    expect(roundDone).toBe(true);
    expect(executed).toEqual(["join_club"]);
    await runTurn({ client, actor, thread, mode: { kind: "continue" }, emit: (e) => events.push(e) });
    expect(requests).toHaveLength(3);
    assertValidHistory(requests[2].messages);

    view = buildView(thread);
    expect(view.pending).toBe(0);
    const answer = view.items[1];
    expect(answer.kind).toBe("assistant");
    if (answer.kind === "assistant") {
      expect(answer.parts.map((p) => p.kind)).toEqual(["tool", "text", "action", "text"]);
      const action = answer.parts[2];
      expect(action.kind === "action" && action.status).toBe("approved");
    }
  });

  it("closes skipped actions when the person moves on, and never runs them", async () => {
    const { client, requests } = scriptedClient([
      { content: [{ type: "tool_use", id: "t9", name: "join_club", input: { club: "chess" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "No problem — here's the robotics club instead." }], stop_reason: "end_turn" },
    ]);
    const thread = new Thread("c2", "New conversation", "u1", []);
    await runTurn({ client, actor, thread, mode: { kind: "message", text: "Join chess" }, emit: () => {} });
    await runTurn({ client, actor, thread, mode: { kind: "message", text: "Actually, tell me about robotics" }, emit: () => {} });
    expect(executed).toEqual([]);
    const second = requests[1].messages;
    assertValidHistory(second);
    // The note from the first (answered) turn is still current, so no second copy is added.
    expect(second.filter((m) => m.role === "system")).toHaveLength(1);
    const lastUser = second[second.length - 1];
    expect((lastUser.content as { type: string }[]).map((b) => b.type)).toEqual(["tool_result", "text"]);
  });

  it("turns a refusal into a notice and keeps the history valid", async () => {
    const { client, requests } = scriptedClient([
      { content: [], stop_reason: "refusal" },
      { content: [{ type: "text", text: "Sure — here are some clubs." }], stop_reason: "end_turn" },
    ]);
    const thread = new Thread("c3", "New conversation", "u1", []);
    const events: StreamEvent[] = [];
    await runTurn({ client, actor, thread, mode: { kind: "message", text: "something odd" }, emit: (e) => events.push(e) });
    expect(events.some((e) => e.type === "notice" && e.tone === "refusal")).toBe(true);
    await runTurn({ client, actor, thread, mode: { kind: "message", text: "Find clubs about AI" }, emit: () => {} });
    assertValidHistory(requests[1].messages);
    expect(requests[1].messages.map((m) => m.role)).toEqual(["user", "system", "assistant", "user"]);
  });

  it("runs a confirmed action past the hourly limit but pauses Claude until Try again", async () => {
    const { client, requests } = scriptedClient([
      { content: [{ type: "tool_use", id: "t5", name: "join_club", input: { club: "chess" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "You're in." }], stop_reason: "end_turn" },
    ]);
    const thread = new Thread("c5", "New conversation", "u1", []);
    await runTurn({ client, actor, thread, mode: { kind: "message", text: "Join chess" }, emit: () => {} });
    expect(await decideAction({ actor, thread, toolUseId: "t5", approve: true, emit: () => {} })).toBe(true);
    expect(executed).toEqual(["join_club"]);

    store.calls = 1_000;
    const events: StreamEvent[] = [];
    await runTurn({ client, actor, thread, mode: { kind: "continue" }, emit: (e) => events.push(e) });
    expect(requests).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "notice", retryText: "Try again" }));
    expect(buildView(thread).items.at(-1)).toMatchObject({ kind: "notice", retryText: "Try again" });

    store.calls = 0;
    await runTurn({ client, actor, thread, mode: { kind: "retry" }, emit: () => {} });
    expect(requests).toHaveLength(2);
    assertValidHistory(requests[1].messages);
    expect(buildView(thread).items.at(-1)).toMatchObject({ kind: "assistant" });
  });

  it("offers a retry after an API error and resends without duplicating the message", async () => {
    const { requests } = scriptedClient([]);
    const failing = {
      beta: {
        messages: {
          stream: (params: unknown) => {
            requests.push(structuredClone(params) as never);
            throw new Error("socket hang up");
          },
        },
      },
    } as never;
    const thread = new Thread("c4", "New conversation", "u1", []);
    const events: StreamEvent[] = [];
    await runTurn({ client: failing, actor, thread, mode: { kind: "message", text: "Hi" }, emit: (e) => events.push(e) });
    const notice = events.find((e) => e.type === "notice");
    expect(notice && notice.type === "notice" && notice.retryText).toBe("Try again");
    expect(buildView(thread).items.at(-1)).toMatchObject({ kind: "notice", retryText: "Try again" });

    const ok = scriptedClient([{ content: [{ type: "text", text: "Hello!" }], stop_reason: "end_turn" }]);
    await runTurn({ client: ok.client, actor, thread, mode: { kind: "retry" }, emit: () => {} });
    expect(ok.requests[0].messages.map((m) => m.role)).toEqual(["user", "system"]);
    // The answer replaces the error it retried.
    expect(buildView(thread).items.map((i) => i.kind)).toEqual(["user", "assistant"]);
  });
});
