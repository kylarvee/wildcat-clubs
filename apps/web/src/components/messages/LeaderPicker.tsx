"use client";

import { useId, useState } from "react";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import type { PersonResult } from "@/lib/domain/messaging";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/form";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";

export type PickedLeader = Pick<PersonResult, "id" | "name" | "avatarUrl" | "avatarColor" | "context">;

/**
 * Multi-select search over current club leaders and advisors (anyone at
 * Weber State who leads a club). Chosen people show as removable chips.
 * Pass conversationId to leave out people already in that group.
 */
export function LeaderPicker({
  value,
  onChange,
  conversationId,
  label = "Add leaders",
  max,
}: {
  value: PickedLeader[];
  onChange: (next: PickedLeader[]) => void;
  conversationId?: string | null;
  label?: string;
  max?: number;
}) {
  const [q, setQ] = useState("");
  const searchId = useId();
  const search = usePeopleSearch(q, "leaders", conversationId);
  const picked = new Set(value.map((p) => p.id));
  const full = max !== undefined && value.length >= max;

  function toggle(p: PersonResult) {
    if (picked.has(p.id)) onChange(value.filter((v) => v.id !== p.id));
    else if (!full) onChange([...value, { id: p.id, name: p.name, avatarUrl: p.avatarUrl, avatarColor: p.avatarColor, context: p.context }]);
  }

  return (
    <div className="space-y-2">
      <label htmlFor={searchId} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {value.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Chosen leaders">
          {value.map((p) => (
            <li key={p.id} className="flex items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pl-0.5 pr-1 text-sm text-brand-700">
              <Avatar name={p.name} src={p.avatarUrl} color={p.avatarColor} size="xs" className="ring-0" />
              <span className="max-w-40 truncate">{p.name}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v.id !== p.id))}
                className="rounded-full p-0.5 hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-brand"
                aria-label={`Remove ${p.name}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
        <Input
          id={searchId}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search leaders by name or email"
          className="pl-9"
          autoComplete="off"
        />
      </div>
      <div aria-live="polite" aria-busy={search.status === "loading"}>
        {search.status === "idle" ? (
          <p className="px-1 text-xs text-ink-3">Presidents, VPs, officers, ambassadors and advisors of any club. Type at least two letters.</p>
        ) : search.status === "loading" && !search.results.length ? (
          <p className="flex items-center gap-2 px-1 py-2 text-sm text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching…
          </p>
        ) : search.status === "error" ? (
          <p className="px-1 py-2 text-sm text-danger">{search.error}</p>
        ) : search.results.length === 0 ? (
          <p className="px-1 py-2 text-sm text-ink-3">No current club leader matches “{search.term}”.</p>
        ) : (
          <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {search.results.map((p) => {
              const on = picked.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    aria-pressed={on}
                    disabled={!on && full}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-50",
                      on ? "bg-brand-50" : "hover:bg-muted/70",
                    )}
                  >
                    <Avatar name={p.name} src={p.avatarUrl} color={p.avatarColor} size="sm" className="ring-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                      <span className="block truncate text-xs text-ink-3">{p.context ?? "Club leader"}</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border", on ? "border-brand bg-brand text-white" : "border-line-2 text-ink-3")}
                    >
                      {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
