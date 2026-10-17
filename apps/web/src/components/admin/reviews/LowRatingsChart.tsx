"use client";

import { ColumnChart, type ColumnDatum } from "@/components/clubs/ColumnChart";

/** Client wrapper so the server page can hand ColumnChart plain data (functions can't cross over). */
export function LowRatingsChart({ data, max, ticks, caption }: { data: ColumnDatum[]; max: number; ticks: number[]; caption: string }) {
  return <ColumnChart data={data} max={max} ticks={ticks} formatTick={(v) => String(v)} caption={caption} valueHeader="Low ratings" height={140} />;
}
