"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search, SearchX, X } from "lucide-react";
import type { ClubType } from "@prisma/client";
import {
  CLUB_TYPE_NAMES,
  DEFAULT_FILTERS,
  MISSING_FILTERS,
  STAGES,
  defaultDir,
  filterRows,
  filtersToQuery,
  hasFilters,
  missingLeaders,
  sortRows,
  type ClubAnalyticsRow,
  type MissingLeader,
  type SortKey,
  type StageFilter,
  type TableFilters,
} from "@/lib/analytics/club-table";
import { CLUB_SCOPE_LABEL } from "@/components/clubs/labels";
import { Button, buttonClasses } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { StageBadge } from "./StageBadge";

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (r: number | null) => (r === null ? null : `${Math.round(r * 100)}%`);
const NONE = <span className="text-ink-3">—</span>;
const missingLabel = (k: MissingLeader) => MISSING_FILTERS.find((m) => m.key === k)!.label;

type Column = { key: SortKey; label: string; sub?: string; numeric?: boolean; className?: string };

/**
 * Every club's numbers in one sortable, filterable table. Filters and sort
 * live in the URL (shareable, and the CSV export reads the same query).
 * The club column stays pinned while the numbers scroll sideways on phones.
 */
export function ClubAnalyticsTable({
  rows,
  colleges,
  termName,
  initial,
  activeDays,
  activeEvents,
}: {
  rows: ClubAnalyticsRow[];
  colleges: { id: string; name: string; shortName: string }[];
  termName: string | null;
  initial: TableFilters;
  /** The active-student rule from system config (activity.studentWindowDays / activity.studentRecentEvents). */
  activeDays: number;
  activeEvents: number;
}) {
  const [f, setF] = useState<TableFilters>(initial);
  const ids = useId();
  const term = termName ?? "this term";

  // Keep the address bar in step so a filtered view can be shared or reloaded.
  useEffect(() => {
    const qs = filtersToQuery(f);
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
  }, [f]);

  const shown = useMemo(() => sortRows(filterRows(rows, f), f.sort, f.dir), [rows, f]);
  const set = (patch: Partial<TableFilters>) => setF((prev) => ({ ...prev, ...patch }));
  const sortBy = (key: SortKey) => setF((prev) => (prev.sort === key ? { ...prev, dir: prev.dir === "asc" ? "desc" : "asc" } : { ...prev, sort: key, dir: defaultDir(key) }));
  const exportQs = filtersToQuery(f);
  const hasNoCollege = rows.some((r) => !r.collegeId);
  const usedTypes = (Object.keys(CLUB_TYPE_NAMES) as ClubType[]).filter((t) => rows.some((r) => r.type === t));

  const columns: Column[] = [
    { key: "name", label: "Club" },
    { key: "stage", label: "Status" },
    { key: "registered", label: "Members", sub: "registered", numeric: true },
    { key: "active", label: "Attending", sub: "members lately", numeric: true },
    { key: "retention", label: "Retention", sub: "latest full months", numeric: true },
    { key: "attendance", label: "Attendance", sub: "avg. this term", numeric: true },
    { key: "events", label: "Events", sub: "this term", numeric: true },
    { key: "rating", label: "Rating", sub: "of 5", numeric: true },
    { key: "connections", label: "Connections", sub: "12 months", numeric: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 sm:w-60">
          <label htmlFor={`${ids}-q`} className="mb-1 block text-xs font-medium text-ink-3">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input
              id={`${ids}-q`}
              type="search"
              value={f.q}
              onChange={(e) => set({ q: e.target.value })}
              placeholder="Club name"
              autoComplete="off"
              className="h-9 w-full rounded-lg border border-line-2 bg-surface pl-8 pr-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>
        <FilterSelect id={`${ids}-college`} label="College" value={f.college ?? ""} onChange={(v) => set({ college: v || null })}>
          <option value="">All colleges</option>
          {colleges.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {hasNoCollege ? <option value="none">Not in a college</option> : null}
        </FilterSelect>
        <FilterSelect id={`${ids}-type`} label="Type" value={f.type ?? ""} onChange={(v) => set({ type: (v || null) as ClubType | null })}>
          <option value="">All types</option>
          {usedTypes.map((t) => (
            <option key={t} value={t}>
              {CLUB_TYPE_NAMES[t]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect id={`${ids}-status`} label="Status" value={f.stage ?? ""} onChange={(v) => set({ stage: (v || null) as StageFilter | null })}>
          <option value="">Every club</option>
          <option value="approved">All approved</option>
          {STAGES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect id={`${ids}-missing`} label="Leaders" value={f.missing ?? ""} onChange={(v) => set({ missing: (v || null) as MissingLeader | null })}>
          <option value="">Any</option>
          {MISSING_FILTERS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </FilterSelect>
        {hasFilters(f) ? (
          <Button variant="ghost" size="sm" className="h-9" onClick={() => setF({ ...DEFAULT_FILTERS, sort: f.sort, dir: f.dir })}>
            <X className="h-4 w-4" aria-hidden="true" /> Clear filters
          </Button>
        ) : null}
        <a
          href={`/admin/analytics/export${exportQs ? `?${exportQs}` : ""}`}
          className={buttonClasses("outline", "sm", "h-9 sm:ml-auto")}
          download
          aria-disabled={shown.length === 0 || undefined}
          onClick={(e) => {
            if (shown.length === 0) e.preventDefault();
          }}
        >
          <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
        </a>
      </div>

      <p className="text-sm text-ink-3" aria-live="polite">
        {shown.length === rows.length ? `${fmt(rows.length)} ${rows.length === 1 ? "club" : "clubs"}` : `Showing ${fmt(shown.length)} of ${fmt(rows.length)} clubs`}
        {" · "}sorted by {columns.find((c) => c.key === f.sort)!.label.toLowerCase()}, {sortPhrase(f)}
      </p>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface px-6 py-12 text-center">
          <SearchX className="mb-3 h-8 w-8 text-ink-3" aria-hidden="true" />
          <p className="font-medium text-ink">No clubs match these filters</p>
          <p className="mt-1 max-w-md text-sm text-ink-3">Try another college or status, or clear the filters to see every club.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setF({ ...DEFAULT_FILTERS, sort: f.sort, dir: f.dir })}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <caption className="sr-only">
              Club analytics, {shown.length} clubs. Column headers sort the table.
            </caption>
            <thead className="bg-muted/60 text-xs text-ink-3">
              <tr>
                {columns.map((c, i) => {
                  const active = f.sort === c.key;
                  const Icon = !active ? ArrowUpDown : f.dir === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (f.dir === "asc" ? "ascending" : "descending") : undefined}
                      // Positioned, so the screen-reader text inside stays within the scrolling table.
                      className={cn("relative px-2 py-2 align-bottom font-medium", c.numeric ? "text-right" : "text-left", i === 0 && "sticky left-0 z-[1] bg-[#f6f5f8] pl-4")}
                    >
                      <button
                        type="button"
                        onClick={() => sortBy(c.key)}
                        className={cn(
                          "group inline-flex items-start gap-1 rounded-md py-0.5 uppercase hover:text-ink focus-visible:outline-2 focus-visible:outline-brand",
                          c.numeric && "flex-row-reverse text-right",
                          active && "text-ink",
                        )}
                      >
                        <span>
                          <span className="block whitespace-nowrap">{c.label}</span>
                          {c.sub ? <span className="block whitespace-nowrap text-[11px] font-normal normal-case tracking-normal text-ink-3">{c.sub}</span> : null}
                        </span>
                        <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", active ? "text-brand" : "text-ink-3/60 group-hover:text-ink-3")} aria-hidden="true" />
                        <span className="sr-only">{active ? `, sorted ${f.dir === "asc" ? "ascending" : "descending"}. Select to reverse.` : ". Select to sort."}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => {
                const live = r.status === "APPROVED" || r.status === "RETIRED";
                const missing = missingLeaders(r);
                return (
                  <tr key={r.id} className="group hover:bg-muted/40">
                    <th scope="row" className="sticky left-0 z-[1] w-[13.5rem] max-w-[13.5rem] bg-surface py-2.5 pl-4 pr-2 text-left font-normal group-hover:bg-[#faf9fb]">
                      <Link href={`/admin/analytics/${r.id}`} className="font-medium text-ink hover:text-brand-600 hover:underline">
                        {r.name}
                      </Link>
                      <span className="block truncate text-xs text-ink-3" title={r.collegeName ?? undefined}>
                        {CLUB_TYPE_NAMES[r.type]} · {r.collegeShort ?? (r.scope === "COLLEGE" ? "No college set" : CLUB_SCOPE_LABEL[r.scope])}
                      </span>
                    </th>
                    <td className="whitespace-nowrap px-2 py-2.5">
                      <StageBadge row={r} />
                      {missing.length ? <span className="mt-1 block text-xs text-ink-3">{missing.map(missingLabel).join(" · ")}</span> : null}
                    </td>
                    <Num>{fmt(r.registered)}</Num>
                    <Num>{live ? fmt(r.active) : NONE}</Num>
                    <Num title={r.retentionSummary?.label}>
                      {pct(r.retention) ?? NONE}
                      {r.retentionSummary ? <span className="block text-xs text-ink-3">{r.retentionSummary.months}</span> : null}
                    </Num>
                    <Num>{pct(r.avgAttendance) ?? NONE}</Num>
                    <Num>{live ? fmt(r.heldEvents) : NONE}</Num>
                    <Num>
                      {r.rating === null ? (
                        NONE
                      ) : (
                        <>
                          {r.rating.toFixed(1)}
                          <span className="ml-1 text-xs text-ink-3">({fmt(r.reviews)})</span>
                        </>
                      )}
                    </Num>
                    <Num>
                      {r.connections ? (
                        <>
                          <span className="block">{fmt(r.connections)} {r.connections === 1 ? "club" : "clubs"}</span>
                          <span className="block text-xs text-ink-3">{fmt(r.crossCheckins)} check-ins</span>
                        </>
                      ) : (
                        NONE
                      )}
                    </Num>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs leading-relaxed text-ink-3">
        This term is {term}. Attending members checked in within {activeDays} days or at one of the club&rsquo;s last {activeEvents} events. Retention is the share of one full month&rsquo;s attendees who came back the next full month, for the latest two months in a row with check-ins (&ldquo;Sep → Oct: 62% came back&rdquo;).
        Attendance is the average share of members at each event with check-ins. Connections count members of one club checking in at another&rsquo;s events.
        No President and No advisor list approved clubs with nobody in a President seat, or without a faculty or staff advisor, right now.
      </p>
    </div>
  );
}

function sortPhrase(f: TableFilters) {
  const asc = f.dir === "asc";
  if (f.sort === "name") return asc ? "A to Z" : "Z to A";
  if (f.sort === "stage") return asc ? "active clubs first" : "retired and unapproved first";
  return asc ? "lowest first" : "highest first";
}

function Num({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-ink" title={title}>
      {children}
    </td>
  );
}

function FilterSelect({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1 basis-40 sm:max-w-56 sm:flex-none">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-3">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full py-0 text-sm">
        {children}
      </Select>
    </div>
  );
}
