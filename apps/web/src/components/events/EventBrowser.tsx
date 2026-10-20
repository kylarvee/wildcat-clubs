"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import type { ClubCategory, EventKind } from "@prisma/client";
import { CalendarDays, Cast, ChevronDown, Gift, HeartHandshake, LayoutList, Loader2, Search, SlidersHorizontal, Star, UtensilsCrossed, X, type LucideIcon } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { CLUB_CATEGORIES, CLUB_CATEGORY_LABEL } from "@/lib/labels/clubs";
import { EVENT_KINDS, KIND_LABEL } from "@/lib/events/labels";
import {
  CLEARED,
  DATE_SHORTCUT_LABEL,
  DATE_SHORTCUTS,
  EVENT_SCOPES,
  eventsHref,
  hasFilters,
  SCOPE_LABEL,
  type EventBrowseParams,
  type EventScope,
} from "@/lib/events/browse-params";

/**
 * The Events page toolbar: Mine or All of Weber State, List or Month, the
 * search box, date shortcuts and the filters. Everything it changes lives in
 * the URL, so a view can be shared; the server renders the results, which
 * stay put at reduced opacity while the next ones load.
 */

const selectCls =
  "h-10 w-full min-w-0 rounded-lg border border-line-2 bg-surface pl-3 pr-8 text-sm text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100";

/** Two or three buttons where one is on. `iconOnlyOnPhones` keeps a row of them narrow on small screens (the label stays for screen readers). */
function Segmented<T extends string>({
  label,
  value,
  options,
  labels,
  icons,
  iconOnlyOnPhones,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  icons?: Partial<Record<T, LucideIcon>>;
  iconOnlyOnPhones?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line bg-muted p-0.5">
      {options.map((o) => {
        const Icon: LucideIcon | undefined = icons?.[o];
        return (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
              value === o ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
            )}
          >
            {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
            {iconOnlyOnPhones && Icon ? (
              <>
                <span className="hidden sm:inline">{labels[o]}</span>
                <span className="sr-only sm:hidden">{labels[o]}</span>
              </>
            ) : (
              labels[o]
            )}
          </button>
        );
      })}
    </div>
  );
}

function Chip({ on, onClick, icon: Icon, children }: { on: boolean; onClick: () => void; icon?: LucideIcon; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        on ? "border-brand-200 bg-brand-50 text-brand" : "border-line-2 bg-surface text-ink-2 hover:bg-muted",
      )}
    >
      {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function EventBrowser({
  params,
  scope,
  signedIn,
  loginHref,
  summary,
  children,
}: {
  params: EventBrowseParams;
  /** The scope in effect (the URL's, or the viewer's default). */
  scope: EventScope;
  signedIn: boolean;
  loginHref: string;
  /** "42 events · This weekend · Fri, Oct 23 – Sun, Oct 25" (list view). */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q);
  // Phones: the type, category and toggle filters fold away under "Filters" so the events show sooner.
  const [moreOpen, setMoreOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const moreId = useId();
  const typeId = useId();
  const categoryId = useId();
  const dateId = useId();
  const month = params.view === "month";

  const go = (patch: Partial<EventBrowseParams>) => startTransition(() => router.replace(eventsHref(params, patch), { scroll: false }));

  // Search as you type (debounced). Skip when the box already matches the URL.
  useEffect(() => {
    if (q.trim() === params.q) return;
    const t = setTimeout(() => go({ q: q.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Follow the URL when it changes from elsewhere (Clear all, back button), unless the person is typing.
  useEffect(() => {
    if (document.activeElement !== searchRef.current) setQ(params.q);
  }, [params.q]);

  const toggles: { key: "food" | "stuff" | "service" | "online" | "following"; label: string; icon: LucideIcon }[] = [
    { key: "food", label: "Free food", icon: UtensilsCrossed },
    { key: "stuff", label: "Free stuff", icon: Gift },
    { key: "service", label: "Service hours", icon: HeartHandshake },
    { key: "online", label: "Online or hybrid", icon: Cast },
    ...(signedIn ? [{ key: "following" as const, label: "Clubs I follow", icon: Star }] : []),
  ];
  const moreCount = [params.type, params.category].filter(Boolean).length;

  return (
    <div>
      <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-card)] sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {signedIn ? (
            <Segmented label="Whose events" value={scope} options={EVENT_SCOPES} labels={SCOPE_LABEL} onChange={(s) => go({ scope: s })} />
          ) : (
            <p className="text-sm text-ink-2">
              <Link href={loginHref} className="font-medium text-brand-600 hover:underline">
                Sign in
              </Link>{" "}
              to see the clubs you follow, members-only events included.
            </p>
          )}
          <Segmented label="Layout" value={params.view} options={["list", "month"] as const} labels={{ list: "List", month: "Month" }} icons={{ list: LayoutList, month: CalendarDays }} iconOnlyOnPhones onChange={(v) => go({ view: v })} />
        </div>

        <form
          role="search"
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() });
          }}
        >
          <label htmlFor={searchId} className="sr-only">
            Search events
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search events or clubs"
            autoComplete="off"
            className="h-10 w-full rounded-lg border border-line-2 bg-surface pl-9 pr-9 text-sm text-ink shadow-sm placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100 [&::-webkit-search-cancel-button]:hidden"
          />
          {pending ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-3" aria-label="Loading events" />
          ) : q ? (
            <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-3 hover:bg-muted hover:text-ink" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </form>

        {month ? null : (
          // Phones: one row that scrolls sideways; wider screens wrap.
          <div role="group" aria-label="When" className="-mx-3 flex items-center gap-2 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] sm:mx-0 [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            {DATE_SHORTCUTS.map((w) => (
              <Chip key={w} on={params.when === w} onClick={() => go({ when: params.when === w ? null : w, date: null })}>
                {DATE_SHORTCUT_LABEL[w]}
              </Chip>
            ))}
            <label htmlFor={dateId} className="sr-only">
              Pick a date
            </label>
            <input
              id={dateId}
              type="date"
              value={params.date ?? ""}
              onChange={(e) => go({ date: e.target.value || null, when: null })}
              className={cn(
                "h-9 shrink-0 rounded-full border px-3 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100",
                params.date ? "border-brand-200 bg-brand-50 text-brand" : "border-line-2 bg-surface text-ink-2",
              )}
            />
          </div>
        )}

        <div role="group" aria-label="Filters" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] sm:mx-0 [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {toggles.map((t) => (
            <Chip key={t.key} on={params[t.key]} icon={t.icon} onClick={() => go({ [t.key]: !params[t.key] })}>
              {t.label}
            </Chip>
          ))}
        </div>

        {/* Phones: type and category fold away under "More filters", so the events show sooner. */}
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => setMoreOpen((o) => !o)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-2 bg-surface px-3 text-sm font-medium text-ink-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand sm:hidden"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Type and category
          {moreCount ? <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-white">{moreCount}</span> : null}
          <ChevronDown className={cn("h-4 w-4 text-ink-3 transition-transform", moreOpen && "rotate-180")} aria-hidden="true" />
        </button>

        <div id={moreId} className={cn("grid grid-cols-2 gap-2 sm:max-w-xl", moreOpen ? "grid" : "hidden", "sm:grid")}>
          <div className="min-w-0">
            <label htmlFor={typeId} className="mb-1 block text-xs font-medium text-ink-3">
              Type
            </label>
            <select id={typeId} value={params.type ?? ""} onChange={(e) => go({ type: (e.target.value || null) as EventKind | null })} className={selectCls}>
              <option value="">Any type</option>
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor={categoryId} className="mb-1 block text-xs font-medium text-ink-3">
              Club category
            </label>
            <select id={categoryId} value={params.category ?? ""} onChange={(e) => go({ category: (e.target.value || null) as ClubCategory | null })} className={selectCls}>
              <option value="">Any category</option>
              {CLUB_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CLUB_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {summary ? (
          <p className="text-ink-2" aria-live="polite">
            {summary}
          </p>
        ) : null}
        {hasFilters(params) ? (
          <button type="button" onClick={() => go(CLEARED)} className="text-xs font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            Clear all filters
          </button>
        ) : null}
      </div>

      <div className={cn("mt-4 transition-opacity", pending && "pointer-events-none opacity-60")} aria-busy={pending}>
        {children}
      </div>
    </div>
  );
}
