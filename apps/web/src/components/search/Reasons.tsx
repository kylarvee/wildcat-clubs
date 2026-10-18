import { Sparkles } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** Why a club is listed for this person ("Matches your major (Nursing)", "Popular this term"). At most two come from lib/search/rank. */
export function Reasons({ reasons, className, inline = false }: { reasons: string[]; className?: string; inline?: boolean }) {
  if (!reasons.length) return null;
  if (inline) {
    return (
      <p className={cn("flex items-start gap-1.5 text-xs text-ink-2", className)}>
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" />
        <span>{reasons.join(" · ")}</span>
      </p>
    );
  }
  return (
    <ul className={cn("space-y-1 text-xs text-ink-2", className)} aria-label="Why it's suggested">
      {reasons.map((r) => (
        <li key={r} className="flex items-start gap-1.5">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" />
          <span>{r}</span>
        </li>
      ))}
    </ul>
  );
}
