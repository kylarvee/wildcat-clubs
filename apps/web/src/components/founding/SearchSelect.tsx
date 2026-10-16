"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/components/ui/cn";

export type SearchOption = { value: string; label: string; hint?: string | null };

/**
 * Accessible type-to-filter select (ARIA combobox pattern) for long lists like
 * departments and majors. `extraOption` is always listed last, e.g. "Other —
 * my department isn't listed".
 */
export function SearchSelect({
  id,
  options,
  value,
  onChange,
  placeholder = "Type to search…",
  extraOption,
  invalid,
  describedBy,
  name,
}: {
  id?: string;
  options: SearchOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  extraOption?: SearchOption;
  invalid?: boolean;
  describedBy?: string;
  /** Renders a hidden input so the choice posts with a plain <form>. */
  name?: string;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const listId = `${inputId}-list`;
  const all = useMemo(() => (extraOption ? [...options, extraOption] : options), [options, extraOption]);
  const selected = all.find((o) => o.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)) : options;
    const top = hits.slice(0, 60);
    return extraOption ? [...top, extraOption] : top;
  }, [options, extraOption, query]);

  function choose(o: SearchOption) {
    onChange(o.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[active]) {
        e.preventDefault();
        choose(filtered[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setQuery("");
      }
    }
  }

  const shown = open ? query : (selected?.label ?? "");
  const activeId = open && filtered[active] ? `${listId}-${active}` : undefined;

  return (
    <div className="relative">
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      <input
        ref={inputRef}
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        value={shown}
        placeholder={selected ? selected.label : placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          // Let a click on an option land before closing.
          setTimeout(() => {
            setOpen(false);
            setQuery("");
          }, 120);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "h-10 w-full rounded-lg border border-line-2 bg-surface pl-3 pr-16 text-sm text-ink shadow-sm placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100",
          invalid && "border-danger",
        )}
      />
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
        {value ? (
          <button
            type="button"
            className="rounded p-1.5 text-ink-3 hover:bg-muted hover:text-ink"
            aria-label="Clear selection"
            onClick={() => {
              onChange(null);
              inputRef.current?.focus();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
        <ChevronsUpDown className="pointer-events-none mr-1.5 h-4 w-4 text-ink-3" aria-hidden />
      </div>
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          {filtered.length === (extraOption ? 1 : 0) && query ? <li className="px-3 py-2 text-sm text-ink-3">No matches for “{query}”.</li> : null}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o)}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-sm",
                i === active ? "bg-muted" : "",
                o === extraOption && "mt-1 border-t border-line pt-2.5 font-medium text-brand-600",
              )}
            >
              <Check className={cn("mt-0.5 h-4 w-4 shrink-0", o.value === value ? "text-brand" : "invisible")} aria-hidden />
              <span className="min-w-0">
                <span className="block text-ink">{o.label}</span>
                {o.hint ? <span className="block text-xs text-ink-3">{o.hint}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
