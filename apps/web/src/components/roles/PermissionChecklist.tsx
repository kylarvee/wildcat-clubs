"use client";

import { Checkbox } from "@/components/ui/form";

export type CapabilityOption = { key: string; label: string; description: string };

/** The modular officer permissions, each with what it unlocks. */
export function PermissionChecklist({
  options,
  value,
  onChange,
  legend = "Permissions",
  disabled,
}: {
  options: CapabilityOption[];
  value: string[];
  onChange: (next: string[]) => void;
  legend?: string;
  disabled?: boolean;
}) {
  const set = new Set(value);
  const toggle = (key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    onChange(options.map((o) => o.key).filter((k) => next.has(k)));
  };
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium text-ink">
        <span>{legend}</span>
        <span className="text-xs font-normal text-ink-3">
          {set.size} of {options.length} on ·{" "}
          <button type="button" className="text-brand-600 hover:underline" onClick={() => onChange(set.size === options.length ? [] : options.map((o) => o.key))}>
            {set.size === options.length ? "Clear all" : "Select all"}
          </button>
        </span>
      </legend>
      <div className="grid gap-x-4 gap-y-3 rounded-xl border border-line p-3 sm:grid-cols-2">
        {options.map((o) => (
          <Checkbox key={o.key} label={o.label} description={o.description} checked={set.has(o.key)} onChange={(e) => toggle(o.key, e.target.checked)} />
        ))}
      </div>
    </fieldset>
  );
}
