"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { History, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { ChatView, ConversationSummary, StarterPrompt } from "@/lib/ai/types";
import { useAssistantChat } from "@/components/assistant/useAssistantChat";
import { ChatSurface, type ChatSurfaceHandle } from "@/components/assistant/ChatSurface";
import { ConversationList } from "@/components/assistant/ConversationList";

/**
 * The full-page assistant (/assistant): conversation history beside the chat
 * on wide screens, behind a "Your conversations" toggle on phones. The open
 * conversation is kept in the URL (?c=…) so it can be bookmarked or reloaded.
 */
export function AssistantWorkspace({
  firstName,
  initialView,
  initialConversations,
  starters,
}: {
  firstName: string;
  initialView: ChatView | null;
  initialConversations: ConversationSummary[];
  starters: StarterPrompt[];
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [showHistory, setShowHistory] = useState(false);
  const surface = useRef<ChatSurfaceHandle>(null);

  const setUrl = (id: string | null) => {
    window.history.replaceState(null, "", id ? `/assistant?c=${encodeURIComponent(id)}` : "/assistant");
  };

  const chat = useAssistantChat({
    initial: initialView,
    onConversation: ({ id, title }) => {
      setUrl(id);
      setConversations((list) => [{ id, title, updatedAt: new Date().toISOString() }, ...list.filter((c) => c.id !== id)]);
    },
    onChanged: () => router.refresh(),
  });
  const { load } = chat;

  const open = useCallback(
    async (id: string) => {
      setShowHistory(false);
      if (id === chat.state.conversationId) return;
      try {
        const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, { cache: "no-store" });
        const json = (await res.json()) as { ok: boolean; data?: { view: ChatView } };
        if (!json.ok || !json.data) throw new Error();
        load(json.data.view);
        setUrl(id);
      } catch {
        setConversations((list) => list.filter((c) => c.id !== id));
      }
      requestAnimationFrame(() => surface.current?.focus());
    },
    [chat.state.conversationId, load],
  );

  const newChat = () => {
    load(null);
    setUrl(null);
    setShowHistory(false);
    requestAnimationFrame(() => surface.current?.focus());
  };

  const list = (
    <ConversationList
      conversations={conversations}
      activeId={chat.state.conversationId}
      locked={chat.state.busy}
      onOpen={(id) => void open(id)}
      onDeleted={(id) => {
        setConversations((l) => l.filter((c) => c.id !== id));
        if (id === chat.state.conversationId) newChat();
      }}
    />
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden lg:block" aria-label="Your conversations">
        <div className="sticky top-20 space-y-3">
          <Button className="w-full" onClick={newChat} disabled={chat.state.busy}>
            <SquarePen className="h-4 w-4" aria-hidden />
            New conversation
          </Button>
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface p-1.5">{list}</div>
          <p className="px-1 text-xs text-ink-3">Only you can see your conversations.</p>
        </div>
      </aside>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2 lg:hidden">
          <Button variant="outline" size="sm" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory} aria-controls="assistant-history">
            <History className="h-4 w-4" aria-hidden />
            Your conversations
          </Button>
          <Button variant="outline" size="sm" onClick={newChat} disabled={chat.state.busy}>
            <SquarePen className="h-4 w-4" aria-hidden />
            New
          </Button>
        </div>
        {showHistory ? (
          <div id="assistant-history" className="rounded-[var(--radius-card)] border border-line bg-surface p-1.5 lg:hidden">
            {list}
          </div>
        ) : null}

        <section
          aria-label={chat.state.title ?? "New conversation"}
          className={cn("flex h-[calc(100dvh-13rem)] min-h-[28rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]")}
        >
          {chat.state.title ? (
            <div className="shrink-0 border-b border-line px-4 py-2.5">
              <h2 className="truncate text-sm font-semibold text-ink">{chat.state.title}</h2>
            </div>
          ) : null}
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
          />
        </section>
      </div>
    </div>
  );
}
