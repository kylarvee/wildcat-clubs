"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { PermissionChecklist } from "@/components/roles/PermissionChecklist";
import { useRunAction } from "@/components/roles/useRunAction";
import { createSeat, updateSeat } from "../actions";
import type { SeatInfo, ToolContext } from "./types";

/**
 * Add or edit a seat: name, tier (new seats only), responsibilities (one per
 * line), default permissions for whoever takes it, and how many can hold it.
 */
export function SeatDialog({ ctx, seat, open, onOpenChange }: { ctx: ToolContext; seat?: SeatInfo; open: boolean; onOpenChange: (o: boolean) => void }) {
  const editing = Boolean(seat);
  const [name, setName] = useState(seat?.name ?? "");
  const [role, setRole] = useState<"OFFICER" | "AMBASSADOR">(seat?.role === "AMBASSADOR" ? "AMBASSADOR" : "OFFICER");
  const [items, setItems] = useState<string[]>(seat?.responsibilities.length ? seat.responsibilities : [""]);
  const [defaults, setDefaults] = useState<string[]>(seat?.defaultPermissions ?? []);
  const [max, setMax] = useState<string>(String(seat?.maxHolders ?? 1));
  const listRef = useRef<HTMLOListElement>(null);
  const { pending, error, setError, run } = useRunAction();
  const leaderSeat = seat?.role === "PRESIDENT" || seat?.role === "VP";
  const minHolders = Math.max(1, seat?.holders.length ?? 0);

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) setError(null);
  }

  function addItem(after?: number) {
    setItems((cur) => {
      const next = [...cur];
      next.splice(after === undefined ? next.length : after + 1, 0, "");
      return next;
    });
    // Focus the new row once it renders.
    requestAnimationFrame(() => {
      const inputs = listRef.current?.querySelectorAll("input");
      inputs?.[after === undefined ? inputs.length - 1 : after + 1]?.focus();
    });
  }

  function move(i: number, d: -1 | 1) {
    setItems((cur) => {
      const next = [...cur];
      const j = i + d;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    const responsibilities = items.map((s) => s.trim()).filter(Boolean);
    const maxHolders = Number(max);
    if (!name.trim()) return setError("Give the seat a name.");
    if (!Number.isInteger(maxHolders) || maxHolders < minHolders || maxHolders > 50) return setError(`The holder limit has to be between ${minHolders} and 50.`);
    const r = seat
      ? await run(() => updateSeat(ctx.slug, seat.id, { name: name.trim(), responsibilities, ...(leaderSeat ? {} : { defaultPermissions: defaults }), maxHolders }), {
          success: `Saved ${name.trim()}.`,
        })
      : await run(() => createSeat(ctx.slug, { clubId: ctx.clubId, name: name.trim(), role, responsibilities, defaultPermissions: defaults, maxHolders }), {
          success: `Added ${name.trim()} to the org chart.`,
        });
    if (r.ok) {
      onOpenChange(false);
      if (!seat) {
        setName("");
        setItems([""]);
        setDefaults([]);
        setMax("1");
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent wide title={editing ? `Edit ${seat!.name}` : "Add a seat"} description={editing ? `${seat!.roleLabel} seat` : "Officer and ambassador seats show on the org chart under the vice presidents."}>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <Field label="Seat name" required>
              {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Outreach Chair" required autoFocus />}
            </Field>
            <Field label="Max holders" hint={minHolders > 1 ? `At least ${minHolders} (current holders)` : "Co-holders allowed above 1"}>
              {(id) => <Input id={id} type="number" inputMode="numeric" min={minHolders} max={50} value={max} onChange={(e) => setMax(e.target.value)} />}
            </Field>
          </div>

          {!editing ? (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink">Tier</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["OFFICER", "Officer", "Runs part of the club with the permissions you choose."],
                    ["AMBASSADOR", "Ambassador", "Represents the club; usually no tool permissions."],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-xl border p-3 focus-within:ring-2 focus-within:ring-brand-100",
                      role === value ? "border-brand bg-brand-50" : "border-line-2 hover:bg-muted/50",
                    )}
                  >
                    <input type="radio" name="tier" value={value} checked={role === value} onChange={() => setRole(value)} className="mt-1 accent-[var(--color-brand)]" />
                    <span className="text-sm">
                      <span className="block font-medium text-ink">{label}</span>
                      <span className="text-ink-3">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-ink">Responsibilities</legend>
            <p className="mb-2 text-xs text-ink-3">One per line. Everyone can read these on the club page — be specific about what this person owns.</p>
            <ol ref={listRef} className="space-y-2">
              {items.map((item, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-3">{i + 1}.</span>
                  <Input
                    aria-label={`Responsibility ${i + 1}`}
                    value={item}
                    maxLength={200}
                    onChange={(e) => setItems((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addItem(i);
                      }
                    }}
                    placeholder="e.g. Books rooms for every meeting"
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Move responsibility ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Move responsibility ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Remove responsibility ${i + 1}`} onClick={() => setItems((cur) => (cur.length === 1 ? [""] : cur.filter((_, j) => j !== i)))}>
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ol>
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => addItem()} disabled={items.length >= 20}>
              <Plus className="h-4 w-4" aria-hidden /> Add responsibility
            </Button>
          </fieldset>

          {leaderSeat ? (
            <Callout tone="info">Presidents and vice presidents always have every permission, so this seat has no default permissions to set.</Callout>
          ) : (
            <div className="space-y-1">
              <PermissionChecklist options={ctx.capabilities} value={defaults} onChange={setDefaults} legend="Default permissions" />
              <p className="text-xs text-ink-3">Pre-checked when someone is assigned to this seat. Changing them doesn&apos;t affect people already in it.</p>
            </div>
          )}

          {error ? <Callout tone="danger">{error}</Callout> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {editing ? "Save seat" : "Add seat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
