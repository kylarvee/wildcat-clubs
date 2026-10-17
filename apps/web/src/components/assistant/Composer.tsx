"use client";

import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { MAX_USER_MESSAGE } from "@/lib/ai/types";

export type ComposerHandle = { focus: () => void; setDraft: (text: string) => void };

/**
 * The message box. Enter sends, Shift+Enter adds a line; it grows with the
 * text up to a few lines. A draft that couldn't be sent stays put.
 */
export const Composer = forwardRef<ComposerHandle, { busy: boolean; disabled?: boolean; onSend: (text: string) => Promise<boolean>; placeholder?: string }>(function Composer(
  { busy, disabled, onSend, placeholder = "Ask about clubs, events, roles…" },
  ref,
) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const lengthId = `${id}-length`;

  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus(), setDraft: (t: string) => setText(t) }), []);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  const tooLong = text.length > MAX_USER_MESSAGE;
  const canSend = !busy && !disabled && text.trim().length > 0 && !tooLong;

  const submit = async () => {
    if (!canSend) return;
    const draft = text;
    setText("");
    const sent = await onSend(draft);
    if (!sent) setText((current) => current || draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className="flex items-end gap-2 border-t border-line bg-surface px-3 pb-2 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="sr-only">
          Message the assistant
        </label>
        <textarea
          id={id}
          ref={area}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={tooLong ? lengthId : undefined}
          aria-invalid={tooLong || undefined}
          className={cn(
            "block max-h-[168px] w-full resize-none rounded-xl border border-line-2 bg-surface px-3 py-2.5 text-base text-ink placeholder:text-ink-3 shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-muted sm:text-sm",
            tooLong && "border-danger focus:border-danger focus:ring-red-100",
          )}
        />
        {text.length > MAX_USER_MESSAGE - 500 ? (
          <p id={lengthId} className={cn("mt-1 text-xs", tooLong ? "text-danger" : "text-ink-3")}>
            {text.length.toLocaleString()} / {MAX_USER_MESSAGE.toLocaleString()} characters
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={!canSend}
        aria-label={busy ? "Waiting for the answer" : "Send"}
        className="mb-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm transition-colors hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowUp className="h-5 w-5" aria-hidden />}
      </button>
    </form>
  );
});
