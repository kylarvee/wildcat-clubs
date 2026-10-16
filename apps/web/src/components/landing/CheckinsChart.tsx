"use client";

import { ColumnChart, niceMax } from "@/components/clubs/ColumnChart";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Axis and tooltip labels for a month: "Oct 2026" or "2026-10" → "Oct" / "October 2026". */
function monthLabels(month: string) {
  const iso = /^(\d{4})-(\d{2})$/.exec(month);
  const named = /^([A-Z][a-z]{2})[a-z]*\s+(\d{4})$/.exec(month);
  const index = iso ? Number(iso[2]) - 1 : named ? MONTHS.indexOf(named[1]) : -1;
  const year = iso?.[1] ?? named?.[2];
  if (index < 0 || !year) return { short: month, long: month };
  const longName = new Date(Date.UTC(Number(year), index, 15)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return { short: MONTHS[index], long: `${longName} ${year}` };
}

/** Platform-wide check-ins per month for the landing page (from lib/metrics platformSummary). */
export function CheckinsChart({ months, lastIsPartial = false }: { months: { month: string; checkins: number; uniqueAttendees: number }[]; lastIsPartial?: boolean }) {
  const top = niceMax(Math.max(0, ...months.map((m) => m.checkins)));
  return (
    <ColumnChart
      data={months.map((m, i) => {
        const l = monthLabels(m.month);
        return {
          key: m.month,
          label: l.short,
          longLabel: l.long,
          value: m.checkins,
          valueLabel: m.checkins.toLocaleString("en-US"),
          detail: `${m.uniqueAttendees.toLocaleString("en-US")} different students`,
          partial: lastIsPartial && i === months.length - 1,
        };
      })}
      max={top}
      ticks={[0, top / 2, top]}
      formatTick={(v) => (v >= 1000 ? `${Number((v / 1000).toFixed(2))}k` : `${Math.round(v)}`)}
      caption="Check-ins at club events per month"
      valueHeader="Check-ins"
      height={140}
    />
  );
}
