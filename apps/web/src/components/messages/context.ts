"use client";

import { createContext, useContext } from "react";
import type { ConversationListItem, MessageView, PersonRef } from "@/lib/domain/messaging";

/** Shared state between the Messages list and the open thread (provided by <MessagesShell>). */
export type MessagesContextValue = {
  me: PersonRef;
  conversations: ConversationListItem[];
  canStartGroup: boolean;
  /** Alumni accounts read their history but can't start conversations. */
  canStartDirect: boolean;
  openNewMessage: () => void;
  openNewGroup: () => void;
  /** A message appeared in a thread you're viewing: move the conversation up and update its preview. */
  noteMessage: (conversationId: string, message: MessageView) => void;
  /** You've read a conversation: clear its unread count. */
  markSeen: (conversationId: string) => void;
  refreshList: () => void;
};

export const MessagesContext = createContext<MessagesContextValue | null>(null);

export function useMessages(): MessagesContextValue {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error("useMessages must be used inside <MessagesShell>.");
  return ctx;
}
