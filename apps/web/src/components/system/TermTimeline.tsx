"use client";

import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/misc";
import { TERM_KIND_LABEL, TermDialog, type TermRow } from "@/components/system/TermDialog";

export type TimelineTerm = { id: string; left: number; width: number; range: string; weeks: number; current: boolean };
export type TimelineYear = { label: string; todayPct: number | null; terms: TimelineTerm[] };
/** A month boundary on the shared axis: `pct` is where it starts, `mid` where its label sits. */
export type TimelineTick = { label: string; pct: number; mid: number; labelled: boolean };

/** Terms that don't count for activity get a texture as well as a lighter fill, so the difference never rests on color. */
const HATCH = { backgroundImage: "repeating-linear-gradient(135deg, var(--color-brand-100) 0 4px, var(--color-surface) 4px 8px)" };

/**
 * The academic calendar as one row per academic year (fall through summer). Each bar
 * is a term, labelled with its kind; hover or focus shows its dates, and
 * clicking opens it for editing. The table below the timeline lists every
 * term in full, so nothing here depends on hovering.
 */
export function TermTimeline({ years, ticks, terms }: { years: TimelineYear[]; ticks: TimelineTick[]; terms: TermRow[] }) {
  const [editing, setEditing] = useState<TermRow | null>(null);
  const byId = new Map(terms.map((t) => [t.id, t]));

  return (
    <figure className="min-w-0">
      <figcaption className="sr-only">Academic calendar timeline. Each row is an academic year, fall through summer; bars are terms. The table below lists the same terms.</figcaption>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-[3px] bg-brand-600" aria-hidden /> Counts for activity
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-[3px] border border-brand-200" style={HATCH} aria-hidden /> Doesn&rsquo;t count
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-0.5 bg-ink" aria-hidden /> Today
        </span>
      </div>

      <div className="space-y-2">
        {/* Month labels share the rows' column layout so they line up with the bars. */}
        <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-3" aria-hidden>
          <span />
          <div className="relative h-4">
            {ticks.map((t, i) =>
              t.labelled ? (
                <span key={t.label + i} className={cn("absolute top-0 -translate-x-1/2 text-[11px] text-ink-3", i % 3 !== 0 && "hidden sm:block")} style={{ left: `${t.mid}%` }}>
                  {t.label}
                </span>
              ) : null,
            )}
          </div>
        </div>

        {years.map((y) => (
          <div key={y.label} className={cn("grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-3", y.todayPct !== null && "pt-4")}>
            <span className={cn("text-xs tabular-nums", y.todayPct !== null ? "font-semibold text-ink" : "text-ink-3")}>{y.label}</span>
            <div className="relative h-9 rounded-md bg-muted/60">
              {ticks.map((t, i) => (i === 0 ? null : <span key={i} className="absolute inset-y-0 w-px bg-line" style={{ left: `${t.pct}%` }} aria-hidden />))}
              {y.terms.map((t) => {
                const term = byId.get(t.id);
                if (!term) return null;
                const label = `${term.name}: ${t.range}, about ${t.weeks} weeks, ${term.countsForActivity ? "counts for activity" : "doesn't count for activity"}${t.current ? ", happening now" : ""}`;
                return (
                  <Tooltip
                    key={t.id}
                    content={
                      <span className="block">
                        <span className="block font-semibold">{term.name}</span>
                        <span className="block">{t.range}</span>
                        <span className="block text-white/80">
                          About {t.weeks} weeks · {term.countsForActivity ? "counts for activity" : "doesn't count for activity"}
                        </span>
                        <span className="mt-0.5 block text-white/60">Click to edit</span>
                      </span>
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setEditing(term)}
                      aria-label={`${label}. Edit term.`}
                      className={cn(
                        "absolute inset-y-1 flex min-w-1 items-center overflow-hidden rounded-[4px] px-1.5 text-left text-[11px] font-medium transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                        term.countsForActivity ? "bg-brand-600 text-white" : "border border-brand-200 text-brand-700",
                      )}
                      style={{ left: `${t.left}%`, width: `${t.width}%`, ...(term.countsForActivity ? {} : HATCH) }}
                    >
                      <span className="truncate">{TERM_KIND_LABEL[term.kind]}</span>
                    </button>
                  </Tooltip>
                );
              })}
              {y.todayPct !== null ? (
                <span className="pointer-events-none absolute -inset-y-1 w-0.5 rounded-full bg-ink" style={{ left: `${y.todayPct}%` }} aria-hidden>
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-ink">Today</span>
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {editing ? (
        <TermDialog
          key={editing.id}
          term={editing}
          others={terms.filter((t) => t.id !== editing.id)}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      ) : null}
    </figure>
  );
}
