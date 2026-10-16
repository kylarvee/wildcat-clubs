"use client";

import { useMemo, useState } from "react";
import type { CohostStatus } from "@prisma/client";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Input } from "@/components/ui/form";
import { ClubLogo } from "@/components/ui/avatar";

export type ClubOption = { id: string; name: string; logoColor: string; logoUrl: string | null };

const STATUS: Record<CohostStatus, { label: string; tone: "warning" | "success" | "danger" }> = {
  PENDING: { label: "Waiting", tone: "warning" },
  APPROVED: { label: "Accepted", tone: "success" },
  DECLINED: { label: "Declined", tone: "danger" },
};

/**
 * Tag clubs to co-host (or invite every club). Each tagged club's leaders
 * approve before the event lands on their calendar.
 */
export function CohostPicker({
  clubs,
  value,
  onChange,
  all,
  onAllChange,
  statuses,
}: {
  clubs: ClubOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  all: boolean;
  onAllChange: (all: boolean) => void;
  /** Current invitation status per club id (saved events). */
  statuses: Record<string, CohostStatus>;
}) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(clubs.map((c) => [c.id, c])), [clubs]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? clubs.filter((c) => c.name.toLowerCase().includes(s)) : clubs).slice(0, 60);
  }, [clubs, q]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const counts = Object.values(statuses).reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {} as Partial<Record<CohostStatus, number>>);

  return (
    <div className="space-y-3">
      <Checkbox
        label="Invite all clubs"
        description="Every active club gets an invitation. Good for fairs, socials and service days."
        checked={all}
        onChange={(e) => {
          // Turning "all" off keeps the clubs that already accepted.
          if (!e.target.checked) onChange(Object.entries(statuses).filter(([, s]) => s === "APPROVED").map(([id]) => id));
          onAllChange(e.target.checked);
        }}
      />
      {all ? (
        <p className="text-sm text-ink-2">
          {Object.keys(statuses).length
            ? `${counts.APPROVED ?? 0} accepted · ${counts.PENDING ?? 0} waiting · ${counts.DECLINED ?? 0} declined`
            : "Invitations go out when you save."}
        </p>
      ) : (
        <>
          {value.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Tagged clubs">
              {value.map((id) => {
                const c = byId.get(id);
                const st = statuses[id];
                return (
                  <li key={id} className="flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-1 pr-2 text-sm">
                    <ClubLogo name={c?.name ?? "Club"} src={c?.logoUrl} color={c?.logoColor} size="sm" className="h-6 w-6 rounded-full text-[10px]" />
                    <span className="max-w-[12rem] truncate">{c?.name ?? "A club that's no longer active"}</span>
                    {st ? <Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge> : <Badge tone="info">New</Badge>}
                    <button type="button" onClick={() => toggle(id)} className="rounded-full p-0.5 text-ink-3 hover:bg-muted hover:text-ink" aria-label={`Remove ${c?.name ?? "club"}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">No co-hosts. Tag clubs you&apos;re planning this with.</p>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              // Enter picks the only match instead of submitting the event form.
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (filtered.length === 1 && !value.includes(filtered[0].id)) toggle(filtered[0].id);
              }}
              placeholder="Search clubs to tag…"
              className="pl-9"
              aria-label="Search clubs"
            />
          </div>
          <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-xl border border-line" aria-label="Clubs">
            {filtered.length === 0 ? <li className="px-3 py-4 text-center text-sm text-ink-3">No clubs match “{q}”.</li> : null}
            {filtered.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/60">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={value.includes(c.id)} onChange={() => toggle(c.id)} />
                  <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                  {statuses[c.id] ? <Badge tone={STATUS[statuses[c.id]].tone}>{STATUS[statuses[c.id]].label}</Badge> : null}
                </label>
              </li>
            ))}
          </ul>
          {clubs.length > filtered.length && !q ? <p className="text-xs text-ink-3">Showing 60 of {clubs.length} clubs — search to find others.</p> : null}
        </>
      )}
    </div>
  );
}
