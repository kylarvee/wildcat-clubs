"use client";

import { useState } from "react";
import { MessageSquareText, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";
import { fmtAgo } from "@/lib/time";
import type { ConversationSummary } from "@/lib/ai/types";

/** Past conversations, newest first, each with a delete button. */
export function ConversationList({
  conversations,
  activeId,
  onOpen,
  onDeleted,
  locked = false,
  className,
}: {
  conversations: ConversationSummary[] | null;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDeleted: (id: string) => void;
  /** An answer is streaming: switching or deleting waits until it's done. */
  locked?: boolean;
  className?: string;
}) {
  const [confirming, setConfirming] = useState<ConversationSummary | null>(null);

  const remove = async (c: ConversationSummary) => {
    try {
      const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(c.id)}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "That conversation couldn't be deleted.");
      onDeleted(c.id);
      toast.success("Conversation deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That conversation couldn't be deleted.");
    }
  };

  if (conversations === null) {
    return (
      <p className={cn("px-3 py-6 text-center text-sm text-ink-3", className)} role="status">
        Loading your conversations…
      </p>
    );
  }
  if (conversations.length === 0) {
    return (
      <div className={cn("flex flex-col items-center px-4 py-10 text-center", className)}>
        <MessageSquareText className="mb-2 h-7 w-7 text-ink-3" aria-hidden />
        <p className="text-sm font-medium text-ink">No conversations yet</p>
        <p className="mt-1 text-xs text-ink-3">Ask something and it'll be saved here, just for you.</p>
      </div>
    );
  }
  return (
    <>
      {locked ? <p className="px-3 pb-1 pt-0.5 text-xs text-ink-3">You can switch conversations once the current answer finishes.</p> : null}
      <ul className={cn("space-y-0.5", className)}>
        {conversations.map((c) => {
          const active = c.id === activeId;
          return (
            <li key={c.id} className={cn("group flex items-center gap-1 rounded-lg", active ? "bg-brand-50" : "hover:bg-muted")}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                disabled={locked && !active}
                aria-current={active ? "true" : undefined}
                className="min-w-0 flex-1 rounded-lg px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className={cn("block truncate text-sm", active ? "font-semibold text-brand" : "font-medium text-ink")}>{c.title}</span>
                <span className="block text-xs text-ink-3" suppressHydrationWarning>
                  {fmtAgo(c.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setConfirming(c)}
                disabled={locked}
                aria-label={`Delete “${c.title}”`}
                className="mr-1 shrink-0 rounded-md p-1.5 text-ink-3 hover:bg-surface hover:text-danger focus-visible:outline-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-30 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Delete this conversation?"
        description={confirming ? `“${confirming.title}” is removed for good. Anything the assistant already did for you stays done.` : undefined}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          const c = confirming;
          setConfirming(null);
          if (c) void remove(c);
        }}
      />
    </>
  );
}
