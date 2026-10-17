"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Lock, MessageSquarePlus, Plus, Search, Users } from "lucide-react";
import type { ConversationListItem } from "@/lib/domain/messaging";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { ConversationAvatar } from "@/components/messages/ConversationAvatar";
import { useMessages } from "@/components/messages/context";
import { listStamp } from "@/components/messages/format";

type Filter = "all" | "unread" | "clubs" | "direct" | "groups";

const FILTER_LABEL: Record<Filter, string> = { all: "All", unread: "Unread", clubs: "Clubs", direct: "Direct", groups: "Groups" };

function matches(c: ConversationListItem, filter: Filter) {
  switch (filter) {
    case "unread":
      return c.unread > 0;
    case "clubs":
      return c.type === "CLUB";
    case "direct":
      return c.type === "DIRECT";
    case "groups":
      return c.type === "LEADERS_GROUP";
    default:
      return true;
  }
}

const EMPTY_FILTER: Record<Filter, string> = {
  all: "",
  unread: "You're all caught up.",
  clubs: "No club chats yet. Register for a club to join its chat.",
  direct: "No direct messages yet.",
  groups: "No leader groups yet.",
};

/** The left pane: every conversation, most recent first, with search and quick filters. */
export function ConversationList({ activeId }: { activeId: string | null }) {
  const { conversations, canStartGroup, canStartDirect, openNewMessage, openNewGroup } = useMessages();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filters: Filter[] = useMemo(() => {
    const out: Filter[] = ["all", "unread", "clubs", "direct"];
    if (canStartGroup || conversations.some((c) => c.type === "LEADERS_GROUP")) out.push("groups");
    return out;
  }, [canStartGroup, conversations]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return conversations.filter((c) => matches(c, filter) && (!term || c.name.toLowerCase().includes(term) || c.people.some((p) => p.name.toLowerCase().includes(term)) || (c.preview ?? "").toLowerCase().includes(term)));
  }, [conversations, filter, q]);

  const unreadTotal = conversations.filter((c) => c.unread > 0).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold tracking-tight text-ink">
            Messages
            {unreadTotal ? <span className="sr-only"> ({unreadTotal} with unread messages)</span> : null}
          </h1>
          {canStartGroup ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4" aria-hidden="true" /> New
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {/* Opened after the menu closes, so focus moves into the dialog cleanly. */}
                <DropdownMenuItem onSelect={() => setTimeout(openNewMessage, 0)}>
                  <MessageSquarePlus className="h-4 w-4 text-ink-3" aria-hidden="true" /> New message
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(openNewGroup, 0)}>
                  <Users className="h-4 w-4 text-ink-3" aria-hidden="true" /> New leader group
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : canStartDirect ? (
            <Button size="sm" onClick={openNewMessage}>
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" /> New message
            </Button>
          ) : null}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" className="h-9 pl-9" autoComplete="off" />
        </div>
        <div role="group" aria-label="Filter conversations" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                filter === f ? "bg-brand text-white" : "bg-muted text-ink-2 hover:bg-brand-50 hover:text-brand",
              )}
            >
              {FILTER_LABEL[f]}
              {f === "unread" && unreadTotal ? <span className="ml-1 tabular-nums">{unreadTotal}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <nav aria-label="Your conversations" className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-medium text-ink">No conversations yet</p>
            <p className="mt-1 text-sm text-ink-3">
              Every club you register for has a group chat that shows up here. You can also message people who share a club with you.
            </p>
            <Link href="/clubs" className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">
              Browse clubs
            </Link>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-ink-3">{q.trim() ? `Nothing matches “${q.trim()}”.` : EMPTY_FILTER[filter]}</p>
        ) : (
          <ul className="py-1">
            {shown.map((c) => (
              <li key={c.id}>
                <ConversationRow c={c} active={c.id === activeId} />
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}

function ConversationRow({ c, active }: { c: ConversationListItem; active: boolean }) {
  const unread = c.unread > 0 && !active;
  const kind = c.type === "CLUB" ? "Club chat" : c.type === "DIRECT" ? "Direct message" : "Leader group";
  return (
    <Link
      href={`/messages/${c.id}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 px-4 py-2.5 outline-none transition-colors focus-visible:bg-brand-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
        active ? "bg-brand-50" : "hover:bg-muted/70",
      )}
    >
      {active ? <span className="absolute inset-y-1 left-0 w-1 rounded-r bg-brand" aria-hidden="true" /> : null}
      <ConversationAvatar type={c.type} club={c.club} person={c.people[0]} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold text-ink" : "font-medium text-ink")}>{c.name}</span>
          <time dateTime={c.lastMessageAt} className={cn("shrink-0 text-xs tabular-nums", unread ? "font-semibold text-brand" : "text-ink-3")} suppressHydrationWarning>
            {listStamp(c.lastMessageAt)}
          </time>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-xs", unread ? "text-ink-2" : "text-ink-3")}>
            <span className="sr-only">{kind}. </span>
            {c.preview ?? (c.type === "CLUB" ? "No messages yet. Say hi!" : "No messages yet")}
          </span>
          {!c.canSend ? (
            <span className="shrink-0 text-ink-3" title="Read-only">
              <Lock className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Read-only</span>
            </span>
          ) : null}
          {unread ? (
            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold tabular-nums text-white">
              {c.unread > 99 ? "99+" : c.unread}
              <span className="sr-only"> unread</span>
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}
