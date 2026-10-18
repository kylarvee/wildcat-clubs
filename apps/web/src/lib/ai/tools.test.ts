import { describe, expect, it } from "vitest";
import { API_TOOLS, findTool, TOOLS, validateCall } from "@/lib/ai/tools";
import { buildView, REFUSAL_PLACEHOLDER } from "@/lib/ai/view";
import { Thread, type StoredRow } from "@/lib/ai/conversations";

describe("tool registry", () => {
  it("offers every brief tool, read and write", () => {
    const names = TOOLS.map((t) => t.name);
    for (const n of ["search_clubs", "get_club", "my_clubs_and_roles", "my_profile", "my_tasks", "my_calendar", "my_attendance", "list_policies", "get_policy", "explain_permissions", "event_details"]) {
      expect(findTool(n)?.kind).toBe("read");
    }
    for (const n of ["join_club", "subscribe_calendar", "unsubscribe_calendar", "add_personal_task", "update_my_profile", "create_event", "post_announcement", "start_club_draft", "invite_advisor", "assign_role"]) {
      expect(findTool(n)?.kind).toBe("write");
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("never touches complaints or ballots", () => {
    expect(TOOLS.some((t) => /complaint|report|vote|ballot/i.test(t.name))).toBe(false);
  });

  it("builds clean, stable JSON schemas", () => {
    for (const t of API_TOOLS) {
      expect(t.input_schema.type).toBe("object");
      const json = JSON.stringify(t.input_schema);
      expect(json).not.toContain("$schema");
      expect(json).not.toContain("9007199254740991");
      expect(t.eager_input_streaming).toBe(true);
    }
    expect(JSON.stringify(API_TOOLS)).toBe(JSON.stringify(API_TOOLS.map((t) => ({ ...t }))));
  });

  it("validates input before anything runs", () => {
    expect(validateCall("create_event", { club: "Chess", title: "Meet", date: "next tuesday" }).ok).toBe(false);
    expect(validateCall("CREATE_EVENT", { club: "Chess", title: "Meet", date: "2026-10-20" }).ok).toBe(true);
    const unknown = validateCall("vote_for", {});
    expect(unknown.ok).toBe(false);
    expect(validateCall("update_my_profile", { headline: "CS junior", class_year: null, majors: [{ name: "Computer Science" }] }).ok).toBe(true);
    expect(validateCall("update_my_profile", { headline: "x".repeat(121) }).ok).toBe(false);
  });
});

describe("buildView", () => {
  let n = 0;
  const row = (role: StoredRow["role"], content: unknown, model: string | null = null): StoredRow => ({ id: `r${++n}`, role, content: content as StoredRow["content"], model, createdAt: new Date(1_700_000_000_000 + n) });

  it("turns tool calls into chips and cards, and hides thinking and placeholders", () => {
    const rows = [
      row("user", [{ type: "text", text: "Join chess and tell me about robotics" }]),
      row("system", "context"),
      row(
        "assistant",
        [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "tool_use", id: "a", name: "get_club", input: { club: "robotics" } },
          { type: "tool_use", id: "b", name: "join_club", input: { club: "chess" } },
        ],
        "claude-sonnet-5-5",
      ),
      row("tools", { items: [{ id: "a", name: "get_club", label: "Looked up Wildcat Robotics", ok: true }] }),
      row("actions", {
        order: ["a", "b"],
        results: [{ type: "tool_result", tool_use_id: "a", content: "{}" }],
        actions: [{ id: "b", name: "join_club", input: { club: "chess" }, card: { title: "Join Chess Club", details: ["x"], confirmLabel: "Join club" }, status: "pending", outcome: null, href: null, result: null }],
      }),
    ];
    const view = buildView(new Thread("c1", "Join chess", "u", rows));
    expect(view.pending).toBe(1);
    expect(view.items.map((i) => i.kind)).toEqual(["user", "assistant"]);
    const a = view.items[1];
    if (a.kind !== "assistant") throw new Error("expected an answer");
    expect(a.models).toEqual(["sonnet"]);
    expect(a.parts.map((p) => p.kind)).toEqual(["tool", "action"]);
    expect(a.parts[0]).toMatchObject({ label: "Looked up Wildcat Robotics", status: "done" });
  });

  it("shows a refusal as a notice", () => {
    const rows = [
      row("user", [{ type: "text", text: "Something odd" }]),
      row("assistant", [{ type: "text", text: REFUSAL_PLACEHOLDER }], "claude-haiku-5-5"),
      row("notice", { tone: "refusal", text: "Claude couldn't help with that one.", retry: false }),
    ];
    const view = buildView(new Thread("c2", "t", "u", rows));
    expect(view.items.map((i) => i.kind)).toEqual(["user", "notice"]);
  });
});
