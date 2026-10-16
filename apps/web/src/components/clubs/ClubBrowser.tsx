"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { Archive, ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, List, Loader2, Search, Star, X } from "lucide-react";
import type { ClubScope, ClubType } from "@prisma/client";
import { cn } from "@/components/ui/cn";
import { CLUB_SCOPE_LABEL, CLUB_SCOPES, CLUB_TYPE_LABEL, CLUB_TYPES } from "@/components/clubs/labels";
import {
  CLUB_SORTS,
  clubListHref,
  hasActiveFilters,
  SORT_LABEL,
  STATUS_FILTER_LABEL,
  STATUS_FILTERS,
  type ClubListParams,
  type ClubSort,
  type StatusFilter,
} from "@/components/clubs/list-params";

/**
 * The clubs list toolbar. Everything it changes lives in the URL, so a view
 * can be bookmarked or shared; the server re-renders the results. While the
 * new results load, the current ones stay put at reduced opacity.
 */

type College = { id: string; name: string; shortName: string; slug: string };

const selectCls =
  "h-10 w-full min-w-0 rounded-lg border border-line-2 bg-surface pl-3 pr-8 text-sm text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100";

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-3">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
        {children}
      </select>
    </div>
  );
}

export function ClubBrowser({
  params,
  colleges,
  signedIn,
  archivedCount,
  shown,
  total,
  children,
}: {
  params: ClubListParams;
  colleges: College[];
  signedIn: boolean;
  archivedCount: number;
  shown: number;
  total: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();

  const go = (patch: Partial<ClubListParams>) => startTransition(() => router.replace(clubListHref(params, patch), { scroll: false }));

  // Search as you type (debounced). Skip when the box already matches the URL.
  useEffect(() => {
    if (q.trim() === params.q) return;
    const t = setTimeout(() => go({ q: q.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // When the URL changes from elsewhere (Clear filters, back button), follow it — unless the person is typing.
  useEffect(() => {
    if (document.activeElement !== searchRef.current) setQ(params.q);
  }, [params.q]);

  const chips: { key: string; label: string; clear: Partial<ClubListParams> }[] = [];
  if (params.q) chips.push({ key: "q", label: `“${params.q}”`, clear: { q: "" } });
  if (params.type) chips.push({ key: "type", label: CLUB_TYPE_LABEL[params.type], clear: { type: null } });
  if (params.college) chips.push({ key: "college", label: colleges.find((c) => c.slug === params.college)?.name ?? "College", clear: { college: null } });
  if (params.scope) chips.push({ key: "scope", label: CLUB_SCOPE_LABEL[params.scope], clear: { scope: null } });
  if (params.status) chips.push({ key: "status", label: STATUS_FILTER_LABEL[params.status], clear: { status: null } });
  if (params.mine) chips.push({ key: "mine", label: "My clubs", clear: { mine: false } });

  const viewBtn = (v: "grid" | "list", icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => go({ view: v })}
      aria-pressed={params.view === v}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
        params.view === v ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label} view</span>
    </button>
  );

  return (
    <div>
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-card)] sm:p-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <form
            role="search"
            className="relative min-w-0 flex-1 basis-60"
            onSubmit={(e) => {
              e.preventDefault();
              go({ q: q.trim() });
            }}
          >
            <label htmlFor={searchId} className="sr-only">
              Search clubs
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, major, college…"
              autoComplete="off"
              className="h-10 w-full rounded-lg border border-line-2 bg-surface pl-9 pr-9 text-sm text-ink placeholder:text-ink-3 shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100 [&::-webkit-search-cancel-button]:hidden"
            />
            {pending ? (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-3" aria-label="Loading results" />
            ) : q ? (
              <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-3 hover:bg-muted hover:text-ink" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </form>
          {signedIn && !params.archived ? (
            <button
              type="button"
              onClick={() => go({ mine: !params.mine })}
              aria-pressed={params.mine}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                params.mine ? "border-brand-200 bg-brand-50 text-brand" : "border-line-2 bg-surface text-ink-2 hover:bg-muted",
              )}
            >
              <Star className="h-4 w-4" aria-hidden="true" fill={params.mine ? "currentColor" : "none"} /> My clubs
            </button>
          ) : null}
          <div className="inline-flex rounded-lg border border-line bg-muted p-0.5" role="group" aria-label="Layout">
            {viewBtn("grid", <LayoutGrid className="h-4 w-4" aria-hidden="true" />, "Grid")}
            {viewBtn("list", <List className="h-4 w-4" aria-hidden="true" />, "List")}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.3fr)]">
          <FilterSelect label="Type" value={params.type ?? ""} onChange={(v) => go({ type: (v || null) as ClubType | null })}>
            <option value="">All types</option>
            {CLUB_TYPES.map((t) => (
              <option key={t} value={t}>
                {CLUB_TYPE_LABEL[t]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="College" value={params.college ?? ""} onChange={(v) => go({ college: v || null, scope: v ? null : params.scope })}>
            <option value="">All colleges</option>
            {colleges.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Where" value={params.scope ?? ""} onChange={(v) => go({ scope: (v || null) as ClubScope | null, college: v && v !== "COLLEGE" ? null : params.college })}>
            <option value="">Anywhere</option>
            {CLUB_SCOPES.map((s) => (
              <option key={s} value={s}>
                {s === "COLLEGE" ? "Within a college" : CLUB_SCOPE_LABEL[s]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Status" value={params.status ?? ""} onChange={(v) => go({ status: (v || null) as StatusFilter | null })}>
            <option value="">Any status</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {STATUS_FILTER_LABEL[s]}
              </option>
            ))}
          </FilterSelect>
          <div className="col-span-2 flex min-w-0 items-end gap-2 lg:col-span-1">
            <div className="min-w-0 flex-1">
              <FilterSelect label="Sort by" value={params.sort} onChange={(v) => go({ sort: v as ClubSort })}>
                {CLUB_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABEL[s]}
                  </option>
                ))}
              </FilterSelect>
            </div>
            <button
              type="button"
              onClick={() => go({ dir: params.dir === "asc" ? "desc" : "asc" })}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line-2 bg-surface px-3 text-sm font-medium text-ink-2 shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand"
              aria-label={`Sorted ${params.dir === "asc" ? "ascending" : "descending"}. Switch to ${params.dir === "asc" ? "descending" : "ascending"}.`}
            >
              {params.dir === "asc" ? <ArrowUpNarrowWide className="h-4 w-4" aria-hidden="true" /> : <ArrowDownWideNarrow className="h-4 w-4" aria-hidden="true" />}
              <span aria-hidden="true">{dirLabel(params.sort, params.dir)}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <p className="mr-1 text-ink-2" aria-live="polite">
          {params.archived ? "Archived clubs: " : ""}
          {shown === total ? (
            <>
              <span className="font-semibold text-ink">{total}</span> {total === 1 ? "club" : "clubs"}
            </>
          ) : (
            <>
              Showing <span className="font-semibold text-ink">{shown}</span> of {total}
            </>
          )}
        </p>
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => go(c.clear)}
            className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-brand ring-1 ring-inset ring-brand-100 hover:bg-brand-100"
            aria-label={`Remove filter ${c.label}`}
          >
            {c.label} <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ))}
        {hasActiveFilters(params) ? (
          <button type="button" onClick={() => go({ q: "", type: null, college: null, scope: null, status: null, mine: false })} className="text-xs font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            Clear all
          </button>
        ) : null}
        {archivedCount > 0 || params.archived ? (
          <button
            type="button"
            onClick={() => go({ archived: !params.archived, mine: false, status: null })}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-ink-3 hover:text-ink"
            aria-pressed={params.archived}
          >
            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            {params.archived ? "Back to current clubs" : `Archived clubs (${archivedCount})`}
          </button>
        ) : null}
      </div>

      <div className={cn("mt-4 transition-opacity", pending && "pointer-events-none opacity-60")} aria-busy={pending}>
        {children}
      </div>
    </div>
  );
}

function dirLabel(sort: ClubSort, dir: "asc" | "desc") {
  const words = sort === "name" || sort === "college" || sort === "major" || sort === "type";
  if (words) return dir === "asc" ? "A–Z" : "Z–A";
  return dir === "desc" ? "High" : "Low";
}
