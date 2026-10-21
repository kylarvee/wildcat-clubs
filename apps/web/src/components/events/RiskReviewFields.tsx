"use client";

import { useId, useState } from "react";
import type { EventReview, EventRisk } from "@prisma/client";
import { Car, Plus, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { reviewLine, RISK_FLAGS, riskLabel, type TravelDriver, type TravelPlan } from "@/lib/events/review";
import { fromInputs, toDateInput, toTimeInput } from "@/lib/events/wallclock";

/** What the editor knows about review for this club (lib/events/queries reviewSettings). */
export type ReviewSettings = {
  /** System settings `events.riskReview`. */
  on: boolean;
  /** System settings `events.largeCrowd`. */
  largeCrowd: number;
  /** The club's office: who reviews, and how long it usually takes. */
  office: { name: string; reviewDays: number };
  /** The club's members and leaders, for picking drivers. */
  drivers: { id: string; name: string }[];
};

/** The trip as the form holds it: campus dates and times as typed. */
export type TravelDraft = {
  destination: string;
  leaveDate: string;
  leaveTime: string;
  returnDate: string;
  returnTime: string;
  overnight: "" | "yes" | "no";
  drivers: TravelDriver[];
  notes: string;
};

export function travelDraft(plan: TravelPlan | null, eventStart: Date | null): TravelDraft {
  if (plan) {
    return {
      destination: plan.destination,
      leaveDate: toDateInput(plan.departsAt),
      leaveTime: toTimeInput(plan.departsAt),
      returnDate: toDateInput(plan.returnsAt),
      returnTime: toTimeInput(plan.returnsAt),
      overnight: plan.overnight ? "yes" : "no",
      drivers: plan.drivers,
      notes: plan.notes ?? "",
    };
  }
  const day = eventStart ? toDateInput(eventStart) : "";
  return { destination: "", leaveDate: day, leaveTime: "", returnDate: day, returnTime: "", overnight: "", drivers: [], notes: "" };
}

/** The trip to send, or what's missing (the server checks it again: lib/events/review travelPlan). */
export function travelOut(d: TravelDraft): { ok: true; value: { destination: string; departsAt: string; returnsAt: string; overnight: boolean; drivers: TravelDriver[]; notes: string } } | { ok: false; error: string } {
  if (d.destination.trim().length < 2) return { ok: false, error: "Add where the trip is going." };
  const leaves = fromInputs(d.leaveDate, d.leaveTime);
  const returns = fromInputs(d.returnDate, d.returnTime);
  if (!leaves || !d.leaveTime) return { ok: false, error: "Add the day and time the trip leaves." };
  if (!returns || !d.returnTime) return { ok: false, error: "Add the day and time the trip comes back." };
  if (returns <= leaves) return { ok: false, error: "The trip has to come back after it leaves." };
  if (!d.overnight) return { ok: false, error: "Say whether the trip is overnight." };
  return { ok: true, value: { destination: d.destination.trim(), departsAt: leaves.toISOString(), returnsAt: returns.toISOString(), overnight: d.overnight === "yes", drivers: d.drivers, notes: d.notes.trim() } };
}

/**
 * The Events Builder's "Does this event involve…" checklist (lib/events/review),
 * with the trip's details right here when Travel is checked, and a line saying
 * what happens next: the club's office reviews it before it's posted, or (with
 * nothing checked, or review off) it's posted on save.
 */
export function RiskReviewFields({
  flags,
  onFlagsChange,
  travel,
  onTravelChange,
  settings,
  status,
  savedFlags,
}: {
  flags: EventRisk[];
  onFlagsChange: (flags: EventRisk[]) => void;
  travel: TravelDraft;
  onTravelChange: (t: TravelDraft) => void;
  settings: ReviewSettings;
  /** The saved event's review, if it has been saved. */
  status: EventReview | null;
  /** The answers as saved, so the line can say when a change sends it back for review. */
  savedFlags: EventRisk[];
}) {
  const id = useId();
  const toggle = (f: EventRisk) => onFlagsChange(RISK_FLAGS.filter((x) => (x === f ? !flags.includes(f) : flags.includes(x))));
  const office = settings.office.name;
  const added = flags.some((f) => !savedFlags.includes(f));
  const published = status === "APPROVED" || status === "NONE";

  let line: string;
  if (!flags.length) line = "Nothing checked, so it's posted as soon as you save.";
  else if (!settings.on) line = "Event review is off right now, so it's posted as soon as you save. Your answers are saved with it.";
  else if (status === "APPROVED" && !added) line = `${office} already approved it. Checking something new or changing the trip sends it back for review.`;
  else if (status === "PENDING") line = `It's waiting for ${office}'s review. Your changes go to them as you save.`;
  else if (status === "CHANGES_REQUESTED") line = `Saving sends it back to ${office} for review.`;
  else line = `${reviewLine(settings.office)} Until then only your club's leaders and ${office} can see it.`;

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="sr-only">Does this event involve…</legend>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {RISK_FLAGS.map((f) => (
            <Checkbox key={f} label={riskLabel(f, settings.largeCrowd)} checked={flags.includes(f)} onChange={() => toggle(f)} className="rounded-lg border border-line px-3 py-2.5 hover:bg-muted/50" />
          ))}
        </div>
      </fieldset>

      {flags.includes("TRAVEL") ? <TravelFields value={travel} onChange={onTravelChange} drivers={settings.drivers} /> : null}

      <p id={`${id}-next`} className={cn("flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm", flags.length && settings.on && !(published && !added && status === "APPROVED") ? "bg-warning-50 text-ink" : "bg-muted/70 text-ink-2")} aria-live="polite">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
        <span>{line}</span>
      </p>
    </div>
  );
}

/** Destination, leaving and coming back, overnight, drivers and notes. */
function TravelFields({ value, onChange, drivers }: { value: TravelDraft; onChange: (t: TravelDraft) => void; drivers: { id: string; name: string }[] }) {
  const id = useId();
  const [pick, setPick] = useState("");
  const [typed, setTyped] = useState("");
  const set = (patch: Partial<TravelDraft>) => onChange({ ...value, ...patch });
  const picked = new Set(value.drivers.map((d) => d.userId).filter(Boolean));
  const choices = drivers.filter((d) => !picked.has(d.id));
  const addPicked = () => {
    const d = drivers.find((x) => x.id === pick);
    if (!d) return;
    set({ drivers: [...value.drivers, { userId: d.id, name: d.name }] });
    setPick("");
  };
  const addTyped = () => {
    const name = typed.trim();
    if (name.length < 2 || value.drivers.some((d) => !d.userId && d.name.toLowerCase() === name.toLowerCase())) return;
    set({ drivers: [...value.drivers, { userId: null, name }] });
    setTyped("");
  };

  return (
    <fieldset className="space-y-4 rounded-xl border border-line bg-muted/30 p-4">
      <legend className="px-1 text-sm font-semibold text-ink">The trip</legend>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-dest`}>
          Where to <span className="text-danger">*</span>
        </Label>
        <Input id={`${id}-dest`} value={value.destination} maxLength={200} placeholder="e.g. Utah State University, Logan" onChange={(e) => set({ destination: e.target.value })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink" id={`${id}-leave`}>
            Leaves <span className="text-danger">*</span>
          </span>
          <div className="flex gap-2" role="group" aria-labelledby={`${id}-leave`}>
            <Input type="date" aria-label="Day the trip leaves" value={value.leaveDate} onChange={(e) => set({ leaveDate: e.target.value })} className="min-w-0 flex-1" />
            <Input type="time" aria-label="Time the trip leaves" value={value.leaveTime} onChange={(e) => set({ leaveTime: e.target.value })} className="w-32" />
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink" id={`${id}-back`}>
            Comes back <span className="text-danger">*</span>
          </span>
          <div className="flex gap-2" role="group" aria-labelledby={`${id}-back`}>
            <Input type="date" aria-label="Day the trip comes back" value={value.returnDate} onChange={(e) => set({ returnDate: e.target.value })} className="min-w-0 flex-1" />
            <Input type="time" aria-label="Time the trip comes back" value={value.returnTime} onChange={(e) => set({ returnTime: e.target.value })} className="w-32" />
          </div>
        </div>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">
          Staying overnight? <span className="text-danger">*</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["yes", "Yes, overnight"],
              ["no", "No, same day"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand", value.overnight === v ? "border-brand bg-brand-50" : "border-line-2 bg-surface hover:bg-muted")}>
              <input type="radio" name={`${id}-overnight`} checked={value.overnight === v} onChange={() => set({ overnight: v })} className="accent-[var(--color-brand)]" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-2">
        <span className="block text-sm font-medium text-ink">Drivers</span>
        {value.drivers.length ? (
          <ul className="flex flex-wrap gap-2" aria-label="Drivers">
            {value.drivers.map((d, i) => (
              <li key={`${d.userId ?? "n"}-${d.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-full bg-surface py-1 pl-3 pr-1 text-sm ring-1 ring-inset ring-line-2">
                <Car className="h-3.5 w-3.5 text-ink-3" aria-hidden />
                {d.name}
                {d.userId ? null : <span className="text-xs text-ink-3">(typed)</span>}
                <button
                  type="button"
                  onClick={() => set({ drivers: value.drivers.filter((_, j) => j !== i) })}
                  className="rounded-full p-1 text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
                  aria-label={`Remove ${d.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-3">Nobody yet. Leave it empty if nobody from the club is driving (a bus or a flight).</p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex gap-2">
            <Select aria-label="Pick a club member who's driving" value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1">
              <option value="">Pick a club member…</option>
              {choices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Button type="button" variant="outline" onClick={addPicked} disabled={!pick}>
              <Plus className="h-4 w-4" aria-hidden /> Add
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              aria-label="Or type a driver's name"
              value={typed}
              maxLength={80}
              placeholder="Or type a name"
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTyped();
                }
              }}
              className="min-w-0 flex-1"
            />
            <Button type="button" variant="outline" onClick={addTyped} disabled={typed.trim().length < 2}>
              <Plus className="h-4 w-4" aria-hidden /> Add
            </Button>
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-notes`}>
          Notes for the reviewer <span className="font-normal text-ink-3">(optional)</span>
        </Label>
        <Textarea id={`${id}-notes`} rows={2} maxLength={1000} value={value.notes} placeholder="Vehicles, where you're staying, who to call on the road" onChange={(e) => set({ notes: e.target.value })} />
      </div>
    </fieldset>
  );
}
