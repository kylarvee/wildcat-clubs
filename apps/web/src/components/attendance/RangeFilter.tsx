import Link from "next/link";
import { CalendarRange } from "lucide-react";
import type { ResolvedRange } from "@/lib/attendance/ranges";
import { cn } from "@/components/ui/cn";
import { buttonClasses } from "@/components/ui/button";

/**
 * Date-range filter: preset tabs plus a custom from/to form. Plain links and
 * a GET form (works without JavaScript); every number below it follows the
 * same range.
 */
export function RangeFilter({
  basePath,
  range,
  presets,
  keep = {},
  anchor,
  className,
}: {
  basePath: string;
  /** null when an "all time" preset is selected. */
  range: ResolvedRange | null;
  presets: { key: string; label: string }[];
  /** Other search params to carry along (sort, club filter…). */
  keep?: Record<string, string | undefined>;
  anchor?: string;
  className?: string;
}) {
  const kept = Object.fromEntries(Object.entries(keep).filter((e): e is [string, string] => Boolean(e[1])));
  const active = range ? range.key : "all";
  const href = (key: string) => `${basePath}?${new URLSearchParams({ ...kept, range: key }).toString()}${anchor ? `#${anchor}` : ""}`;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <nav aria-label="Date range" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {presets.map((p) => (
          <Link
            key={p.key}
            href={href(p.key)}
            scroll={false}
            aria-current={active === p.key ? "true" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
              active === p.key ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
            )}
          >
            {p.label}
          </Link>
        ))}
      </nav>
      <details className="group" open={active === "custom" ? true : undefined}>
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden",
            active === "custom" ? "bg-brand-50 text-brand" : "text-ink-3 hover:bg-muted hover:text-ink",
          )}
        >
          <CalendarRange className="h-4 w-4" aria-hidden />
          Custom
        </summary>
        <form method="get" action={basePath} className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-card)]">
          {Object.entries(kept).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="range" value="custom" />
          <label className="text-xs font-medium text-ink-2">
            From
            <input type="date" name="from" defaultValue={range?.fromInput} required className="mt-1 block h-9 rounded-lg border border-line-2 px-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100" />
          </label>
          <label className="text-xs font-medium text-ink-2">
            To
            <input type="date" name="to" defaultValue={range?.toInput} required className="mt-1 block h-9 rounded-lg border border-line-2 px-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100" />
          </label>
          <button type="submit" className={buttonClasses("primary", "sm", "h-9")}>
            Apply
          </button>
        </form>
      </details>
      {range ? <p className="text-sm text-ink-3">{range.key === "custom" ? range.label : `${range.label} · ${fmtSpan(range)}`}</p> : null}
    </div>
  );
}

function fmtSpan(r: ResolvedRange) {
  const [fy, fm, fd] = r.fromInput.split("-").map(Number);
  const [ty, tm, td] = r.toInput.split("-").map(Number);
  const m = (n: number) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][n - 1];
  return fy === ty ? `${m(fm)} ${fd} – ${m(tm)} ${td}, ${ty}` : `${m(fm)} ${fd}, ${fy} – ${m(tm)} ${td}, ${ty}`;
}
