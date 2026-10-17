"use client";

import { useId } from "react";
import { Select } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Month + year picker that works in every browser (Firefox and Safari don't
 * have <input type="month">). Value is "YYYY-MM", or "" when not set.
 */
export function MonthYearInput({
  legend,
  value,
  onChange,
  required,
  disabled,
  minYear = 1970,
  maxYear = new Date().getFullYear() + 1,
  hint,
  error,
  className,
}: {
  legend: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  disabled?: boolean;
  minYear?: number;
  maxYear?: number;
  hint?: string;
  error?: string | null;
  className?: string;
}) {
  const id = useId();
  const [y, m] = value ? value.split("-") : ["", ""];
  const years: number[] = [];
  for (let yr = maxYear; yr >= minYear; yr--) years.push(yr);
  if (y && !years.includes(Number(y))) years.unshift(Number(y));

  // Picking only one half keeps it in the other select until both are set.
  const set = (nextY: string, nextM: string) => onChange(nextY && nextM ? `${nextY}-${nextM}` : nextY || nextM ? `${nextY || "____"}-${nextM || "__"}` : "");
  const yy = y && y !== "____" ? y : "";
  const mm = m && m !== "__" ? m : "";

  return (
    <fieldset className={cn("min-w-0 space-y-1.5", className)} disabled={disabled} aria-describedby={hint || error ? `${id}-help` : undefined}>
      <legend className="mb-1.5 block text-sm font-medium text-ink">
        {legend}
        {required ? <span className="text-danger"> *</span> : null}
      </legend>
      <div className="flex gap-2">
        <label htmlFor={`${id}-m`} className="sr-only">
          {legend} — month
        </label>
        <Select id={`${id}-m`} value={mm} onChange={(e) => set(yy, e.target.value)} className="min-w-0 flex-1" aria-invalid={Boolean(error)}>
          <option value="">Month</option>
          {MONTHS.map((name, i) => (
            <option key={name} value={String(i + 1).padStart(2, "0")}>
              {name}
            </option>
          ))}
        </Select>
        <label htmlFor={`${id}-y`} className="sr-only">
          {legend} — year
        </label>
        <Select id={`${id}-y`} value={yy} onChange={(e) => set(e.target.value, mm)} className="w-28 shrink-0" aria-invalid={Boolean(error)}>
          <option value="">Year</option>
          {years.map((yr) => (
            <option key={yr} value={yr}>
              {yr}
            </option>
          ))}
        </Select>
      </div>
      {error ? (
        <p id={`${id}-help`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-help`} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}

/** True when a MonthYearInput value is a complete "YYYY-MM". */
export function isCompleteMonth(v: string) {
  return /^\d{4}-\d{2}$/.test(v);
}
