import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatSurface } from "@/components/assistant/ChatSurface";
import { viewToState } from "@/components/assistant/useAssistantChat";
import type { ChatView } from "@/lib/ai/types";

const noop = () => {};
const send = async () => true;

function render(view: ChatView | null, extra: Partial<ReturnType<typeof viewToState>> = {}) {
  return renderToStaticMarkup(
    createElement(ChatSurface, {
      state: { ...viewToState(view), ...extra },
      firstName: "Priya",
      starters: [{ label: "Find clubs about AI", prompt: "Find clubs about AI" }],
      onSend: send,
      onRetry: noop,
      onDecide: noop,
      onDismissError: noop,
    }),
  );
}

describe("ChatSurface", () => {
  it("greets a new conversation with starter prompts and the disclaimer", () => {
    const html = render(null);
    expect(html).toContain("Hi Priya, what can I help with?");
    expect(html).toContain("Find clubs about AI");
    expect(html).toContain("only changes something after you press Confirm");
  });

  it("renders answers, chips, model tags, action cards and notices without raw HTML", () => {
    const view: ChatView = {
      id: "c1",
      title: "Robotics",
      pending: 1,
      updatedAt: new Date().toISOString(),
      items: [
        { kind: "user", id: "u1", text: "Tell me about robotics <b>now</b>" },
        {
          kind: "assistant",
          id: "a1",
          models: ["sonnet"],
          parts: [
            { kind: "tool", id: "t1", label: "Looked up Wildcat Robotics", status: "done" },
            { kind: "text", text: "**Wildcat Robotics** meets Tuesdays. <script>alert(1)</script> [Club page](https://example.com)" },
            { kind: "action", id: "t2", card: { title: "Join Wildcat Robotics", details: ["You'll become a member right away."], confirmLabel: "Join club", preview: { label: "Hello", text: "Body" } }, status: "pending", outcome: null, href: null },
          ],
        },
        { kind: "notice", id: "n1", tone: "error", text: "Claude is overloaded right now.", retryText: "Try again" },
      ],
    };
    const html = render(view);
    expect(html).toContain("Looked up Wildcat Robotics");
    expect(html).toContain("<strong");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;now&lt;/b&gt;");
    expect(html).toContain("Sonnet");
    expect(html).toContain("Join club");
    expect(html).toContain("Needs your OK");
    expect(html).toContain("Try again");
    expect(html).toContain('target="_blank"');
  });
});
