"use client";

import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { ColumnChart, type ColumnDatum } from "@/components/clubs/ColumnChart";

export type RetentionPointView = { label: string; rate: number | null; attendees: number; retained: number; previousAttendees: number; inProgress?: boolean };

const short = (label: string) => label.replace(/\s(\d{2})(\d{2})$/, " ’$2");

function toData(points: RetentionPointView[]): ColumnDatum[] {
  return points.map((p) => ({
    key: p.label,
    label: short(p.label),
    longLabel: p.label,
    value: p.rate,
    valueLabel: p.rate == null ? "—" : `${Math.round(p.rate * 100)}%`,
    partial: p.inProgress,
    detail:
      p.rate == null
        ? p.previousAttendees === 0
          ? `Nobody to compare against yet · ${p.attendees} attended`
          : `${p.attendees} attended`
        : `${p.retained} of ${p.previousAttendees} came back · ${p.attendees} attended`,
  }));
}

/** Retention by month or quarter for the club page (data from lib/metrics clubRetention). */
export function RetentionChart({ month, quarter, clubName }: { month: RetentionPointView[]; quarter: RetentionPointView[]; clubName: string }) {
  const [period, setPeriod] = useState<"month" | "quarter">("month");
  const points = period === "month" ? month : quarter;
  const hasData = points.some((p) => p.rate != null);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">Who keeps coming back</p>
          <p className="text-xs text-ink-3">
            Share of each {period === "month" ? "month" : "quarter"}&rsquo;s attendees who came back the next one. The lighter bar is still in progress.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-muted p-0.5" role="group" aria-label="Retention period">
          {(["month", "quarter"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                period === p ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
              )}
            >
              {p === "month" ? "Monthly" : "Quarterly"}
            </button>
          ))}
        </div>
      </div>
      {hasData ? (
        <ColumnChart
          className="mt-3"
          data={toData(points)}
          max={1}
          ticks={[0, 0.5, 1]}
          formatTick={(v) => `${Math.round(v * 100)}%`}
          caption={`${clubName} ${period === "month" ? "monthly" : "quarterly"} retention`}
          valueHeader="Retention"
        />
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-line-2 px-4 py-6 text-center text-sm text-ink-3">
          Retention shows up once {clubName} has check-ins in two {period === "month" ? "months" : "quarters"} in a row.
        </p>
      )}
    </div>
  );
}
