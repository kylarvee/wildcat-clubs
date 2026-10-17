"use client";

import { useId, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Select } from "@/components/ui/form";

/**
 * Filter controls for admin and system tables. Each one edits a single query
 * parameter and keeps the others (dropping ?page so results start over).
 */

function useParamHref() {
  const pathname = usePathname();
  const sp = useSearchParams();
  return (param: string, value: string | null, drop: string[] = []) => {
    const next = new URLSearchParams(sp.toString());
    for (const d of ["page", ...drop]) next.delete(d);
    if (value) next.set(param, value);
    else next.delete(param);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
}

/** A labelled select that navigates as soon as it changes. */
export function FilterSelect({
  label,
  param,
  value,
  options,
  allLabel = "All",
  drop,
  className,
}: {
  label: string;
  param: string;
  value: string | null;
  options: { value: string; label: string }[];
  allLabel?: string;
  /** Other params to clear when this one changes. */
  drop?: string[];
  className?: string;
}) {
  const id = useId();
  const router = useRouter();
  const href = useParamHref();
  const [pending, start] = useTransition();
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-3">
        {label}
        {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-label="Loading" /> : null}
      </label>
      <Select id={id} value={value ?? ""} onChange={(e) => start(() => router.push(href(param, e.target.value || null, drop)))} className="h-9">
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Pill-shaped links for a short list of choices (one query parameter). */
export function FilterPills({
  label,
  param,
  value,
  options,
  drop,
}: {
  label: string;
  param: string;
  value: string | null;
  options: { value: string | null; label: string; count?: number }[];
  drop?: string[];
}) {
  const href = useParamHref();
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = (o.value ?? null) === (value ?? null);
        return (
          <Link
            key={o.value ?? "_all"}
            href={href(param, o.value, drop)}
            aria-current={active ? "true" : undefined}
            scroll={false}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              active ? "bg-brand text-white ring-brand" : "bg-surface text-ink-2 ring-line-2 hover:bg-muted",
            )}
          >
            {o.label}
            {o.count ? <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-white/20" : "bg-muted text-ink-3")}>{o.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Previous / next page links for long tables. */
export function Pager({ page, pages, total, noun }: { page: number; pages: number; total: number; noun: string }) {
  const href = useParamHref();
  if (pages <= 1) return <p className="text-sm text-ink-3">{total.toLocaleString()} {noun}{total === 1 ? "" : "s"}</p>;
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-ink-3">
        {total.toLocaleString()} {noun}s · page {page} of {pages}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className="rounded-lg border border-line-2 bg-surface px-3 py-1.5 font-medium text-ink hover:bg-muted" href={href("page", page - 1 > 1 ? String(page - 1) : null)}>
            Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="rounded-lg border border-line-2 bg-surface px-3 py-1.5 font-medium text-ink hover:bg-muted" href={href("page", String(page + 1))}>
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
