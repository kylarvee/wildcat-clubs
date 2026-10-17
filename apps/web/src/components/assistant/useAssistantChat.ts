"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ChatItem, ChatPart, ChatView, StreamEvent } from "@/lib/ai/types";

/**
 * The chat state machine shared by the floating panel and /assistant.
 * Sends go to POST /api/assistant, Confirm / Cancel to /api/assistant/confirm;
 * both stream StreamEvents, which are applied to the transcript as they
 * arrive. The final `done` event replaces everything with the server's view,
 * so what's on screen always ends up matching what was stored.
 */

export type ChatState = {
  conversationId: string | null;
  title: string | null;
  items: ChatItem[];
  /** A request is streaming. */
  busy: boolean;
  /** Waiting for the first visible output of the current model call. */
  thinking: boolean;
  /** Action cards whose Confirm / Cancel is being sent. */
  deciding: string[];
  /** A problem that isn't part of the stored conversation (offline, limit reached…). */
  error: string | null;
  /** Something for screen readers to announce. */
  status: string;
};

const EMPTY: ChatState = { conversationId: null, title: null, items: [], busy: false, thinking: false, deciding: [], error: null, status: "" };

export function viewToState(view: ChatView | null): ChatState {
  return view ? { ...EMPTY, conversationId: view.id, title: view.title, items: view.items } : EMPTY;
}

type Result = { ok: true; finished: boolean } | { ok: false; error: string; status: number };

/** POSTs JSON and reads the server-sent events. `finished` is false when the stream ended without done/fatal. */
async function streamPost(url: string, body: unknown, onEvent: (e: StreamEvent) => void): Promise<Result> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: "Couldn't reach Wildcat Clubs. Check your connection and try again.", status: 0 };
  }
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    let error = res.status === 404 ? "The assistant isn't available right now." : "Something went wrong. Try again.";
    try {
      const json = (await res.json()) as { error?: string };
      if (json?.error) error = json.error;
    } catch {
      // Not JSON; keep the generic message.
    }
    return { ok: false, error, status: res.status };
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line.slice(6)) as StreamEvent;
          } catch {
            continue;
          }
          if (event.type === "done" || event.type === "fatal") finished = true;
          onEvent(event);
        }
      }
    }
  } catch {
    return { ok: true, finished };
  }
  return { ok: true, finished };
}

type Live = { segmentStart: number };

/** Applies one streamed event to the transcript. Pure, so React can batch freely. */
function apply(state: ChatState, event: StreamEvent, live: Live): ChatState {
  const items = state.items.slice();
  const lastIndex = items.length - 1;
  const assistant = (): Extract<ChatItem, { kind: "assistant" }> => {
    const last = items[items.length - 1];
    if (last?.kind === "assistant") {
      const copy = { ...last, parts: last.parts.slice(), models: last.models.slice() };
      items[items.length - 1] = copy;
      return copy;
    }
    const fresh: Extract<ChatItem, { kind: "assistant" }> = { kind: "assistant", id: `live-${Date.now()}`, models: [], parts: [] };
    items.push(fresh);
    return fresh;
  };
  const upsertPart = (a: Extract<ChatItem, { kind: "assistant" }>, part: ChatPart) => {
    const i = a.parts.findIndex((p) => (p.kind === "tool" || p.kind === "action") && p.id === (part as { id: string }).id);
    if (i >= 0) a.parts[i] = part;
    else a.parts.push(part);
  };

  switch (event.type) {
    case "start":
      return { ...state, conversationId: event.conversationId, title: event.title };
    case "model": {
      const a = assistant();
      if (!a.models.includes(event.model)) a.models.push(event.model);
      live.segmentStart = a.parts.length;
      return { ...state, items, thinking: true };
    }
    case "text": {
      const a = assistant();
      const last = a.parts[a.parts.length - 1];
      if (last?.kind === "text") a.parts[a.parts.length - 1] = { kind: "text", text: last.text + event.delta };
      else a.parts.push({ kind: "text", text: event.delta });
      return { ...state, items, thinking: false };
    }
    case "reset": {
      if (lastIndex < 0 || items[lastIndex].kind !== "assistant") return state;
      const a = assistant();
      a.parts = a.parts.slice(0, live.segmentStart);
      return { ...state, items };
    }
    case "tool": {
      const a = assistant();
      upsertPart(a, { kind: "tool", id: event.id, label: event.label, status: event.status });
      return { ...state, items };
    }
    case "action": {
      const a = assistant();
      upsertPart(a, { kind: "action", id: event.id, card: event.card, status: "pending", outcome: null, href: null });
      return { ...state, items, thinking: false, status: `Waiting for you to confirm: ${event.card.title}` };
    }
    case "action_result": {
      const next = items.map((it) =>
        it.kind === "assistant" && it.parts.some((p) => p.kind === "action" && p.id === event.id)
          ? { ...it, parts: it.parts.map((p) => (p.kind === "action" && p.id === event.id ? { ...p, status: event.status, outcome: event.outcome, href: event.href } : p)) }
          : it,
      );
      return { ...state, items: next, deciding: state.deciding.filter((id) => id !== event.id), status: event.outcome ?? "" };
    }
    case "notice":
      items.push({ kind: "notice", id: `notice-${Date.now()}`, tone: event.tone, text: event.text, retryText: event.retryText });
      return { ...state, items, thinking: false, status: event.text };
    case "done":
      return { ...state, conversationId: event.view.id, title: event.view.title, items: event.view.items, busy: false, thinking: false, deciding: [], status: event.view.pending ? "Waiting for your confirmation." : "Answer ready." };
    case "fatal":
      return { ...state, busy: false, thinking: false, deciding: [], error: event.message, status: event.message };
  }
}

export function useAssistantChat(opts: {
  initial?: ChatView | null;
  /** A conversation started or changed (for the URL and history list). */
  onConversation?: (c: { id: string; title: string }) => void;
  /** An action ran, so the page behind the chat may be out of date. */
  onChanged?: () => void;
  /** A request finished (the answer is complete, or an action card is waiting). */
  onDone?: (view: ChatView) => void;
}) {
  const [state, setState] = useState<ChatState>(() => viewToState(opts.initial ?? null));
  const stateRef = useRef(state);
  const live = useRef<Live>({ segmentStart: 0 });
  /** Set synchronously, so a double click can't start two requests before React re-renders. */
  const inflight = useRef(false);
  const optsRef = useRef(opts);
  // Callbacks read the latest committed state and options without re-creating themselves.
  useLayoutEffect(() => {
    stateRef.current = state;
    optsRef.current = opts;
  });

  const onEvent = useCallback((event: StreamEvent) => {
    setState((s) => apply(s, event, live.current));
    if (event.type === "start") optsRef.current.onConversation?.({ id: event.conversationId, title: event.title });
    if (event.type === "done") {
      optsRef.current.onConversation?.({ id: event.view.id, title: event.view.title });
      optsRef.current.onDone?.(event.view);
    }
    if (event.type === "action_result" && event.status === "approved") optsRef.current.onChanged?.();
  }, []);

  /** Re-reads the stored conversation (after a dropped connection or a fatal error). */
  const reload = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; data?: { view: ChatView } };
      if (json.ok && json.data) {
        const view = json.data.view;
        setState((s) => ({ ...s, conversationId: view.id, title: view.title, items: view.items, busy: false, thinking: false, deciding: [] }));
      }
    } catch {
      // Keep what's on screen; the error message already says what happened.
    }
  }, []);

  /**
   * Runs one streamed request. Returns false when nothing was stored and the
   * caller should keep the person's draft.
   */
  const run = useCallback(
    async (url: string, body: unknown, rollback?: () => void): Promise<boolean> => {
      inflight.current = true;
      try {
        let id = stateRef.current.conversationId;
        let started = false;
        let fatal = false;
        const result = await streamPost(url, body, (e) => {
          if (e.type === "start") {
            started = true;
            id = e.conversationId;
          }
          if (e.type === "fatal") fatal = true;
          onEvent(e);
        });
        if (!result.ok || (fatal && !started && rollback)) {
          if (rollback && !started) rollback();
          const error = result.ok ? null : result.error;
          setState((s) => ({ ...s, busy: false, thinking: false, deciding: [], ...(error ? { error, status: error } : {}) }));
          return !rollback || started;
        }
        if (!result.finished) {
          setState((s) => ({ ...s, busy: false, thinking: false, deciding: [], error: "The connection dropped before the answer finished. Here's what was saved." }));
          if (id) void reload(id);
        } else if (fatal && id) {
          void reload(id);
        }
        return true;
      } finally {
        inflight.current = false;
      }
    },
    [onEvent, reload],
  );

  /** Sends a message. Returns false if it couldn't be sent (the caller keeps the draft). */
  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const message = text.trim();
      if (!message) return false;
      // A second press while the first is on its way: nothing to restore, the first send shows the message.
      if (inflight.current) return true;
      const before = stateRef.current;
      live.current.segmentStart = 0;
      setState((s) => ({
        ...s,
        busy: true,
        thinking: true,
        error: null,
        status: "Thinking…",
        items: [...s.items, { kind: "user", id: `local-${Date.now()}`, text: message }, { kind: "assistant", id: `live-${Date.now()}`, models: [], parts: [] }],
      }));
      // If nothing was stored, the message comes back off the screen so it can be edited and re-sent.
      return run("/api/assistant", { conversationId: before.conversationId ?? undefined, message }, () => setState((s) => ({ ...s, items: before.items })));
    },
    [run],
  );

  const retry = useCallback(async () => {
    const id = stateRef.current.conversationId;
    if (!id || inflight.current) return;
    live.current.segmentStart = 0;
    setState((s) => ({
      ...s,
      busy: true,
      thinking: true,
      error: null,
      status: "Trying again…",
      // The retried notice disappears; the answer streams in its place.
      items: s.items[s.items.length - 1]?.kind === "notice" ? s.items.slice(0, -1) : s.items,
    }));
    await run("/api/assistant", { conversationId: id, retry: true });
  }, [run]);

  const decide = useCallback(
    async (toolUseId: string, approve: boolean) => {
      const id = stateRef.current.conversationId;
      if (!id || inflight.current) return;
      live.current.segmentStart = 0;
      setState((s) => ({ ...s, busy: true, thinking: false, error: null, deciding: [...s.deciding, toolUseId], status: approve ? "Working on it…" : "Cancelling…" }));
      await run("/api/assistant/confirm", { conversationId: id, toolUseId, approve });
    },
    [run],
  );

  /** Shows another conversation (or a blank one). */
  const load = useCallback((view: ChatView | null) => {
    live.current.segmentStart = 0;
    setState(viewToState(view));
  }, []);

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return { state, send, retry, decide, load, reload, clearError };
}
