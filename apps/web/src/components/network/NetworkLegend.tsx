"use client";

import type { NetworkPayload } from "@/lib/analytics/network-model";
import { cn } from "@/components/ui/cn";
import { HIGHLIGHT, LINE, MINE_GRAY, NO_COLLEGE, colorOf } from "./colors";
import { lineWidthScale, radiusScale } from "./layout";

const fmt = (n: number) => n.toLocaleString("en-US");

/** A round, readable sample value at or below `n` (1,733 → 1,500). */
function roundDown(n: number) {
  if (n <= 10) return Math.max(1, Math.floor(n));
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / exp;
  const step = f >= 5 ? 5 : f >= 2.5 ? 2.5 : f >= 2 ? 2 : 1;
  return step * exp;
}

/**
 * What the canvas encodes: circle size, line weight, college colors (each a
 * toggle that spotlights that college's clubs) and the viewer's own clubs.
 */
export function NetworkLegend({
  data,
  colors,
  collegeFocus,
  onCollegeFocus,
  className,
}: {
  data: NetworkPayload;
  colors: Map<string, string>;
  collegeFocus: string | null;
  onCollegeFocus: (id: string | null) => void;
  className?: string;
}) {
  const grouped = data.group !== "club";
  const r = radiusScale(data.nodes, { grouped, count: data.nodes.length });
  const maxSize = Math.max(0, ...data.nodes.map((n) => n.size));
  const sizes = maxSize > 0 ? [...new Set([roundDown(maxSize / 10), roundDown(maxSize / 3), roundDown(maxSize)])] : [];
  const lw = lineWidthScale(data.edges);
  const maxW = Math.max(0, ...data.edges.map((e) => e.weight));
  const weights = maxW > 0 ? [...new Set([1, roundDown(maxW / 4), roundDown(maxW)])] : [];
  const hasNoCollege = data.nodes.some((n) => !n.collegeId);
  const usedColleges = new Set(data.nodes.map((n) => n.collegeId).filter(Boolean));
  const colleges = data.colleges.filter((c) => usedColleges.has(c.id));
  const showMine = data.viewer.leads.length > 0 || data.viewer.memberOf.length > 0;
  const nodeNoun = grouped ? "group" : "club";

  return (
    <div className={cn("grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 xl:grid-cols-[auto_auto_minmax(0,1fr)]", className)}>
      <section aria-labelledby="legend-size">
        <h3 id="legend-size" className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Circle size
        </h3>
        <p className="mt-1 text-ink-2">
          Check-ins at the {nodeNoun}&rsquo;s events {data.windowPhrase}
        </p>
        {sizes.length ? (
          <div className="mt-2 flex items-end gap-4" aria-hidden="true">
            {sizes.map((s) => {
              const rad = Math.min(r(s), 26);
              return (
                <span key={s} className="flex flex-col items-center gap-1">
                  <svg width={rad * 2 + 2} height={rad * 2 + 2} className="overflow-visible">
                    <circle cx={rad + 1} cy={rad + 1} r={rad} fill="none" stroke={LINE} strokeWidth={1.25} />
                  </svg>
                  <span className="text-xs tabular-nums text-ink-3">{fmt(s)}</span>
                </span>
              );
            })}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="legend-lines">
        <h3 id="legend-lines" className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Lines
        </h3>
        <p className="mt-1 max-w-xs text-ink-2">Members of one {nodeNoun} checking in at the other&rsquo;s events. Thicker = more check-ins; no line = none yet.</p>
        {weights.length ? (
          <div className="mt-2 flex items-center gap-4" aria-hidden="true">
            {weights.map((w) => (
              <span key={w} className="flex flex-col items-center gap-1">
                <svg width={40} height={12}>
                  <line x1={2} y1={6} x2={38} y2={6} stroke={LINE} strokeOpacity={0.75} strokeWidth={Math.max(1, lw(w))} strokeLinecap="round" />
                </svg>
                <span className="text-xs tabular-nums text-ink-3">{fmt(w)}</span>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="legend-colleges" className="sm:col-span-2 xl:col-span-1">
        <h3 id="legend-colleges" className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          {grouped ? "Color = the college most of its clubs belong to" : "Color = college"}
        </h3>
        <p className="mt-1 text-ink-2">Select one to spotlight its clubs.</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {colleges.map((c) => (
            <li key={c.id}>
              <CollegeChip label={c.shortName} title={c.name} color={colorOf(colors, c.id)} pressed={collegeFocus === c.id} onClick={() => onCollegeFocus(collegeFocus === c.id ? null : c.id)} />
            </li>
          ))}
          {hasNoCollege ? (
            <li>
              <CollegeChip label="Not in a college" title="University-wide, independent and sports clubs" color={NO_COLLEGE} pressed={collegeFocus === "none"} onClick={() => onCollegeFocus(collegeFocus === "none" ? null : "none")} />
            </li>
          ) : null}
        </ul>
      </section>

      {showMine ? (
        <section aria-labelledby="legend-mine" className="sm:col-span-2 xl:col-span-3">
          <h3 id="legend-mine" className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            Your clubs
          </h3>
          <ul className="mt-1.5 flex flex-wrap gap-x-6 gap-y-2 text-ink-2">
            {data.viewer.leads.length ? (
              <li className="flex items-center gap-2">
                <svg width={26} height={26} aria-hidden="true">
                  <circle cx={13} cy={13} r={9} fill="none" stroke={HIGHLIGHT} strokeWidth={2.25} strokeDasharray="4 3" />
                  <circle cx={13} cy={13} r={6} fill={NO_COLLEGE} stroke="#fff" strokeWidth={1.5} />
                </svg>
                Clubs you lead or advise
              </li>
            ) : null}
            {data.viewer.memberOf.some((id) => !data.viewer.leads.includes(id)) ? (
              <li className="flex items-center gap-2">
                <svg width={26} height={26} aria-hidden="true">
                  <circle cx={13} cy={13} r={8.75} fill="none" stroke={MINE_GRAY} strokeWidth={1.75} strokeDasharray="4 3" />
                  <circle cx={13} cy={13} r={6} fill={NO_COLLEGE} stroke="#fff" strokeWidth={1.5} />
                </svg>
                Clubs you&rsquo;re a member of
              </li>
            ) : null}
            <li className="flex items-center gap-2">
              <svg width={26} height={26} aria-hidden="true">
                <circle cx={13} cy={13} r={12.5} fill={HIGHLIGHT} fillOpacity={0.16} />
                <circle cx={13} cy={13} r={8.5} fill="none" stroke={HIGHLIGHT} strokeWidth={3} />
                <circle cx={13} cy={13} r={6} fill={NO_COLLEGE} stroke="#fff" strokeWidth={1.5} />
              </svg>
              The club you picked
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function CollegeChip({ label, title, color, pressed, onClick }: { label: string; title: string; color: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        pressed ? "border-brand bg-brand-50 text-ink" : "border-line bg-surface text-ink-2 hover:border-line-2 hover:bg-muted",
      )}
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </button>
  );
}
