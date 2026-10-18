"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type FeedSource = { key: string; label: string };
export type FeedItem = { id: string; source: string; node: ReactNode };

/**
 * Source chips over a list of server-rendered announcements (All · WSUSA ·
 * each club). Filtering happens in the browser, over the posts already loaded.
 */
export function FeedFilter({ sources, items }: { sources: FeedSource[]; items: FeedItem[] }) {
  const [pick, setPick] = useState("all");
  const shown = pick === "all" ? items : items.filter((i) => i.source === pick);
  const chips = [{ key: "all", label: "All" }, ...sources];
  return (
    <>
      {sources.length > 1 ? (
        <div role="group" aria-label="Show announcements from" className="mb-4 flex flex-wrap gap-2">
          {chips.map((c) => {
            const on = pick === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => setPick(c.key)}
                className={cn(
                  "inline-flex h-9 max-w-full items-center rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  on ? "border-brand bg-brand font-semibold text-white" : "border-line-2 bg-surface font-medium text-ink-2 hover:bg-muted hover:text-ink",
                )}
              >
                <span className="truncate">{c.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <ul className="space-y-3">
        {shown.map((i) => (
          <li key={i.id}>{i.node}</li>
        ))}
      </ul>
    </>
  );
}
