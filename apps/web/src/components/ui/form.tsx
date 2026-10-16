"use client";

import { forwardRef, useId, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Button, type ButtonProps } from "@/components/ui/button";

const control =
  "w-full rounded-lg border border-line-2 bg-surface px-3 text-sm text-ink placeholder:text-ink-3 shadow-sm transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-muted disabled:text-ink-3";

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(function Textarea({ className, rows = 4, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(control, "py-2 leading-relaxed", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, ComponentProps<"select">>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(control, "h-10 pr-8", className)} {...props}>
      {children}
    </select>
  );
});

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("block text-sm font-medium text-ink", className)} {...props} />;
}

/** Label + control + hint/error, wired for accessibility. Pass the control as a render function to get the id. */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </Label>
      {children(id)}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, description, className, ...props }: ComponentProps<"input"> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={props.id ?? id} className={cn("flex cursor-pointer items-start gap-3", className)}>
      <input id={props.id ?? id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-2 accent-[var(--color-brand)]" {...props} />
      <span className="text-sm">
        <span className="font-medium text-ink">{label}</span>
        {description ? <span className="block text-ink-3">{description}</span> : null}
      </span>
    </label>
  );
}

/** Submit button that shows a spinner while its <form action> runs. */
export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}
