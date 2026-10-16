import { academicYearsBetween, assignLanes, coverageGaps, fmtMonthRange, spanPercent, type Span } from "@/lib/roles/history";
import { cn } from "@/components/ui/cn";

export type TimelineTerm = { id: string; name: string; color: string; start: Date; end: Date | null };

const LANE_REM = 1.75;
const TICKS = [
  { label: "Jul", pct: 0 },
  { label: "Oct", pct: 25.2 },
  { label: "Jan", pct: 50.4 },
  { label: "Apr", pct: 75.1 },
];

/**
 * A seat's history drawn one academic year per row: who held it (colored by
 * their avatar color, co-holders on separate lanes) and when it sat empty
 * (amber, labeled). The text list beside it carries the same facts for
 * screen readers.
 */
export function RoleTimeline({ seatName, terms, from, to, now, open }: { seatName: string; terms: TimelineTerm[]; from: Date; to: Date; now: Date; open: boolean }) {
  const laid = assignLanes(terms, to);
  const lanes = Math.max(1, ...laid.map((l) => l.lane + 1));
  const gaps = coverageGaps(terms, from, to);
  const years = academicYearsBetween(from, to).reverse(); // newest year on top
  const height = `${lanes * LANE_REM + 0.5}rem`;

  const label = [
    `Timeline for ${seatName}.`,
    ...terms.map((t) => `${t.name}, ${fmtMonthRange(t.start, t.end)}.`),
    ...gaps.map((g) => `Vacant ${fmtMonthRange(g.start, open && g.end.getTime() >= to.getTime() - 60_000 ? null : g.end)}.`),
  ].join(" ");

  return (
    <figure role="img" aria-label={label} className="space-y-1.5">
      <div aria-hidden className="grid grid-cols-[4.25rem_1fr] gap-3 text-[10px] font-medium uppercase tracking-wide text-ink-3">
        <span />
        <div className="relative h-3">
          {TICKS.map((t) => (
            <span key={t.label} className="absolute" style={{ left: `${t.pct}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      {years.map((y) => {
        const yearSpan: Span = { start: y.start, end: y.end };
        const before = spanPercent({ start: y.start, end: from }, yearSpan);
        const after = spanPercent({ start: to, end: y.end }, yearSpan);
        const nowPct = now >= y.start && now < y.end ? spanPercent({ start: y.start, end: now }, yearSpan) : null;
        return (
          <div key={y.label} aria-hidden className="grid grid-cols-[4.25rem_1fr] items-center gap-3">
            <span className="text-xs font-medium tabular-nums text-ink-2">{y.label}</span>
            <div className="relative overflow-hidden rounded-md bg-muted" style={{ height }}>
              {[before, after].map((s, i) =>
                s ? (
                  <div
                    key={i}
                    className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(23_19_28/0.05)_4px_8px)]"
                    style={{ left: `${s.left}%`, width: `${s.width}%` }}
                  />
                ) : null,
              )}
              {gaps.map((g, i) => {
                const p = spanPercent(g, yearSpan);
                if (!p) return null;
                return (
                  <div
                    key={`g${i}`}
                    className="absolute inset-y-0 flex items-center justify-center border-x border-amber-300 bg-[repeating-linear-gradient(135deg,var(--color-warning-50)_0_5px,#fde68a_5px_7px)]"
                    style={{ left: `${p.left}%`, width: `${p.width}%` }}
                  >
                    {p.width > 14 ? <span className="rounded bg-warning-50/90 px-1 text-[10px] font-semibold uppercase tracking-wide text-warning">Vacant</span> : null}
                  </div>
                );
              })}
              {laid.map(({ item, lane }) => {
                const p = spanPercent({ start: item.start, end: item.end ?? to }, yearSpan);
                if (!p) return null;
                return (
                  <div
                    key={item.id}
                    className="absolute flex items-center overflow-hidden rounded-[5px] px-1.5 text-[11px] font-medium text-white shadow-sm"
                    style={{ left: `${p.left}%`, width: `calc(${p.width}% - 1px)`, top: `${lane * LANE_REM + 0.25}rem`, height: `${LANE_REM - 0.25}rem`, backgroundColor: item.color }}
                    title={`${item.name}: ${fmtMonthRange(item.start, item.end)}`}
                  >
                    {p.width > 9 ? <span className="truncate">{item.name}</span> : null}
                  </div>
                );
              })}
              {nowPct ? <div className="absolute inset-y-0 w-0.5 bg-ink/70" style={{ left: `${nowPct.width}%` }} title="Today" /> : null}
            </div>
          </div>
        );
      })}
      {gaps.length ? (
        <figcaption className="flex flex-wrap gap-1.5 pt-1">
          {gaps.map((g, i) => (
            <span key={i} className={cn("rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-inset ring-amber-200")}>
              Vacant {fmtMonthRange(g.start, open && g.end.getTime() >= to.getTime() - 60_000 ? null : g.end)}
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}
