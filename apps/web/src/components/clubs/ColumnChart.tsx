"use client";

import { useId, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * A small single-series column chart (one hue, so no legend — the caption
 * names the series). Bars cap at 24px with a 4px rounded top, hairline
 * gridlines, the latest value labeled on its cap, and a tooltip on hover AND
 * keyboard focus. A table view carries every value without hovering.
 */

export type ColumnDatum = {
  key: string;
  /** Axis label under the bar ("Oct", "Q3 '26"). */
  label: string;
  /** Full label for the tooltip and table ("October 2026"). */
  longLabel?: string;
  value: number | null;
  /** Formatted value ("64%", "1,204"). */
  valueLabel: string;
  /** Secondary line ("16 of 25 came back"). */
  detail?: string;
  /** A period still running: drawn lighter, and never the labeled bar. */
  partial?: boolean;
};

export function ColumnChart({
  data,
  max,
  ticks,
  formatTick,
  caption,
  valueHeader = "Value",
  height = 168,
  className,
}: {
  data: ColumnDatum[];
  /** Top of the y-scale. */
  max: number;
  /** Gridline values, e.g. [0, 0.5, 1]. */
  ticks: number[];
  formatTick: (v: number) => string;
  /** Names the series; read by screen readers and shown in the table. */
  caption: string;
  valueHeader?: string;
  height?: number;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  const top = max > 0 ? max : 1;
  // Label the latest complete value on its cap; the tooltip and table carry the rest.
  const lastWithValue = data.reduce((acc, d, i) => (d.value != null && !d.partial ? i : acc), -1);

  return (
    <figure className={cn("min-w-0", className)}>
      <div className="mb-2 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          aria-controls={tableId}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
        >
          {asTable ? <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" /> : <Table2 className="h-3.5 w-3.5" aria-hidden="true" />}
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {asTable ? (
        <div id={tableId} className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-ink-3">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Period</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{valueHeader}</th>
                <th scope="col" className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((d) => (
                <tr key={d.key}>
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                    {d.longLabel ?? d.label}
                    {d.partial ? <span className="font-normal text-ink-3"> (so far)</span> : null}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">{d.valueLabel}</td>
                  <td className="px-3 py-2 text-ink-3">{d.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div id={tableId} className="flex gap-2">
          {/* y-axis tick labels */}
          <div className="relative w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-3" style={{ height }} aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 leading-none" style={{ bottom: `${(t / top) * 100}%`, transform: "translateY(50%)" }}>
                {formatTick(t)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative" style={{ height }}>
              {ticks.map((t) => (
                <div key={t} className="absolute inset-x-0 h-px bg-line" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden="true" />
              ))}
              <ul className="absolute inset-0 flex items-end" role="list" aria-label={caption} onMouseLeave={() => setActive(null)}>
                {data.map((d, i) => {
                  const h = d.value != null ? Math.max(0, Math.min(1, d.value / top)) * 100 : 0;
                  const isActive = active === i;
                  return (
                    <li
                      key={d.key}
                      tabIndex={0}
                      aria-label={`${d.longLabel ?? d.label}${d.partial ? " so far" : ""}: ${d.valueLabel}${d.detail ? `, ${d.detail}` : ""}`}
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      className="relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center rounded-md outline-none focus-visible:bg-brand-50/70"
                    >
                      {d.value != null ? (
                        <span
                          className={cn(
                            "relative block w-full max-w-6 rounded-t-[4px] transition-colors",
                            // Partial bars stay ≥3:1 against the surface so they still read as data.
                            d.partial ? (isActive ? "bg-brand/70" : "bg-brand/55") : isActive ? "bg-brand-600" : "bg-brand",
                          )}
                          style={{ height: `${h}%`, minHeight: d.value > 0 ? 2 : 0 }}
                        >
                          {i === lastWithValue && !isActive ? (
                            <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold tabular-nums text-ink">{d.valueLabel}</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="mb-0 block h-px w-4 bg-line-2" aria-hidden="true" />
                      )}
                      {isActive ? (
                        <span
                          role="tooltip"
                          className={cn(
                            "pointer-events-none absolute z-10 w-max max-w-[11rem] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left shadow-[var(--shadow-pop)]",
                            // Keep edge tooltips inside the chart so narrow phones never scroll sideways.
                            i < data.length / 3 ? "left-0" : i >= (data.length * 2) / 3 ? "right-0" : "left-1/2 -translate-x-1/2",
                          )}
                          style={{ bottom: `calc(${h}% + 6px)` }}
                        >
                          <span className="block text-sm font-semibold tabular-nums text-ink">{d.value != null ? d.valueLabel : "No data"}</span>
                          <span className="block text-xs text-ink-3">
                            {d.longLabel ?? d.label}
                            {d.partial ? " · so far" : ""}
                          </span>
                          {d.detail ? <span className="mt-0.5 block text-xs text-ink-2">{d.detail}</span> : null}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="mt-1.5 flex" aria-hidden="true">
              {data.map((d) => (
                <span key={d.key} className="min-w-0 flex-1 truncate text-center text-[11px] text-ink-3">
                  {d.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

/** A round top for a y-scale: 7 → 10, 43 → 50, 1,230 → 1,500. */
export function niceMax(value: number) {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}
