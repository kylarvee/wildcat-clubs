"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, History, Maximize2, SquarePen, Sparkles, X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { ChatView, ConversationSummary, StarterPrompt } from "@/lib/ai/types";
import { useAssistantChat } from "@/components/assistant/useAssistantChat";
import { ChatSurface, type ChatSurfaceHandle } from "@/components/assistant/ChatSurface";
import { ConversationList } from "@/components/assistant/ConversationList";

/**
 * The floating "Ask Wildcat Clubs" button and its chat panel. On desktop the
 * panel sits bottom-right over the page, which stays usable; on phones it's a
 * full-screen sheet. It stays open (and keeps its conversation) while you move
 * between pages, and remembers the open conversation for this browser tab.
 */

const STORAGE_KEY = "wc.assistant.conversation";
/** Pages where a floating button would get in the way. */
const HIDDEN_ON = [/^\/assistant(\/|$)/, /^\/checkin\/live\//];

function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the panel simply starts fresh next time.
  }
}

function recall(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function AssistantDock({ firstName }: { firstName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [starters, setStarters] = useState<StarterPrompt[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** An answer finished while the panel was closed. */
  const [unseen, setUnseen] = useState(false);
  const openRef = useRef(open);
  const loaded = useRef(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const surface = useRef<ChatSurfaceHandle>(null);
  const panelId = useId();
  const titleId = useId();

  const chat = useAssistantChat({
    onConversation: ({ id, title }) => {
      remember(id);
      setConversations((list) => (list ? [{ id, title, updatedAt: new Date().toISOString() }, ...list.filter((c) => c.id !== id)] : list));
    },
    onChanged: () => router.refresh(),
    onDone: () => {
      if (!openRef.current) setUnseen(true);
    },
  });
  const { load } = chat;

  useEffect(() => {
    openRef.current = open;
    if (open) setUnseen(false);
  }, [open]);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch("/api/assistant/conversations", { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; error?: string; data?: { conversations: ConversationSummary[]; starters: StarterPrompt[] } };
      if (!json.ok || !json.data) throw new Error(json.error ?? "The assistant couldn't load.");
      setConversations(json.data.conversations);
      setStarters(json.data.starters);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "The assistant couldn't load.");
      setStarters([]);
      setConversations((c) => c ?? []);
      loaded.current = false; // try again next time the panel opens
    }
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, { cache: "no-store" });
        const json = (await res.json()) as { ok: boolean; data?: { view: ChatView } };
        if (!json.ok || !json.data) throw new Error();
        load(json.data.view);
        remember(id);
      } catch {
        remember(null);
        load(null);
      }
      setView("chat");
    },
    [load],
  );

  // First open: the history list, starter prompts and the conversation this tab had open.
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    void fetchList();
    const last = recall();
    if (last) void openConversation(last);
  }, [open, fetchList, openConversation]);

  // Focus the message box when the panel opens (not on phones, where that would pop up the keyboard).
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (view === "chat" && window.matchMedia("(min-width: 640px)").matches) surface.current?.focus();
      else panel.current?.focus();
    });
  }, [open, view]);

  // Phones get a full-screen sheet: keep the page behind it from scrolling.
  useEffect(() => {
    if (!open || !window.matchMedia("(max-width: 639px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  }, []);

  const newChat = () => {
    load(null);
    remember(null);
    setView("chat");
  };

  // On a phone the sheet covers the page, so following a link closes it.
  const onLinkClick = () => {
    if (window.matchMedia("(max-width: 639px)").matches) setOpen(false);
  };

  if (HIDDEN_ON.some((re) => re.test(pathname))) return null;

  return (
    <>
      <button
        ref={launcher}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close the assistant" : unseen ? "Ask Wildcat Clubs (new reply)" : "Ask Wildcat Clubs"}
        className={cn(
          "fixed bottom-4 right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-brand px-3.5 text-sm font-semibold text-white shadow-[var(--shadow-pop)] transition-colors hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:px-4 print:hidden",
          open && "max-sm:hidden",
        )}
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Sparkles className="h-5 w-5" aria-hidden />}
        <span className="hidden sm:inline">{open ? "Close" : "Ask Wildcat Clubs"}</span>
        {unseen && !open ? <span aria-hidden className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-amber-400" /> : null}
      </button>

      {open ? (
        <div
          id={panelId}
          ref={panel}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={(e) => {
            // Keys from dialogs portaled out of the panel (delete confirmation) bubble here through React; leave those alone.
            if (e.key === "Escape" && !e.defaultPrevented && panel.current?.contains(e.target as Node)) {
              e.stopPropagation();
              close();
            }
          }}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-surface outline-none print:hidden",
            "inset-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]",
            "sm:inset-auto sm:bottom-20 sm:right-4 sm:h-[min(680px,calc(100dvh-7rem))] sm:w-[400px] sm:max-w-[calc(100vw-2rem)] sm:rounded-2xl sm:border sm:border-line sm:p-0 sm:shadow-[var(--shadow-pop)]",
          )}
        >
          <header className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-2">
            {view === "history" ? (
              <button type="button" onClick={() => setView("chat")} className="rounded-lg p-2 text-ink-2 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand" aria-label="Back to the conversation">
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </button>
            ) : (
              <span aria-hidden className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand">
                <Sparkles className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1 px-1.5">
              <h2 id={titleId} className="truncate text-sm font-semibold text-ink">
                {view === "history" ? "Your conversations" : "Ask Wildcat Clubs"}
              </h2>
              {view === "chat" ? <p className="truncate text-xs text-ink-3">{chat.state.title ?? "Answers about clubs at Weber State"}</p> : null}
            </div>
            {view === "chat" ? (
              <button type="button" onClick={() => setView("history")} className="rounded-lg p-2 text-ink-2 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand" aria-label="Your conversations">
                <History className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              onClick={newChat}
              disabled={chat.state.busy}
              className="rounded-lg p-2 text-ink-2 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40"
              aria-label="New conversation"
            >
              <SquarePen className="h-4 w-4" aria-hidden />
            </button>
            <Link
              href={chat.state.conversationId ? `/assistant?c=${encodeURIComponent(chat.state.conversationId)}` : "/assistant"}
              onClick={() => setOpen(false)}
              className="hidden rounded-lg p-2 text-ink-2 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand sm:inline-flex"
              aria-label="Open the full assistant page"
            >
              <Maximize2 className="h-4 w-4" aria-hidden />
            </Link>
            <button type="button" onClick={close} className="rounded-lg p-2 text-ink-2 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand" aria-label="Close the assistant">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </header>

          {loadError && view === "chat" && chat.state.items.length === 0 ? (
            <p role="alert" className="mx-3 mt-3 rounded-lg border border-red-200 bg-danger-50 px-3 py-2 text-sm text-red-900">
              {loadError}
            </p>
          ) : null}

          {view === "history" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <ConversationList
                conversations={conversations}
                activeId={chat.state.conversationId}
                locked={chat.state.busy}
                onOpen={(id) => void openConversation(id)}
                onDeleted={(id) => {
                  setConversations((list) => list?.filter((c) => c.id !== id) ?? list);
                  if (id === chat.state.conversationId) newChat();
                }}
              />
              <p className="px-3 pb-2 pt-4 text-xs text-ink-3">
                Only you can see your conversations.{" "}
                <Link href="/assistant" onClick={() => setOpen(false)} className="font-medium text-brand-600 hover:underline">
                  Open the full page
                </Link>
              </p>
            </div>
          ) : (
            <ChatSurface
              ref={surface}
              className="flex-1"
              state={chat.state}
              firstName={firstName}
              starters={starters}
              onSend={chat.send}
              onRetry={() => void chat.retry()}
              onDecide={(id, approve) => void chat.decide(id, approve)}
              onDismissError={chat.clearError}
              onLinkClick={onLinkClick}
            />
          )}
        </div>
      ) : null}
    </>
  );
}
