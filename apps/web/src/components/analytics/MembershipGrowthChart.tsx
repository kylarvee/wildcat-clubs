"use client";

import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table2, TrendingUp, Users } from "lucide-react";
import type { GrowthPoint } from "@/lib/analytics/growth";

/**
 * Registered members at the end of each month. One series, so no legend —
 * the card title names it. Wildcat purple (the tracker's validated members
 * hue on white), a 2px line over a 10% wash, the latest value labeled at the
 * end, a crosshair tooltip with joins and departures, and a table view.
 */
const SERIES = "#6b3fa0";
const GRID = "#e7e3ec";
const AXIS = "#77707f";
const BASELINE = "#d6d0dd";
const SURFACE = "#ffffff";

const fmt = (n: number) => n.toLocaleString("en-US");
/** "Oct 2026" → "Oct '26" */
const short = (label: string) => label.replace(/ (\d{2})(\d{2})$/, " '$2");

type Row = GrowthPoint & { short: string };

export function MembershipGrowthChart({ points }: { points: GrowthPoint[] }) {
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  const rows: Row[] = points.map((p) => ({ ...p, short: short(p.label) }));
  const last = rows.at(-1);

  if (!rows.length || rows.every((r) => r.members === 0 && r.joined === 0)) {
    return (
      <div className="flex h-[240px] flex-col items-center justify-center rounded-xl bg-muted/50 px-6 text-center text-sm text-ink-3">
        <Users className="mb-2 h-6 w-6" aria-hidden="true" />
        No members yet. The line starts with the club&rsquo;s first registration.
      </div>
    );
  }

  return (
    <figure className="min-w-0">
      <div className="mb-2 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          aria-controls={tableId}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
        >
          {asTable ? <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> : <Table2 className="h-3.5 w-3.5" aria-hidden="true" />}
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {asTable ? (
        <div id={tableId} className="max-h-[320px] overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Registered members at the end of each month</caption>
            <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-ink-3">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Month</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Members</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Joined</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...rows].reverse().map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                    {r.label}
                    {r.inProgress ? <span className="font-normal text-ink-3"> (so far)</span> : null}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">{fmt(r.members)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{r.joined ? `+${fmt(r.joined)}` : "0"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{r.left ? `−${fmt(r.left)}` : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div id={tableId} className="h-[240px]" role="img" aria-label={`Registered members by month, from ${rows[0].label} (${fmt(rows[0].members)}) to ${last!.label} (${fmt(last!.members)}).`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 22, right: 26, bottom: 0, left: -8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="short" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: BASELINE }} minTickGap={18} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} domain={[0, "auto"]} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                cursor={{ stroke: BASELINE, strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as Row | undefined;
                  if (!active || !row) return null;
                  return (
                    <div className="min-w-40 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-pop)]">
                      <p className="font-semibold text-ink">
                        {row.label}
                        {row.inProgress ? <span className="font-normal text-ink-3"> · so far</span> : null}
                      </p>
                      <p className="mt-1 flex items-center gap-2">
                        <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: SERIES }} aria-hidden="true" />
                        <span className="font-semibold tabular-nums text-ink">{fmt(row.members)}</span>
                        <span className="text-ink-3">members</span>
                      </p>
                      <p className="mt-1 text-ink-2">
                        +{fmt(row.joined)} joined · −{fmt(row.left)} left
                      </p>
                    </div>
                  );
                }}
              />
              <Area
                type="linear"
                dataKey="members"
                name="Members"
                stroke={SERIES}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill={SERIES}
                fillOpacity={0.1}
                isAnimationActive={false}
                // Only the latest month gets a marker and a value; the axis, tooltip and table carry the rest.
                dot={(p: { cx?: number; cy?: number; index?: number }) =>
                  p.index === rows.length - 1 && p.cx != null && p.cy != null ? (
                    <g key="end">
                      <circle cx={p.cx} cy={p.cy} r={4} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
                      <text x={p.cx} y={p.cy - 10} textAnchor="end" fontSize={11} fontWeight={600} fill="#17131c">
                        {fmt(last!.members)}
                      </text>
                    </g>
                  ) : (
                    <g key={`d${p.index}`} />
                  )
                }
                activeDot={{ r: 5, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
