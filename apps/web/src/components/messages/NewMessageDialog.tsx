"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Search } from "lucide-react";
import type { PersonResult } from "@/lib/domain/messaging";
import { startDirectAction } from "@/app/messages/actions";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";

/** Find someone you're allowed to message and open (or start) your conversation with them. */
export function NewMessageDialog({ open, onOpenChange, leader }: { open: boolean; onOpenChange: (open: boolean) => void; leader: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New message"
        description={leader ? "Message anyone in your clubs, or the leaders of any club at Weber State." : "Message anyone who's in one of your clubs."}
      >
        {/* Mounted only while open, so each visit starts with an empty search. */}
        {open ? <PeopleFinder onDone={() => onOpenChange(false)} leader={leader} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PeopleFinder({ onDone, leader }: { onDone: () => void; leader: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = usePeopleSearch(q, "dm");
  const listRef = useRef<HTMLUListElement>(null);

  async function choose(p: PersonResult) {
    setError(null);
    if (p.conversationId) {
      router.push(`/messages/${p.conversationId}`);
      onDone();
      return;
    }
    setOpening(p.id);
    try {
      const r = await startDirectAction(p.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/messages/${r.data.id}`);
      onDone();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setOpening(null);
    }
  }

  /** Arrow keys move between the search box and the results. */
  function onListKey(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    if (e.key === "ArrowDown") buttons[Math.min(i + 1, buttons.length - 1)]?.focus();
    else if (i <= 0) document.getElementById("new-message-search")?.focus();
    else buttons[i - 1]?.focus();
  }

  return (
    <div className="space-y-3" onKeyDown={onListKey}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
        <Input
          id="new-message-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search people"
          className="pl-9"
          autoComplete="off"
          autoFocus
        />
      </div>

      {error ? <Callout tone="danger">{error}</Callout> : null}

      <div className="min-h-40" aria-live="polite" aria-busy={search.status === "loading"}>
        {search.status === "idle" ? (
          <p className="px-1 py-6 text-center text-sm text-ink-3">Type at least two letters of a name.</p>
        ) : search.status === "loading" && !search.results.length ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching…
          </p>
        ) : search.status === "error" ? (
          <p className="py-6 text-center text-sm text-danger">{search.error}</p>
        ) : search.results.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-ink-3">
            <p className="font-medium text-ink-2">No one you can message matches “{search.term}”.</p>
            <p className="mt-1">
              {leader
                ? "You can message people who share a club with you and the leaders of any club."
                : "You can message people who share a club with you. Register for more clubs to meet more people."}
            </p>
          </div>
        ) : (
          <ul ref={listRef} className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line" aria-label="People you can message">
            {search.results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => void choose(p)}
                  disabled={opening !== null}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-muted/70 focus-visible:bg-brand-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-60"
                >
                  <Avatar name={p.name} src={p.avatarUrl} color={p.avatarColor} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                    <span className="block truncate text-xs text-ink-3">{p.context ?? `@${p.handle}`}</span>
                  </span>
                  {opening === p.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" aria-label="Opening" />
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-ink-3">
                      {p.conversationId ? "Open chat" : null}
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
