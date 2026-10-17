"use client";

import { useState } from "react";
import type { FundingSource } from "@prisma/client";
import { Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { useRunAction } from "@/components/roles/useRunAction";
import { fmtMoney } from "@/lib/time";
import { COST_CATEGORIES, FUNDING_SOURCES } from "@/lib/events/labels";
import { MAX_LINE_CENTS, dollarsToCents, lineCents } from "@/lib/funding/math";
import { addCostAction, removeCostAction, updateCostAction } from "@/app/clubs/[slug]/manage/budget/actions";

export type CostItem = { id: string; description: string; category: string; quantity: number; unitCostCents: number; fundingSource: FundingSource; termId: string };
export type CostDialogContext = {
  clubId: string;
  terms: { id: string; name: string }[];
  defaultTermId: string;
  defaultSource: FundingSource;
  /** Display names for each source ("Department · Nursing"). */
  sourceNames: Record<FundingSource, string>;
};

const moneyInput = (cents: number) => (cents / 100).toFixed(2);

/**
 * Add or edit a general cost (one not tied to an event — T-shirts, a banner,
 * a competition fee). Event costs are edited in the Events Builder instead.
 */
export function CostDialog({ ctx, item, open, onOpenChange }: { ctx: CostDialogContext; item?: CostItem; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [description, setDescription] = useState(item?.description ?? "");
  const [category, setCategory] = useState(item?.category ?? "Supplies");
  const [quantity, setQuantity] = useState(item ? String(item.quantity) : "1");
  const [unitCost, setUnitCost] = useState(item ? moneyInput(item.unitCostCents) : "");
  const [source, setSource] = useState<FundingSource>(item?.fundingSource ?? ctx.defaultSource);
  const [termId, setTermId] = useState(item?.termId ?? ctx.defaultTermId);
  const { pending, error, setError, run } = useRunAction();

  const q = Number(quantity);
  const u = Number(unitCost);
  const valid = Number.isFinite(q) && q > 0 && unitCost.trim() !== "" && Number.isFinite(u) && u >= 0;
  const total = valid ? lineCents(q, dollarsToCents(u)) : 0;

  function reset() {
    setDescription("");
    setCategory("Supplies");
    setQuantity("1");
    setUnitCost("");
    setSource(ctx.defaultSource);
    setTermId(ctx.defaultTermId);
  }

  async function save() {
    if (!description.trim()) return setError("Describe what the money is for.");
    if (!(q > 0)) return setError("The quantity needs to be more than zero.");
    if (unitCost.trim() === "" || !(u >= 0)) return setError("Enter the cost per item in dollars, like 12.50.");
    if (total > MAX_LINE_CENTS) return setError(`One cost line can be up to ${fmtMoney(MAX_LINE_CENTS)}. Split bigger purchases into separate lines.`);
    const fields = { termId, description: description.trim(), category, quantity: q, unitCost: u, fundingSource: source };
    const r = item
      ? await run(() => updateCostAction(item.id, fields), { success: `Saved “${fields.description}”.` })
      : await run(() => addCostAction({ clubId: ctx.clubId, ...fields }), { success: `Added “${fields.description}” to the budget.` });
    if (r.ok) {
      onOpenChange(false);
      if (!item) reset();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setError(null);
      }}
    >
      <DialogContent title={item ? "Edit cost" : "Add a cost"} description="For costs that aren't tied to one event. Event costs live in each event's Costs section.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="What it's for" required>
            {(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="e.g. Club T-shirts for the Involvement Fair" autoFocus required />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity" required>
              {(id) => <Input id={id} type="number" inputMode="decimal" min={0} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />}
            </Field>
            <Field label="Cost each ($)" required>
              {(id) => <Input id={id} type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} required />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              {(id) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {[...new Set([...COST_CATEGORIES, category])].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Semester">
              {(id) => (
                <Select id={id} value={termId} onChange={(e) => setTermId(e.target.value)}>
                  {ctx.terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Funding from" hint={source === ctx.defaultSource ? "Your club's usual source." : undefined}>
            {(id) => (
              <Select id={id} value={source} onChange={(e) => setSource(e.target.value as FundingSource)}>
                {FUNDING_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {ctx.sourceNames[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex items-baseline justify-between rounded-xl bg-muted/60 px-3 py-2 text-sm" aria-live="polite">
            <span className="text-ink-2">{valid ? `${q.toLocaleString("en-US")} × ${fmtMoney(dollarsToCents(u))}` : "Line total"}</span>
            <span className="text-base font-semibold tabular-nums text-ink">{fmtMoney(total)}</span>
          </div>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {item ? "Save cost" : "Add cost"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddCostButton({ ctx, variant = "outline" }: { ctx: CostDialogContext; variant?: "primary" | "outline" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> Add a cost
      </Button>
      {/* Keyed so a fresh form opens each time. */}
      <CostDialog key={open ? "open" : "closed"} ctx={ctx} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Edit / remove menu for one general cost line. */
export function CostRowActions({ ctx, item }: { ctx: CostDialogContext; item: CostItem }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { pending, run } = useRunAction();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${item.description}`} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MoreHorizontal className="h-4 w-4" aria-hidden />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem danger onSelect={() => setConfirming(true)}>
            <Trash2 className="h-4 w-4" aria-hidden /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CostDialog key={editing ? "edit" : "idle"} ctx={ctx} item={item} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove “${item.description}”?`}
        description="It comes off this semester's budget. Draft requests that included it drop the line; requests you already submitted keep their copy."
        confirmLabel="Remove cost"
        danger
        onConfirm={() => {
          void run(() => removeCostAction(item.id), { success: `Removed “${item.description}”.`, toastError: true });
        }}
      />
    </>
  );
}
