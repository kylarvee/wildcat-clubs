import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { AI_MODELS } from "@/lib/integrations/anthropic";
import { findTool } from "@/lib/ai/tools";
import type { ActionsContent, NoticeContent, StoredRow, Thread, ToolsContent } from "@/lib/ai/conversations";
import type { ChatItem, ChatPart, ChatView, ModelTag } from "@/lib/ai/types";

/**
 * Stored rows → what the chat UI draws. The UI never sees raw content blocks:
 * thinking is dropped, tool calls become chips or action cards, and our
 * placeholder answers (after a refusal) become notices.
 */

/** Stands in for an answer the model declined to give, so the history stays valid. */
export const REFUSAL_PLACEHOLDER = "[No answer: this request was declined.]";
/** Stands in for a reply with no visible text. */
export const EMPTY_PLACEHOLDER = "[No answer was written.]";
const PLACEHOLDERS = new Set([REFUSAL_PLACEHOLDER, EMPTY_PLACEHOLDER]);

export function modelTag(model: string | null | undefined): ModelTag {
  return model === AI_MODELS.haiku || model?.includes("haiku") ? "haiku" : "sonnet";
}

function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Anthropic.ContentBlockParam[])
    .filter((b): b is Anthropic.TextBlockParam => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

export function buildView(thread: Thread): ChatView {
  const rows = thread.rows;
  const chips = new Map<string, { label: string; ok: boolean }>();
  const actions = new Map<string, ActionsContent["actions"][number]>();
  const results = new Map<string, boolean>();
  let pending = 0;

  for (const r of rows) {
    if (r.role === "tools") for (const c of (r.content as unknown as ToolsContent).items) chips.set(c.id, { label: c.label, ok: c.ok });
    if (r.role === "actions") for (const a of (r.content as unknown as ActionsContent).actions) actions.set(a.id, a);
    if (r.role === "user" && Array.isArray(r.content)) {
      for (const b of r.content as unknown as Anthropic.ContentBlockParam[]) if (b.type === "tool_result") results.set(b.tool_use_id, Boolean(b.is_error));
    }
  }
  const latestActions = thread.pendingActions();
  if (latestActions) pending = latestActions.content.actions.filter((a) => a.status === "pending" || a.status === "running").length;

  const items: ChatItem[] = [];
  let current: Extract<ChatItem, { kind: "assistant" }> | null = null;

  const pushText = (text: string) => {
    if (!current) return;
    const last = current.parts[current.parts.length - 1];
    if (last?.kind === "text") last.text = `${last.text}\n\n${text}`;
    else current.parts.push({ kind: "text", text });
  };

  /** A notice whose next visible row is an answer was retried successfully: the answer replaces it. */
  const retried = (index: number) => {
    for (let j = index + 1; j < rows.length; j++) {
      const next = rows[j];
      if (next.role === "assistant") return true;
      if (next.role === "notice" || (next.role === "user" && userText(next.content))) return false;
    }
    return false;
  };

  for (const [index, r] of (rows as StoredRow[]).entries()) {
    switch (r.role) {
      case "user": {
        const text = userText(r.content);
        if (text) {
          items.push({ kind: "user", id: r.id, text });
          current = null;
        }
        break;
      }
      case "assistant": {
        if (!current) {
          current = { kind: "assistant", id: r.id, models: [], parts: [] };
          items.push(current);
        }
        const tag = modelTag(r.model);
        if (!current.models.includes(tag)) current.models.push(tag);
        for (const b of r.content as unknown as Anthropic.ContentBlock[]) {
          if (b.type === "text") {
            if (!PLACEHOLDERS.has(b.text.trim()) && b.text.trim()) pushText(b.text);
          } else if (b.type === "tool_use") {
            const action = actions.get(b.id);
            if (action) {
              current.parts.push({
                kind: "action",
                id: b.id,
                card: action.card,
                status: action.status === "running" ? "pending" : action.status,
                outcome: action.outcome,
                href: action.href,
              });
              continue;
            }
            const chip = chips.get(b.id);
            const isError = results.get(b.id);
            const part: ChatPart = {
              kind: "tool",
              id: b.id,
              label: chip?.label ?? findTool(b.name)?.running ?? "Working",
              // A call with no stored result never finished (the request failed mid-round).
              status: isError === undefined ? (chip?.ok ? "done" : "error") : isError ? "error" : "done",
            };
            current.parts.push(part);
          }
        }
        break;
      }
      case "notice": {
        if (retried(index)) break;
        const n = r.content as unknown as NoticeContent;
        items.push({ kind: "notice", id: r.id, tone: n.tone, text: n.text, retryText: n.retry ? (n.retryLabel ?? "Try again") : null });
        current = null;
        break;
      }
      default:
        break;
    }
  }

  // Only the last notice can be retried, and only while nothing came after it.
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "notice" && it.retryText && i !== items.length - 1) it.retryText = null;
  }
  const last = thread.lastApiRow();
  const tail = items[items.length - 1];
  if (tail?.kind === "notice" && tail.retryText && !(last && (last.role === "user" || last.role === "system"))) tail.retryText = null;

  // Drop assistant items that ended up empty (e.g. only thinking before a refusal).
  const visible = items.filter((it) => it.kind !== "assistant" || it.parts.length > 0);
  const updated = rows.length ? rows[rows.length - 1].createdAt : new Date();
  return { id: thread.id, title: thread.title, items: visible, pending, updatedAt: updated.toISOString() };
}
