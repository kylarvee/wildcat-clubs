"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, TrendingUp } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * Tracker charts. Colors are a validated pair for the white card surface
 * (dataviz validator: lightness band, chroma, CVD and contrast all pass):
 * members in Wildcat purple, guests in orange. Text never takes a series color.
 */
const MEMBERS = "#6b3fa0";
const GUESTS = "#eb6834";
const GRID = "#e7e3ec";
const AXIS = "#77707f";
const SURFACE = "#ffffff";

export type EventPoint = { id: string; label: string; date: string; title: string; members: number; guests: number; rate: number | null };

function pctLabel(rate: number | null) {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function Swatch({ color, shape = "rect" }: { color: string; shape?: "rect" | "line" }) {
  return shape === "line" ? (
    <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: color }} aria-hidden />
  ) : (
    <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: color }} aria-hidden />
  );
}

function TipShell({ children }: { children: React.ReactNode }) {
  return <div className="min-w-44 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-pop)]">{children}</div>;
}

type BarShapeProps = { x?: number; y?: number; width?: number; height?: number; fill?: string; payload?: EventPoint };

/** 4px rounded data-end, square at the baseline, and a 2px surface gap where segments stack. */
function stackShape(segment: "members" | "guests") {
  return function StackSegment(p: BarShapeProps) {
    const { x = 0, width = 0, fill } = p;
    let { y = 0, height = 0 } = p;
    if (height <= 0 || width <= 0) return <g />;
    const topmost = segment === "guests" || !p.payload?.guests;
    if (!topmost) {
      y += 2;
      height = Math.max(0, height - 2);
    }
    const r = topmost ? Math.min(4, width / 2, height) : 0;
    const d = `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
    return <path d={d} fill={fill} />;
  };
}
const membersShape = stackShape("members");
const guestsShape = stackShape("guests");

/** Members and guests at each event in the selected range. */
export function AttendanceByEventChart({ data }: { data: EventPoint[] }) {
  if (data.length === 0 || data.every((d) => d.members + d.guests === 0)) {
    return (
      <div className="flex h-[240px] flex-col items-center justify-center rounded-xl bg-muted/50 text-center text-sm text-ink-3">
        <BarChart3 className="mb-2 h-6 w-6" aria-hidden />
        No check-ins in this range yet.
      </div>
    );
  }
  return (
    <figure>
      <div className="mb-2 flex items-center gap-4 text-xs text-ink-2" aria-hidden>
        <span className="flex items-center gap-1.5">
          <Swatch color={MEMBERS} /> Members
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch color={GUESTS} /> Guests
        </span>
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: "#d6d0dd" }} minTickGap={12} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ fill: "rgba(73,35,101,0.06)" }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as EventPoint | undefined;
                if (!active || !row) return null;
                return (
                  <TipShell>
                    <p className="font-semibold text-ink">{row.title}</p>
                    <p className="mb-1.5 text-ink-3">{row.date}</p>
                    <p className="flex items-center gap-2">
                      <Swatch color={MEMBERS} shape="line" />
                      <span className="font-semibold tabular-nums text-ink">{row.members}</span>
                      <span className="text-ink-3">members</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Swatch color={GUESTS} shape="line" />
                      <span className="font-semibold tabular-nums text-ink">{row.guests}</span>
                      <span className="text-ink-3">guests</span>
                    </p>
                    <p className="mt-1.5 border-t border-line pt-1.5 text-ink-2">
                      <span className="font-semibold text-ink">{pctLabel(row.rate)}</span> of members came
                    </p>
                  </TipShell>
                );
              }}
            />
            <Bar dataKey="members" name="Members" stackId="a" fill={MEMBERS} maxBarSize={24} shape={membersShape} isAnimationActive={false} />
            <Bar dataKey="guests" name="Guests" stackId="a" fill={GUESTS} maxBarSize={24} shape={guestsShape} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Check-ins by event</caption>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Members</th>
            <th scope="col">Guests</th>
            <th scope="col">Attendance rate</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id}>
              <th scope="row">
                {d.title}, {d.date}
              </th>
              <td>{d.members}</td>
              <td>{d.guests}</td>
              <td>{pctLabel(d.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export type RetentionKey = "month" | "quarter" | "academicYear" | "year";
export type RetentionSeries = { label: string; rate: number | null; retained: number; previousAttendees: number; attendees: number }[];

const PERIODS: { key: RetentionKey; label: string; noun: string }[] = [
  { key: "month", label: "Month", noun: "month" },
  { key: "quarter", label: "Quarter", noun: "quarter" },
  { key: "academicYear", label: "Academic year", noun: "academic year" },
  { key: "year", label: "Year", noun: "year" },
];

/** Of each period's attendees, the share who came back the next period. */
export function RetentionChart({ series, defaultPeriod = "month" }: { series: Record<RetentionKey, RetentionSeries>; defaultPeriod?: RetentionKey }) {
  const [period, setPeriod] = useState<RetentionKey>(defaultPeriod);
  const points = series[period].map((p) => ({ ...p, pct: p.rate === null ? null : Math.round(p.rate * 100) }));
  const noun = PERIODS.find((p) => p.key === period)!.noun;
  const hasData = points.some((p) => p.pct !== null);
  const latest = [...points].reverse().find((p) => p.pct !== null);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Retention period" className="inline-flex rounded-lg bg-muted p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand sm:px-3",
                period === p.key ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {latest ? (
          <p className="text-xs text-ink-3">
            Latest ({latest.label}): <span className="font-semibold text-ink">{latest.pct}%</span> came back
          </p>
        ) : null}
      </div>
      {hasData ? (
        <figure>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: "#d6d0dd" }} minTickGap={12} padding={{ left: 8, right: 8 }} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  cursor={{ stroke: "#d6d0dd", strokeWidth: 1 }}
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as (typeof points)[number] | undefined;
                    if (!active || !row) return null;
                    return (
                      <TipShell>
                        <p className="mb-1 font-semibold text-ink">{row.label}</p>
                        {row.pct === null ? (
                          <p className="text-ink-3">Nobody checked in the {noun} before, so there&apos;s nothing to compare.</p>
                        ) : (
                          <>
                            <p className="flex items-center gap-2">
                              <Swatch color={MEMBERS} shape="line" />
                              <span className="font-semibold text-ink">{row.pct}%</span>
                              <span className="text-ink-3">came back</span>
                            </p>
                            <p className="mt-1 text-ink-2">
                              {row.retained} of {row.previousAttendees} from the {noun} before
                            </p>
                          </>
                        )}
                        <p className="mt-1 text-ink-3">{row.attendees} people came this {noun}</p>
                      </TipShell>
                    );
                  }}
                />
                <Line
                  // Straight segments: periods are discrete, and a smoothed curve would overshoot 100%.
                  type="linear"
                  dataKey="pct"
                  name="Retention"
                  stroke={MEMBERS}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={{ r: 4, fill: MEMBERS, stroke: SURFACE, strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: MEMBERS, stroke: SURFACE, strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Retention by {noun}</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Came back</th>
                <th scope="col">Attendees</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.label}>
                  <th scope="row">{p.label}</th>
                  <td>{p.pct === null ? "No earlier period to compare" : `${p.pct}% (${p.retained} of ${p.previousAttendees})`}</td>
                  <td>{p.attendees}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      ) : (
        <div className="flex h-[220px] flex-col items-center justify-center rounded-xl bg-muted/50 px-6 text-center text-sm text-ink-3">
          <TrendingUp className="mb-2 h-6 w-6" aria-hidden />
          Retention shows up once people have checked in across two {noun}s in a row.
        </div>
      )}
    </div>
  );
}
