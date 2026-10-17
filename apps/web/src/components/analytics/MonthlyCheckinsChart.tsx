"use client";

import { ColumnChart, niceMax, type ColumnDatum } from "@/components/clubs/ColumnChart";

const fmt = (n: number) => n.toLocaleString("en-US");
/** Axis ticks: 750 · 1.5K · 12K. */
const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${Number((n / 1000).toFixed(1))}K` : fmt(n));

export type MonthPoint = { month: string; checkins: number; uniqueAttendees: number; partial?: boolean };

/**
 * Platform check-ins per month (from lib/metrics platformSummary) as a
 * single-series column chart: one hue, the latest full month labeled, the
 * running month drawn lighter, a tooltip on hover and focus, and a table view.
 */
export function MonthlyCheckinsChart({ months, height = 200 }: { months: MonthPoint[]; height?: number }) {
  const data: ColumnDatum[] = months.map((m) => ({
    key: m.month,
    label: m.month.slice(0, 3),
    longLabel: m.month,
    value: m.checkins,
    valueLabel: fmt(m.checkins),
    detail: `${fmt(m.uniqueAttendees)} different ${m.uniqueAttendees === 1 ? "person" : "people"}`,
    partial: m.partial,
  }));
  const max = niceMax(Math.max(0, ...months.map((m) => m.checkins)));
  return (
    <ColumnChart
      data={data}
      max={max}
      ticks={[0, max / 2, max]}
      formatTick={compact}
      caption="Check-ins per month over the last 12 months"
      valueHeader="Check-ins"
      height={height}
    />
  );
}
