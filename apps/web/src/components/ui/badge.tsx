import type { ComponentProps } from "react";
import { cn } from "@/components/ui/cn";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-muted text-ink-2 ring-line",
  brand: "bg-brand-50 text-brand ring-brand-100",
  success: "bg-success-50 text-success ring-green-200",
  warning: "bg-warning-50 text-warning ring-amber-200",
  danger: "bg-danger-50 text-danger ring-red-200",
  info: "bg-info-50 text-info ring-blue-200",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}
      {...props}
    />
  );
}
