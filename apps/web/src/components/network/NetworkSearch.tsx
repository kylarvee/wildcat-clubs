"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import type { NetworkViewNode } from "@/lib/analytics/network-model";
import { cn } from "@/components/ui/cn";
import { colorOf } from "./colors";

/** Find a club (or group) on the canvas: ARIA combobox; picking one focuses it and opens its details. */
export function NetworkSearch({
  nodes,
  colors,
  noun,
  onPick,
  className,
}: {
  nodes: NetworkViewNode[];
  colors: Map<string, string>;
  noun: string;
  onPick: (key: string) => void;
  className?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const starts: NetworkViewNode[] = [];
    const contains: NetworkViewNode[] = [];
    for (const n of nodes) {
      const l = n.label.toLowerCase();
      if (l.startsWith(s) || n.short.toLowerCase().startsWith(s)) starts.push(n);
      else if (l.includes(s) || n.detail.toLowerCase().includes(s)) contains.push(n);
    }
    return [...starts, ...contains].slice(0, 8);
  }, [nodes, q]);

  const pick = (n: NetworkViewNode) => {
    onPick(n.key);
    setQ(n.label);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && matches[active]) {
        e.preventDefault();
        pick(matches[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      } else if (q) setQ("");
    }
  };

  const showList = open && q.trim().length > 0;

  return (
    <div className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        Find a {noun}
      </label>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={`Find a ${noun}…`}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => q && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-lg border border-line-2 bg-surface pl-8 pr-8 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
      {q ? (
        <button
          type="button"
          onClick={() => {
            setQ("");
            inputRef.current?.focus();
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
      {showList ? (
        <ul id={listId} role="listbox" aria-label={`Matching ${noun}s`} className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-3" role="presentation">
              No {noun} matches &ldquo;{q.trim()}&rdquo;
            </li>
          ) : (
            matches.map((n, i) => (
              <li
                key={n.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(n)}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm", i === active ? "bg-brand-50" : "")}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(colors, n.collegeId) }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{n.label}</span>
                  <span className="block truncate text-xs text-ink-3">{n.detail}</span>
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
