"use client";

import { MessageSquarePlus, MessagesSquare, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/components/messages/context";

/** The right pane before a conversation is picked (computers and tablets; phones show the list instead). */
export function MessagesHome() {
  const { conversations, canStartGroup, canStartDirect, openNewMessage, openNewGroup } = useMessages();
  const unread = conversations.filter((c) => c.unread > 0).length;
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand">
        <MessagesSquare className="h-7 w-7" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-ink">{unread ? `You have unread messages in ${unread} ${unread === 1 ? "conversation" : "conversations"}` : "Pick a conversation"}</h2>
      <p className="mt-1 max-w-md text-sm text-ink-3">
        {canStartDirect ? (
          <>
            Each of your clubs has a group chat. You can also message anyone who shares a club with you
            {canStartGroup ? ", message the leaders of any club, and start leader groups across clubs." : "."}
          </>
        ) : (
          "Alumni accounts keep their message history to read, but can't start or send new messages."
        )}
      </p>
      {canStartDirect ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={openNewMessage}>
            <MessageSquarePlus className="h-4 w-4" aria-hidden="true" /> New message
          </Button>
          {canStartGroup ? (
            <Button variant="outline" onClick={openNewGroup}>
              <Users className="h-4 w-4" aria-hidden="true" /> New leader group
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
