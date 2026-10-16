"use client";

import { useId, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/form";

export type PickerPerson = {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  avatarColor: string;
  /** Seats they already hold, shown as context. */
  seats?: string[];
  /** Shown instead of being pickable (e.g. "Already President"). */
  disabledReason?: string;
  note?: string;
};

/**
 * Searchable single-choice list of people (radio semantics, keyboard
 * friendly). Used for assigning seats, hand-offs, nominations and placements.
 */
export function PersonPicker({
  people,
  value,
  onChange,
  label = "Choose a person",
  emptyText = "No one matches.",
  maxHeight = 280,
}: {
  people: PickerPerson[];
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
  emptyText?: string;
  maxHeight?: number;
}) {
  const [q, setQ] = useState("");
  const name = useId();
  const searchId = useId();
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return people;
    return people.filter((p) => p.name.toLowerCase().includes(t) || p.handle.toLowerCase().includes(t) || p.seats?.some((s) => s.toLowerCase().includes(t)));
  }, [people, q]);

  return (
    <div className="space-y-2">
      <label htmlFor={searchId} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input id={searchId} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${people.length} ${people.length === 1 ? "person" : "people"}…`} className="pl-9" autoComplete="off" />
      </div>
      <div role="radiogroup" aria-label={label} className="overflow-y-auto rounded-xl border border-line" style={{ maxHeight }}>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-3">{people.length === 0 ? emptyText : `No one matches “${q}”.`}</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((p) => {
              const selected = value === p.id;
              const disabled = Boolean(p.disabledReason);
              return (
                <li key={p.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2.5 focus-within:bg-brand-50/60",
                      selected ? "bg-brand-50" : "hover:bg-muted/60",
                      disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
                    )}
                  >
                    <input type="radio" name={name} value={p.id} checked={selected} disabled={disabled} onChange={() => onChange(p.id)} className="sr-only" />
                    <Avatar name={p.name} src={p.avatarUrl} color={p.avatarColor} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {p.disabledReason ?? p.note ?? (p.seats?.length ? p.seats.join(" · ") : `@${p.handle}`)}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-brand bg-brand text-white" : "border-line-2 bg-surface")}
                    >
                      {selected ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
