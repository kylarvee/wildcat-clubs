"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ScrollText, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { MESSAGE_MAX_LENGTH, messageBodyProblem, normalizeMessageBody } from "@/components/messages/format";

/** Unsent text per conversation, kept while you move between chats in this tab. */
const drafts = new Map<string, string>();

/** Phones and tablets: Return adds a line (there's no Shift key), the Send button sends. */
function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return coarse;
}

/**
 * The message box: Enter sends, Shift+Enter starts a new line, grows with the
 * text, counts characters near the 4,000 limit and keeps a draft per chat.
 * The messaging policy sits behind a toggle so it's one tap away, not in the way.
 */
export function Composer({
  conversationId,
  placeholder,
  onSend,
  policy,
}: {
  conversationId: string;
  placeholder: string;
  /** Called with the cleaned-up text; the caller shows it right away and delivers it. */
  onSend: (body: string) => void;
  policy?: ReactNode;
}) {
  const [text, setText] = useState(() => drafts.get(conversationId) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const coarse = useCoarsePointer();
  const hintId = useId();
  const policyId = useId();
  const length = normalizeMessageBody(text).length;
  const over = length > MESSAGE_MAX_LENGTH;

  useEffect(() => {
    if (text) drafts.set(conversationId, text);
    else drafts.delete(conversationId);
  }, [conversationId, text]);

  // Grow with the text up to about eight lines, then scroll inside.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // Ready to type on a computer; on phones, wait for a tap so the keyboard doesn't cover the chat.
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) ref.current?.focus({ preventScroll: true });
  }, [conversationId]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const body = normalizeMessageBody(text);
    const problem = messageBodyProblem(body);
    if (problem) {
      setError(body ? problem : null);
      ref.current?.focus();
      return;
    }
    onSend(body);
    setText("");
    setError(null);
    ref.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing || coarse) return;
    e.preventDefault();
    submit();
  }

  return (
    <div className="shrink-0 border-t border-line bg-surface px-3 pb-3 pt-2 sm:px-4">
      {policy && policyOpen ? (
        <div id={policyId} className="mb-2 max-h-48 overflow-y-auto">
          {policy}
        </div>
      ) : null}
      <form onSubmit={submit} className="flex items-end gap-2">
        <label htmlFor={`composer-${conversationId}`} className="sr-only">
          {placeholder}
        </label>
        <textarea
          ref={ref}
          id={`composer-${conversationId}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          aria-describedby={hintId}
          aria-invalid={over || undefined}
          className={cn(
            "max-h-[200px] min-h-10 w-full resize-none rounded-xl border bg-surface px-3 py-2 text-sm leading-relaxed text-ink shadow-sm placeholder:text-ink-3 focus:outline-none focus:ring-2",
            over ? "border-danger focus:ring-red-100" : "border-line-2 focus:border-brand focus:ring-brand-100",
          )}
        />
        <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-xl" disabled={!length || over} aria-label="Send message">
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
      <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
        <span id={hintId} className={cn(error || over ? "text-danger" : "", coarse && !error && !over ? "sr-only" : "")} aria-live="polite">
          {error ??
            (over
              ? `Messages can be up to ${MESSAGE_MAX_LENGTH.toLocaleString("en-US")} characters. Trim ${(length - MESSAGE_MAX_LENGTH).toLocaleString("en-US")} to send.`
              : coarse
                ? "Tap Send to send."
                : "Enter to send · Shift + Enter for a new line")}
        </span>
        {length > MESSAGE_MAX_LENGTH - 400 ? (
          <span className={cn("tabular-nums", over ? "font-medium text-danger" : "")}>
            {length.toLocaleString("en-US")} / {MESSAGE_MAX_LENGTH.toLocaleString("en-US")}
          </span>
        ) : null}
        {policy ? (
          <button
            type="button"
            onClick={() => setPolicyOpen((o) => !o)}
            aria-expanded={policyOpen}
            aria-controls={policyOpen ? policyId : undefined}
            className="ml-auto inline-flex items-center gap-1 rounded font-medium text-ink-3 hover:text-brand focus-visible:outline-2 focus-visible:outline-brand"
          >
            <ScrollText className="h-3.5 w-3.5" aria-hidden="true" /> Messaging policy
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", policyOpen && "rotate-180")} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
