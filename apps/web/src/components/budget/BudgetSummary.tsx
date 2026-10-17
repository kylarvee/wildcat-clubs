import type { FundingSource } from "@prisma/client";
import { Stat } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { fmtMoney } from "@/lib/time";
import { SOURCE_ORDER, plural, sourceName, type SourceContext } from "@/lib/funding/labels";

type Planned = { totalCents: number; unrequestedCents: number; bySource: Record<FundingSource, number> };
type Money = { requested: number; approved: number; pending: number; bySource: Record<FundingSource, { requested: number; approved: number }> };

const dash = <span className="text-ink-3">—</span>;
const money = (c: number) => (c ? fmtMoney(c) : dash);

/** A tile amount that steps down a size on phones, so five-figure sums fit two tiles across. */
export function TileMoney({ cents }: { cents: number }) {
  return <span className="text-xl sm:text-2xl">{fmtMoney(cents)}</span>;
}

/** The term at a glance: four headline numbers. */
export function BudgetTiles({ planned, money: m, lineCount, termName }: { planned: Planned; money: Money; lineCount: number; termName: string }) {
  const share = m.requested ? Math.round((m.approved / m.requested) * 100) : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Planned" value={<TileMoney cents={planned.totalCents} />} hint={lineCount ? `${plural(lineCount, "cost line")} in ${termName}` : `No costs in ${termName} yet`} />
      <Stat
        label="Not requested yet"
        value={<TileMoney cents={planned.unrequestedCents} />}
        hint={!lineCount ? "Add costs to request funding" : planned.unrequestedCents ? "Lines no request covers yet" : "Every line is covered"}
      />
      <Stat label="Requested" value={<TileMoney cents={m.requested} />} hint={m.pending ? `${fmtMoney(m.pending)} still in review` : m.requested ? "Every request is decided" : "Nothing submitted yet"} />
      <Stat label="Approved" value={<TileMoney cents={m.approved} />} hint={share === null ? "Decisions show up here" : `${share}% of what you asked for`} />
    </div>
  );
}

/**
 * Planned, requested and approved money by funding source. A table, not a
 * chart: four sources × three amounts read best as numbers. Narrow spaces
 * (phones, and `compact` side panels) get a stacked list instead, so no
 * amount is ever cut off.
 */
export function SourceBreakdown({ planned, money: m, club, className, compact }: { planned: Planned; money: Money; club?: SourceContext | null; className?: string; compact?: boolean }) {
  const rows = SOURCE_ORDER.map((s) => {
    const name = sourceName(s, club);
    const [label, detail] = name.includes(" · ") ? name.split(" · ") : [name, null];
    return { s, label, detail, planned: planned.bySource[s], requested: m.bySource[s].requested, approved: m.bySource[s].approved, quiet: !planned.bySource[s] && !m.bySource[s].requested };
  });
  const totals = { planned: planned.totalCents, requested: m.requested, approved: m.approved };
  const active = rows.filter((r) => !r.quiet);
  const quiet = rows.filter((r) => r.quiet);

  const stacked = (
    <div className={cn("overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface", !compact && "sm:hidden")}>
      <ul className="divide-y divide-line" aria-label="Money by funding source">
        {active.map((r) => (
          <li key={r.s} className="px-3 py-2.5">
            <p className="text-sm font-medium text-ink">
              {r.label}
              {r.detail ? <span className="block text-xs font-normal text-ink-3">{r.detail}</span> : null}
            </p>
            <AmountTrio planned={r.planned} requested={r.requested} approved={r.approved} />
          </li>
        ))}
        <li className="bg-muted/40 px-3 py-2.5">
          <p className="text-sm font-semibold text-ink">Total</p>
          <AmountTrio planned={totals.planned} requested={totals.requested} approved={totals.approved} strong />
        </li>
      </ul>
      {quiet.length ? <p className="border-t border-line px-3 py-2 text-xs text-ink-3">Nothing planned or requested from {listJoin(quiet.map((r) => r.label))}.</p> : null}
    </div>
  );
  if (compact) return <div className={className}>{stacked}</div>;

  return (
    <div className={className}>
      {stacked}
      <div className="hidden overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface sm:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Money by funding source</caption>
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-ink-3">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Source
              </th>
              {(["Planned", "Requested", "Approved"] as const).map((h) => (
                <th key={h} scope="col" className="px-4 py-2.5 text-right font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.s} className={r.quiet ? "text-ink-3" : undefined}>
                <th scope="row" className={cn("px-4 py-2.5 text-left font-medium", r.quiet ? "text-ink-3" : "text-ink")}>
                  {r.label}
                  {r.detail ? <span className="block text-xs font-normal text-ink-3">{r.detail}</span> : null}
                </th>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(r.planned)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(r.requested)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(r.approved)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line bg-muted/40 font-semibold text-ink">
            <tr>
              <th scope="row" className="px-4 py-2.5 text-left">
                Total
              </th>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(totals.planned)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(totals.requested)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(totals.approved)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function AmountTrio({ planned, requested, approved, strong }: { planned: number; requested: number; approved: number; strong?: boolean }) {
  const items = [
    ["Planned", planned],
    ["Requested", requested],
    ["Approved", approved],
  ] as const;
  return (
    <dl className="mt-1 grid grid-cols-3 gap-2">
      {items.map(([label, cents]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-ink-3">{label}</dt>
          <dd className={cn("text-sm tabular-nums", strong ? "font-semibold text-ink" : cents ? "text-ink" : "text-ink-3")}>{strong ? fmtMoney(cents) : money(cents)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "University", "University and College", "University, College and WSUSA". */
function listJoin(words: string[]) {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}
