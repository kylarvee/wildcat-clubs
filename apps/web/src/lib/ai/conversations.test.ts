import { describe, expect, it } from "vitest";
import { apiMessages, Thread, titleFrom, type StoredRow } from "@/lib/ai/conversations";

let n = 0;
const row = (role: StoredRow["role"], content: unknown, model: string | null = null): StoredRow => ({
  id: `r${++n}`,
  role,
  content: content as StoredRow["content"],
  model,
  createdAt: new Date(1_700_000_000_000 + n),
});
const text = (t: string) => [{ type: "text", text: t }];
const toolUse = (id: string) => [{ type: "text", text: "Checking." }, { type: "tool_use", id, name: "get_club", input: { club: "Chess" } }];
const toolResult = (id: string) => [{ type: "tool_result", tool_use_id: id, content: "{}" }];

describe("apiMessages", () => {
  it("keeps model-facing rows in order and drops bookkeeping rows", () => {
    const rows = [
      row("user", text("Hi")),
      row("system", "context"),
      row("assistant", toolUse("t1"), "claude-haiku-5-5"),
      row("tools", { items: [] }),
      row("user", toolResult("t1")),
      row("assistant", text("Done"), "claude-haiku-5-5"),
      row("notice", { tone: "info", text: "x", retry: false }),
    ];
    expect(apiMessages(rows).map((m) => m.role)).toEqual(["user", "system", "assistant", "user", "assistant"]);
  });

  it("drops a context note whose request never got an answer", () => {
    const rows = [row("user", text("Hi")), row("system", "old note"), row("notice", { tone: "error", text: "x", retry: true }), row("user", text("Again")), row("system", "new note")];
    const msgs = apiMessages(rows);
    expect(msgs.map((m) => m.role)).toEqual(["user", "user", "system"]);
    expect(msgs[2].content).toBe("new note");
  });

  it("keeps a trailing note so the first request carries it", () => {
    expect(apiMessages([row("user", text("Hi")), row("system", "note")]).map((m) => m.role)).toEqual(["user", "system"]);
  });
});

describe("Thread", () => {
  it("finds the last note the model actually read", () => {
    const answered = new Thread("c", "t", "u", [row("user", text("Hi")), row("system", "note A"), row("assistant", text("Hello"), "claude-haiku-5-5"), row("user", text("More"))]);
    expect(answered.lastAnsweredNote()).toBe("note A");
    const unanswered = new Thread("c", "t", "u", [row("user", text("Hi")), row("system", "note A"), row("user", text("More"))]);
    expect(unanswered.lastAnsweredNote()).toBeNull();
  });

  it("reports a round still waiting for Confirm", () => {
    const round = { order: ["t1"], results: [], actions: [{ id: "t1", name: "join_club", input: {}, card: { title: "Join", details: [], confirmLabel: "Join" }, fingerprint: null, status: "pending", outcome: null, href: null, result: null }] };
    const t = new Thread("c", "t", "u", [row("user", text("Join chess")), row("assistant", toolUse("t1"), "claude-sonnet-5-5"), row("actions", round)]);
    expect(t.pendingActions()?.content.actions[0].id).toBe("t1");
    expect(t.lastModel()).toBe("claude-sonnet-5-5");
    const decided = new Thread("c", "t", "u", [...t.rows, row("user", toolResult("t1"))]);
    expect(decided.pendingActions()).toBeNull();
  });
});

describe("titleFrom", () => {
  it("shortens long first messages at a word", () => {
    const title = titleFrom("Help me plan a weekly meeting for Wildcat Robotics on Tuesdays at six in Tracy Hall for the rest of the term please");
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
    expect(titleFrom("  Find   clubs about AI ")).toBe("Find clubs about AI");
  });
});
