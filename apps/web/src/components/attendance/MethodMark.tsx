import type { CheckInMethod } from "@prisma/client";
import { Check } from "lucide-react";
import { METHOD_LABEL } from "@/lib/attendance/rules";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

/**
 * The tracker's check mark. Each method has its own shape as well as color
 * (filled circle = QR, ring = self, square = added by a leader), so the
 * table reads without relying on color alone.
 */
export function MethodMark({ method, className, muted }: { method: CheckInMethod; className?: string; muted?: boolean }) {
  const shape = {
    QR: "rounded-full bg-brand text-white",
    SELF: "rounded-full border-2 border-brand bg-white text-brand",
    MANUAL: "rounded-[5px] bg-ink-3 text-white",
  }[method];
  return (
    <span className={cn("inline-flex h-5 w-5 items-center justify-center", shape, muted && "opacity-55", className)} aria-hidden>
      <Check className="h-3 w-3" strokeWidth={3.5} />
    </span>
  );
}

export function MethodLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-2", className)} aria-label="Legend">
      {(["QR", "SELF", "MANUAL"] as const).map((m) => (
        <li key={m} className="flex items-center gap-1.5">
          <MethodMark method={m} /> {METHOD_LABEL[m]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-5 w-5 rounded bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_3px,transparent_3px_6px)] ring-1 ring-inset ring-line" aria-hidden /> Not a member yet
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-5 w-5 rounded bg-muted ring-1 ring-inset ring-line" aria-hidden /> No check-ins recorded
      </li>
    </ul>
  );
}

export function MethodBadge({ method }: { method: CheckInMethod }) {
  return (
    <Badge tone={method === "QR" ? "brand" : method === "SELF" ? "info" : "neutral"} className="gap-1.5">
      <MethodMark method={method} className="h-3.5 w-3.5 [&>svg]:h-2.5 [&>svg]:w-2.5" />
      {METHOD_LABEL[method]}
    </Badge>
  );
}
