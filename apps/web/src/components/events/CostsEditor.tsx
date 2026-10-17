"use client";

import Link from "next/link";
import type { FundingSource } from "@prisma/client";
import { Lock, Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { fmtMoney } from "@/lib/time";
import { COST_CATEGORIES, FUNDING_LABEL, FUNDING_SOURCES } from "@/lib/events/labels";

export type CostRowValue = {
  key: string;
  id?: string;
  description: string;
  category: string;
  quantity: string;
  unitCost: string;
  perOccurrence: boolean;
  fundingSource: FundingSource;
  /** Title of the submitted or approved funding request that covers this line; it can't change then. */
  lockedBy?: string | null;
};

export function costRowCents(r: CostRowValue) {
  const q = Number(r.quantity);
  const u = Number(r.unitCost);
  if (!Number.isFinite(q) || !Number.isFinite(u) || q <= 0 || u < 0) return 0;
  return Math.round(q * Math.round(u * 100));
}

export function costTotals(rows: CostRowValue[], meetings: number) {
  const per = rows.filter((r) => r.perOccurrence).reduce((s, r) => s + costRowCents(r), 0);
  const once = rows.filter((r) => !r.perOccurrence).reduce((s, r) => s + costRowCents(r), 0);
  return { per, once, total: per * meetings + once };
}

/** Problems to fix before saving, or null. */
export function costRowsError(rows: CostRowValue[]): string | null {
  for (const [i, r] of rows.entries()) {
    const n = `Cost line ${i + 1}`;
    if (!r.description.trim()) return `${n}: describe what it's for.`;
    if (!(Number(r.quantity) > 0)) return `${n}: the quantity needs to be more than zero.`;
    if (r.unitCost.trim() === "" || !(Number(r.unitCost) >= 0)) return `${n}: enter the cost per item in dollars.`;
  }
  return null;
}

let keySeq = 0;
export const newCostKey = () => `new-${Date.now()}-${keySeq++}`;

/**
 * Event costs (the only place they're entered). "Each meeting" lines multiply
 * by the number of meetings; "Once" lines count one time. Funding requests are
 * made from these in the Budget tool; a line a request covers is read-only.
 */
export function CostsEditor({
  rows,
  onChange,
  meetings,
  defaultSource,
  budgetHref,
}: {
  rows: CostRowValue[];
  onChange: (rows: CostRowValue[]) => void;
  meetings: number;
  defaultSource: FundingSource;
  budgetHref: string | null;
}) {
  const update = (key: string, patch: Partial<CostRowValue>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () =>
    onChange([...rows, { key: newCostKey(), description: "", category: "Food & drink", quantity: "1", unitCost: "", perOccurrence: true, fundingSource: defaultSource }]);
  const totals = costTotals(rows, meetings);

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-2 px-4 py-6 text-center">
          <Wallet className="h-6 w-6 text-ink-3" aria-hidden />
          <p className="text-sm text-ink-2">No costs yet. Add food, supplies, room fees — anything this event needs money for.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => {
            const locked = Boolean(r.lockedBy);
            return (
              <li key={r.key} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <label className="text-xs font-medium text-ink-3" htmlFor={`${r.key}-d`}>
                      What it&apos;s for
                    </label>
                    <Input id={`${r.key}-d`} value={r.description} maxLength={200} placeholder="e.g. Pizza for 25 people" disabled={locked} onChange={(e) => update(r.key, { description: e.target.value })} />
                  </div>
                  <div className="pt-5 text-right">
                    <p className="text-sm font-semibold tabular-nums text-ink">{fmtMoney(costRowCents(r))}</p>
                    <p className="text-xs text-ink-3">{r.perOccurrence ? "per meeting" : "once"}</p>
                  </div>
                  {locked ? null : (
                    <Button variant="ghost" size="icon" className="mt-5 shrink-0" aria-label={`Remove cost line ${i + 1}`} onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {locked ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-3">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      Part of the funding request “{r.lockedBy}”, so it&apos;s locked to match what you asked for. Add a new line for anything extra.
                    </span>
                  </p>
                ) : null}
                <fieldset disabled={locked} className="mt-2 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-[1.3fr_0.7fr_0.9fr_1fr_1fr]">
                  <div>
                    <label className="text-xs font-medium text-ink-3" htmlFor={`${r.key}-c`}>
                      Category
                    </label>
                    <Select id={`${r.key}-c`} value={r.category} onChange={(e) => update(r.key, { category: e.target.value })}>
                      {[...new Set([...COST_CATEGORIES, r.category])].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-3" htmlFor={`${r.key}-q`}>
                      Quantity
                    </label>
                    <Input id={`${r.key}-q`} type="number" min={0} step="any" inputMode="decimal" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-3" htmlFor={`${r.key}-u`}>
                      Cost each ($)
                    </label>
                    <Input id={`${r.key}-u`} type="number" min={0} step="0.01" inputMode="decimal" placeholder="0.00" value={r.unitCost} onChange={(e) => update(r.key, { unitCost: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-3" htmlFor={`${r.key}-p`}>
                      How often
                    </label>
                    <Select id={`${r.key}-p`} value={r.perOccurrence ? "each" : "once"} onChange={(e) => update(r.key, { perOccurrence: e.target.value === "each" })}>
                      <option value="each">Each meeting</option>
                      <option value="once">Once</option>
                    </Select>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-ink-3" htmlFor={`${r.key}-f`}>
                      Funding from
                    </label>
                    <Select id={`${r.key}-f`} value={r.fundingSource} onChange={(e) => update(r.key, { fundingSource: e.target.value as FundingSource })}>
                      {FUNDING_SOURCES.map((s) => (
                        <option key={s} value={s}>
                          {FUNDING_LABEL[s]}
                        </option>
                      ))}
                    </Select>
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ul>
      )}

      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4" /> Add a cost
      </Button>

      {rows.length ? (
        <dl className="grid gap-2 rounded-xl bg-muted/60 p-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Per meeting</dt>
            <dd className="font-semibold tabular-nums">{fmtMoney(totals.per)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">One-time</dt>
            <dd className="font-semibold tabular-nums">{fmtMoney(totals.once)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
              Total · {meetings} {meetings === 1 ? "meeting" : "meetings"}
            </dt>
            <dd className="text-base font-bold tabular-nums text-ink">{fmtMoney(totals.total)}</dd>
          </div>
        </dl>
      ) : null}

      {budgetHref ? (
        <p className="text-sm text-ink-3">
          Need money for this? Costs feed the{" "}
          <Link href={budgetHref} className="font-medium text-brand-600 hover:underline">
            Budget &amp; funding tool
          </Link>
          , where you request funding from WSUSA, your department, college or the university.
        </p>
      ) : null}
    </div>
  );
}
