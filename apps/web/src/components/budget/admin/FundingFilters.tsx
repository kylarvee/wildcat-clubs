"use client";

import { useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

/**
 * Source and club filters for the admin funding queue. Each select changes
 * one filter and keeps the other and the queue tab.
 */
export function FundingFilters({
  basePath,
  queue,
  sources,
  clubs,
  source,
  clubId,
}: {
  basePath: string;
  /** The queue tab to keep (omitted for the default tab). */
  queue: string | null;
  sources: { value: string; label: string }[];
  clubs: { id: string; name: string }[];
  source: string | null;
  clubId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const sourceId = useId();
  const clubFieldId = useId();

  function go(next: { source: string | null; club: string | null }) {
    const qs = new URLSearchParams();
    if (queue) qs.set("queue", queue);
    if (next.source) qs.set("source", next.source);
    if (next.club) qs.set("club", next.club);
    const s = qs.toString();
    start(() => router.push(s ? `${basePath}?${s}` : basePath, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filter requests">
      <div className="w-full min-w-0 sm:w-48">
        <label htmlFor={sourceId} className="mb-1 block text-xs font-medium text-ink-3">
          Funding source
        </label>
        <Select id={sourceId} value={source ?? ""} onChange={(e) => go({ source: e.target.value || null, club: clubId })} disabled={pending} className="h-9">
          <option value="">Every source</option>
          {sources.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-full min-w-0 sm:w-64">
        <label htmlFor={clubFieldId} className="mb-1 block text-xs font-medium text-ink-3">
          Club
        </label>
        <Select id={clubFieldId} value={clubId ?? ""} onChange={(e) => go({ source, club: e.target.value || null })} disabled={pending} className="h-9">
          <option value="">Every club</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      {source || clubId ? (
        <Button variant="ghost" size="sm" onClick={() => go({ source: null, club: null })} disabled={pending}>
          <X className="h-4 w-4" aria-hidden /> Clear filters
        </Button>
      ) : null}
      {pending ? <Loader2 className="mb-2 h-4 w-4 animate-spin text-ink-3" aria-label="Loading requests" /> : null}
    </div>
  );
}
