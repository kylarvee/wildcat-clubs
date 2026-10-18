"use client";

import { ClipboardCheck, FileText } from "lucide-react";
import { cn } from "@/components/ui/cn";

const KINDS = [
  { form: false, label: "Test", icon: ClipboardCheck, description: "A graded quiz with a passing score. Multiple choice is scored instantly; written answers go to a reviewer." },
  { form: true, label: "Form", icon: FileText, description: "Questions people fill out, like contact details or an acknowledgement. Nothing is graded; every question needs an answer." },
] as const;

/** Test or form: the same tool, with grading on or off. Used when creating one and in the builder's Basics. */
export function KindChoice({ isForm, onChange, disabled = false, name = "kind" }: { isForm: boolean; onChange: (isForm: boolean) => void; disabled?: boolean; name?: string }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="sr-only">Test or form</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {KINDS.map((k) => {
          const checked = isForm === k.form;
          const Icon = k.icon;
          return (
            <label
              key={k.label}
              className={cn(
                "flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors",
                checked ? "border-brand bg-brand-50/60 ring-1 ring-brand" : "border-line hover:bg-muted/50",
                disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
              )}
            >
              <input type="radio" name={name} className="mt-1 accent-[var(--color-brand)]" checked={checked} onChange={() => onChange(k.form)} />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Icon className="h-4 w-4 text-ink-3" aria-hidden /> {k.label}
                </span>
                <span className="block text-xs leading-relaxed text-ink-3">{k.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
