"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { ConversationListItem, MessageView, PersonRef } from "@/lib/domain/messaging";
import { MessagesContext, type MessagesContextValue } from "@/components/messages/context";
import { cn } from "@/components/ui/cn";
import { ConversationList } from "@/components/messages/ConversationList";
import { NewMessageDialog } from "@/components/messages/NewMessageDialog";
import { NewGroupDialog } from "@/components/messages/NewGroupDialog";
import { firstName, previewText } from "@/components/messages/format";

/**
 * The Messages app frame: conversation list on the left, the open thread on
 * the right (one pane at a time on phones). Holds the list state the thread
 * updates as you send and read, and refreshes it from GET /api/messages.
 */

/** The list refreshes this often while the tab is visible (the open thread polls faster on its own). */
const LIST_POLL_MS = 15_000;

function activeIdFrom(pathname: string): string | null {
  const m = pathname.match(/^\/messages\/([^/]+)$/);
  if (!m || m[1] === "club") return null;
  return decodeURIComponent(m[1]);
}

export function MessagesShell({
  me,
  initialConversations,
  canStartGroup,
  canStartDirect,
  children,
}: {
  me: PersonRef;
  initialConversations: ConversationListItem[];
  canStartGroup: boolean;
  canStartDirect: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const activeId = activeIdFrom(pathname);
  // Anything under /messages/… other than the index is a thread (or a club-chat redirect), so phones show that pane.
  const showingThread = pathname !== "/messages";

  const [conversations, setConversations] = useState(initialConversations);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);

  // A server refresh (e.g. after a group is renamed) sends a new list.
  useEffect(() => setConversations(initialConversations), [initialConversations]);

  const activeRef = useRef(activeId);
  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  const inFlight = useRef(false);
  const refreshList = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/messages", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { ok: boolean; data?: { conversations: ConversationListItem[] } };
      if (!json.ok || !json.data) return;
      const open = activeRef.current;
      // The open thread marks itself read; don't flash a count for it in between.
      setConversations(json.data.conversations.map((c) => (c.id === open ? { ...c, unread: 0 } : c)));
    } catch {
      // Offline for a moment: keep the list we have and try again on the next tick.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!document.hidden) await refreshList();
        schedule();
      }, LIST_POLL_MS);
    };
    const onVisible = () => {
      if (document.hidden) return;
      void refreshList();
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshList]);

  // Opening a conversation that isn't listed yet (a brand-new DM or group) fetches the list again.
  const known = conversations.some((c) => c.id === activeId);
  useEffect(() => {
    if (activeId && !known) void refreshList();
  }, [activeId, known, refreshList]);

  const listRef = useRef(conversations);
  useEffect(() => {
    listRef.current = conversations;
  }, [conversations]);

  const noteMessage = useCallback(
    (conversationId: string, message: MessageView) => {
      if (!listRef.current.some((c) => c.id === conversationId)) {
        void refreshList();
        return;
      }
      setConversations((list) => {
        const i = list.findIndex((c) => c.id === conversationId);
        if (i < 0) return list;
        const c = list[i];
        if (c.lastMessageAt > message.createdAt) return list;
        const mine = message.author.id === me.id;
        const text = message.deleted ? "Message deleted" : previewText(message.body, 90);
        const preview = message.deleted ? text : mine ? `You: ${text}` : c.type === "DIRECT" ? text : `${firstName(message.author.name)}: ${text}`;
        const next = { ...c, preview, lastMessageAt: message.createdAt };
        return [next, ...list.slice(0, i), ...list.slice(i + 1)];
      });
    },
    [me.id, refreshList],
  );

  const markSeen = useCallback((conversationId: string) => {
    setConversations((list) => (list.some((c) => c.id === conversationId && c.unread > 0) ? list.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)) : list));
  }, []);

  const value = useMemo<MessagesContextValue>(
    () => ({
      me,
      conversations,
      canStartGroup,
      canStartDirect,
      openNewMessage: () => setNewMessageOpen(true),
      openNewGroup: () => setNewGroupOpen(true),
      noteMessage,
      markSeen,
      refreshList: () => void refreshList(),
    }),
    [me, conversations, canStartGroup, canStartDirect, noteMessage, markSeen, refreshList],
  );

  return (
    <MessagesContext.Provider value={value}>
      <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-7xl md:px-6 md:py-5">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-surface md:rounded-[var(--radius-card)] md:border md:border-line md:shadow-[var(--shadow-card)]">
          <aside
            aria-label="Conversations"
            className={cn("min-h-0 w-full flex-col border-line md:flex md:w-80 md:shrink-0 md:border-r lg:w-96", showingThread ? "hidden" : "flex")}
          >
            <ConversationList activeId={activeId} />
          </aside>
          <section className={cn("min-h-0 min-w-0 flex-1 flex-col", showingThread ? "flex" : "hidden md:flex")}>{children}</section>
        </div>
      </div>
      {canStartDirect ? <NewMessageDialog open={newMessageOpen} onOpenChange={setNewMessageOpen} leader={canStartGroup} /> : null}
      {canStartGroup ? <NewGroupDialog open={newGroupOpen} onOpenChange={setNewGroupOpen} /> : null}
    </MessagesContext.Provider>
  );
}
