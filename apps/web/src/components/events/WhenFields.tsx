"use client";

import { useId, useMemo } from "react";
import type { Recurrence } from "@prisma/client";
import { Repeat } from "lucide-react";
import { Checkbox, Input, Label, Select } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { RECURRENCE_LABEL, WEEKDAY_SHORT } from "@/lib/events/recurrence";
import { describeRecurrence } from "@/lib/events/summary";
import { campusParts, fromInputs } from "@/lib/events/wallclock";
import { fmtDate } from "@/lib/time";
import { previewOccurrences, termsFromJson, type WhenValue } from "@/components/events/when";
import type { TermJson } from "@/lib/events/types";

const RECURRENCES: Recurrence[] = ["NONE", "DAILY", "WEEKLY", "MONTHLY", "SEMESTERLY", "ACADEMIC_YEARLY", "YEARLY"];
const UNIT: Record<Recurrence, [string, string]> = {
  NONE: ["", ""],
  DAILY: ["day", "days"],
  WEEKLY: ["week", "weeks"],
  MONTHLY: ["month", "months"],
  SEMESTERLY: ["semester", "semesters"],
  ACADEMIC_YEARLY: ["academic year", "academic years"],
  YEARLY: ["year", "years"],
};
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Date, time and repeat-rule inputs (campus time). `compact` hides the end date
 * (quick-create); the full editor shows start and end like Google Calendar.
 */
export function WhenFields({ value, onChange, terms, compact }: { value: WhenValue; onChange: (v: WhenValue) => void; terms: TermJson[]; compact?: boolean }) {
  const id = useId();
  const set = (patch: Partial<WhenValue>) => onChange({ ...value, ...patch });
  const termRows = useMemo(() => termsFromJson(terms), [terms]);
  const preview = useMemo(() => (value.recurrence === "NONE" ? [] : previewOccurrences(value, termRows)), [value, termRows]);
  const start = fromInputs(value.date, value.allDay ? "00:00" : value.startTime);
  const startDow = start ? campusParts(start).dow : 0;

  function setStartDate(date: string) {
    // Keep the same length when the start date moves.
    const patch: Partial<WhenValue> = { date };
    if (value.endDate === value.date || !value.endDate) patch.endDate = date;
    if (value.recurrence === "WEEKLY" && value.weekdays.length <= 1) {
      const s = fromInputs(date, "12:00");
      if (s) patch.weekdays = [campusParts(s).dow];
    }
    set(patch);
  }

  function setRecurrence(r: Recurrence) {
    set({ recurrence: r, weekdays: r === "WEEKLY" && value.weekdays.length === 0 ? [startDow] : value.weekdays });
  }

  function toggleDay(d: number) {
    const has = value.weekdays.includes(d);
    const next = has ? value.weekdays.filter((x) => x !== d) : [...value.weekdays, d].sort();
    if (next.length) set({ weekdays: next });
  }

  return (
    <div className="space-y-4">
      <div className={cn("grid gap-3", compact ? "grid-cols-2 sm:grid-cols-[1.4fr_1fr_1fr]" : "grid-cols-2 sm:grid-cols-[1.4fr_1fr]")}>
        <div className={cn("space-y-1.5", compact ? "col-span-2 sm:col-span-1" : "")}>
          <Label htmlFor={`${id}-date`}>{compact ? "Date" : "Starts"}</Label>
          <Input id={`${id}-date`} type="date" required value={value.date} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        {!value.allDay ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-start`}>{compact ? "From" : "Start time"}</Label>
            <Input id={`${id}-start`} type="time" required value={value.startTime} onChange={(e) => set({ startTime: e.target.value })} />
          </div>
        ) : null}
        {compact && !value.allDay ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-end`}>To</Label>
            <Input id={`${id}-end`} type="time" required value={value.endTime} onChange={(e) => set({ endTime: e.target.value })} />
          </div>
        ) : null}
        {!compact && !value.allDay ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-enddate`}>Ends</Label>
              <Input id={`${id}-enddate`} type="date" min={value.date} value={value.endDate || value.date} onChange={(e) => set({ endDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-end`}>End time</Label>
              <Input id={`${id}-end`} type="time" required value={value.endTime} onChange={(e) => set({ endTime: e.target.value })} />
            </div>
          </>
        ) : null}
      </div>
      <Checkbox label="All day" checked={value.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
      <p className="text-xs text-ink-3">Times are Ogden campus time (Mountain).</p>

      <div className="space-y-3 rounded-xl border border-line bg-muted/40 p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <Label htmlFor={`${id}-rec`} className="flex items-center gap-1.5">
              <Repeat className="h-3.5 w-3.5 text-ink-3" aria-hidden /> Repeats
            </Label>
            <Select id={`${id}-rec`} value={value.recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              {RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {r === "WEEKLY" ? `Weekly${value.weekdays.length <= 1 ? ` on ${WEEKDAY_FULL[value.weekdays[0] ?? startDow]}` : ""}` : RECURRENCE_LABEL[r]}
                </option>
              ))}
            </Select>
          </div>
          {value.recurrence !== "NONE" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-int`}>Every</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${id}-int`}
                  type="number"
                  min={1}
                  max={52}
                  className="w-20"
                  value={value.interval}
                  onChange={(e) => set({ interval: Math.max(1, Math.min(52, Number(e.target.value) || 1)) })}
                />
                <span className="text-sm text-ink-2">{UNIT[value.recurrence][value.interval === 1 ? 0 : 1]}</span>
              </div>
            </div>
          ) : null}
        </div>

        {value.recurrence === "WEEKLY" ? (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">On</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_SHORT.map((d, i) => {
                const on = value.weekdays.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    aria-label={WEEKDAY_FULL[i]}
                    onClick={() => toggleDay(i)}
                    className={cn(
                      "h-9 w-11 rounded-lg border text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                      on ? "border-brand bg-brand text-white" : "border-line-2 bg-surface text-ink-2 hover:bg-muted",
                    )}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {value.recurrence !== "NONE" ? (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink">Ends</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={`${id}-ends`} className="accent-[var(--color-brand)]" checked={value.ends === "never"} onChange={() => set({ ends: "never" })} />
              After a year
            </label>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name={`${id}-ends`} className="accent-[var(--color-brand)]" checked={value.ends === "on"} onChange={() => set({ ends: "on", until: value.until || value.date })} />
                On
              </label>
              <Input
                type="date"
                aria-label="Repeat until"
                className="h-9 w-auto"
                min={value.date}
                value={value.until}
                disabled={value.ends !== "on"}
                onChange={(e) => set({ until: e.target.value, ends: "on" })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name={`${id}-ends`} className="accent-[var(--color-brand)]" checked={value.ends === "after"} onChange={() => set({ ends: "after" })} />
                After
              </label>
              <Input
                type="number"
                aria-label="Number of meetings"
                className="h-9 w-20"
                min={1}
                max={400}
                value={value.count}
                disabled={value.ends !== "after"}
                onChange={(e) => set({ count: Math.max(1, Math.min(400, Number(e.target.value) || 1)), ends: "after" })}
              />
              <span>meetings</span>
            </div>
          </fieldset>
        ) : null}

        <p className="text-sm text-ink-2" aria-live="polite">
          {start ? (
            <>
              <span className="font-medium text-ink">
                {describeRecurrence({
                  startsAt: start,
                  recurrence: value.recurrence,
                  interval: value.interval,
                  weekdays: value.recurrence === "WEEKLY" ? (value.weekdays.length ? value.weekdays : [startDow]) : [],
                  until: value.ends === "on" && value.until ? fromInputs(value.until, "12:00") : null,
                  count: value.ends === "after" ? value.count : null,
                })}
              </span>
              {value.recurrence !== "NONE" && preview.length ? (
                <span className="text-ink-3">
                  {" "}
                  · {preview.length} {preview.length === 1 ? "meeting" : "meetings"}, {fmtDate(preview[0].startsAt, "MMM d")}
                  {preview.length > 1 ? ` – ${fmtDate(preview.at(-1)!.startsAt, "MMM d, yyyy")}` : ""}
                </span>
              ) : null}
              {value.recurrence !== "NONE" && preview.length === 0 ? <span className="text-danger"> · This rule doesn&apos;t land on any dates yet.</span> : null}
            </>
          ) : (
            "Pick a date to see the schedule."
          )}
        </p>
        {(value.recurrence === "SEMESTERLY" || value.recurrence === "ACADEMIC_YEARLY") && terms.length === 0 ? (
          <p className="text-xs text-warning">The academic calendar isn&apos;t set up yet, so this will only happen once until terms are added.</p>
        ) : null}
      </div>
    </div>
  );
}
