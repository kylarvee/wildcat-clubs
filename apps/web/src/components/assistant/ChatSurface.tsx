"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import { AlertTriangle, Check, Info, Loader2, OctagonAlert, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Skeleton } from "@/components/ui/layout";
import { MODEL_LABEL, type ChatItem, type ChatPart, type NoticeTone, type StarterPrompt } from "@/lib/ai/types";
import type { ChatState } from "@/components/assistant/useAssistantChat";
import { Markdown } from "@/components/assistant/Markdown";
import { ActionCard } from "@/components/assistant/ActionCard";
import { Composer, type ComposerHandle } from "@/components/assistant/Composer";

/**
 * The conversation itself — welcome screen, transcript, composer — shared by
 * the floating panel and the /assistant page.
 */

export type ChatSurfaceHandle = { focus: () => void };

export const DISCLAIMER = "The assistant can make mistakes, so check anything important. It only changes something after you press Confirm.";

function ToolChip({ part }: { part: Extract<ChatPart, { kind: "tool" }> }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
        part.status === "error" ? "bg-warning-50 text-amber-900" : "bg-muted text-ink-2",
      )}
    >
      {part.status === "running" ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
      ) : part.status === "error" ? (
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      ) : (
        <Check className="h-3 w-3 shrink-0 text-success" aria-hidden />
      )}
      <span className="truncate">{part.label}</span>
      {part.status === "error" ? <span className="sr-only"> (didn't work)</span> : part.status === "running" ? <span className="sr-only"> (in progress)</span> : null}
    </span>
  );
}

const NOTICE_STYLE: Record<NoticeTone, { box: string; icon: ReactNode }> = {
  refusal: { box: "border-amber-200 bg-warning-50 text-amber-900", icon: <OctagonAlert className="h-4 w-4" aria-hidden /> },
  error: { box: "border-red-200 bg-danger-50 text-red-900", icon: <AlertTriangle className="h-4 w-4" aria-hidden /> },
  info: { box: "border-blue-200 bg-info-50 text-blue-900", icon: <Info className="h-4 w-4" aria-hidden /> },
};

function Notice({ item, busy, onRetry }: { item: Extract<ChatItem, { kind: "notice" }>; busy: boolean; onRetry: () => void }) {
  const style = NOTICE_STYLE[item.tone];
  return (
    <div className={cn("flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm", style.box)}>
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="[overflow-wrap:anywhere]">{item.text}</p>
        {item.retryText ? (
          <Button variant="outline" size="sm" onClick={onRetry} disabled={busy}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {item.retryText}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
      <span className="flex gap-1" aria-hidden>
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-200 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-200 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-200" />
      </span>
      Thinking…
    </span>
  );
}

/** Consecutive chips sit in one wrapping row. */
function groupParts(parts: ChatPart[]) {
  const groups: ({ kind: "chips"; parts: Extract<ChatPart, { kind: "tool" }>[] } | Exclude<ChatPart, { kind: "tool" }>)[] = [];
  for (const p of parts) {
    if (p.kind === "tool") {
      const last = groups[groups.length - 1];
      if (last?.kind === "chips") last.parts.push(p);
      else groups.push({ kind: "chips", parts: [p] });
    } else groups.push(p);
  }
  return groups;
}

function AssistantMessage({
  item,
  live,
  state,
  onDecide,
  onLinkClick,
}: {
  item: Extract<ChatItem, { kind: "assistant" }>;
  live: boolean;
  state: ChatState;
  onDecide: (id: string, approve: boolean) => void;
  onLinkClick?: () => void;
}) {
  const groups = groupParts(item.parts);
  return (
    <div className="flex gap-2.5">
      <div aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        <h3 className="sr-only">Assistant</h3>
        {groups.map((g, i) =>
          g.kind === "chips" ? (
            <div key={i} className="flex flex-wrap gap-1.5">
              {g.parts.map((p) => (
                <ToolChip key={p.id} part={p} />
              ))}
            </div>
          ) : g.kind === "text" ? (
            <Markdown key={i} text={g.text} onLinkClick={onLinkClick} />
          ) : (
            <ActionCard
              key={g.id}
              card={g.card}
              status={g.status}
              outcome={g.outcome}
              href={g.href}
              working={state.deciding.includes(g.id)}
              disabled={state.busy}
              onDecide={(approve) => onDecide(g.id, approve)}
              onLinkClick={onLinkClick}
            />
          ),
        )}
        {live && state.thinking ? <Thinking /> : null}
        {item.models.length > 0 && !(live && state.busy) ? (
          <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <span className="rounded-full border border-line bg-surface px-1.5 py-px font-medium uppercase tracking-wide" title={`Answered by Claude ${item.models.map((m) => MODEL_LABEL[m]).join(" and ")}`}>
              {item.models.map((m) => MODEL_LABEL[m]).join(" + ")}
            </span>
            <span className="sr-only">Answered by Claude {item.models.map((m) => MODEL_LABEL[m]).join(" and ")}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Welcome({ firstName, starters, busy, onStarter }: { firstName: string; starters: StarterPrompt[] | null; busy: boolean; onStarter: (prompt: string) => void }) {
  return (
    <div className="space-y-5 px-1 py-2">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand">
        <Sparkles className="h-5 w-5" aria-hidden />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold text-ink">Hi {firstName}, what can I help with?</h2>
        <p className="text-sm leading-relaxed text-ink-2">
          I know how Wildcat Clubs works and can look things up for you — clubs, events, your tasks, roles and attendance. I can also take steps for you, like joining a club or adding an event,
          but only after you press Confirm.
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Try asking</p>
        {starters ? (
          <ul className="grid gap-2">
            {starters.map((s) => (
              <li key={s.label}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onStarter(s.prompt)}
                  className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-sm font-medium text-ink shadow-[var(--shadow-card)] transition-colors hover:border-brand-200 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-2" aria-hidden>
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatSurface = forwardRef<
  ChatSurfaceHandle,
  {
    state: ChatState;
    firstName: string;
    starters: StarterPrompt[] | null;
    onSend: (text: string) => Promise<boolean>;
    onRetry: () => void;
    onDecide: (id: string, approve: boolean) => void;
    onDismissError: () => void;
    onLinkClick?: () => void;
    className?: string;
  }
>(function ChatSurface({ state, firstName, starters, onSend, onRetry, onDecide, onDismissError, onLinkClick, className }, ref) {
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const stick = useRef(true);

  useImperativeHandle(ref, () => ({ focus: () => composer.current?.focus() }), []);

  // Follow the answer as it streams, unless the person scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.items, state.thinking]);

  useEffect(() => {
    stick.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.conversationId]);

  const send = async (text: string) => {
    stick.current = true;
    return onSend(text);
  };

  const lastIndex = state.items.length - 1;
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
        role="log"
        aria-label="Conversation with the assistant"
        aria-live="off"
        tabIndex={0}
      >
        {state.items.length === 0 ? (
          <Welcome firstName={firstName} starters={starters} busy={state.busy} onStarter={(p) => void send(p)} />
        ) : (
          <div className="space-y-5">
            {state.items.map((item, i) =>
              item.kind === "user" ? (
                <div key={item.id} className="flex justify-end">
                  <h3 className="sr-only">You</h3>
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-sm text-white [overflow-wrap:anywhere]">{item.text}</p>
                </div>
              ) : item.kind === "assistant" ? (
                <AssistantMessage key={item.id} item={item} live={i === lastIndex} state={state} onDecide={onDecide} onLinkClick={onLinkClick} />
              ) : (
                <Notice key={item.id} item={item} busy={state.busy} onRetry={onRetry} />
              ),
            )}
            {state.busy && state.items[lastIndex]?.kind !== "assistant" ? (
              <div className="pl-9">
                <Thinking />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {state.error ? (
        <div role="alert" className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-red-200 bg-danger-50 px-3 py-2 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{state.error}</p>
          <button type="button" onClick={onDismissError} className="rounded p-0.5 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-brand" aria-label="Dismiss">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <Composer ref={composer} busy={state.busy} onSend={send} />
      <p className="bg-surface px-4 pb-3 text-[11px] leading-snug text-ink-3">{DISCLAIMER}</p>
      <div className="sr-only" role="status" aria-live="polite">
        {state.status}
      </div>
    </div>
  );
});
