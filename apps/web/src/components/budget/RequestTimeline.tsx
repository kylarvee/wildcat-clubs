import { Check, Circle, CircleDot, X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { fmtLongDate, fmtTime } from "@/lib/time";
import type { TimelineStep } from "@/lib/funding/timeline";

const DOT = {
  done: "bg-brand text-white",
  current: "bg-surface text-brand ring-2 ring-brand",
  upcoming: "bg-surface text-ink-3 ring-1 ring-line-2",
} as const;
const TONE_DOT = { neutral: "", success: "bg-success", warning: "bg-warning", danger: "bg-danger" } as const;

/** A request's journey, from draft to the money going through. */
export function RequestTimeline({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  return (
    <ol className={cn("space-y-0", className)} aria-label="Request progress">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const Icon = s.state === "done" ? (s.tone === "danger" ? X : Check) : s.state === "current" ? CircleDot : Circle;
        return (
          <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
            {!last ? <span className={cn("absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px", s.state === "done" ? "bg-brand-200" : "bg-line")} aria-hidden /> : null}
            <span className={cn("relative z-[1] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", DOT[s.state], s.state === "done" && TONE_DOT[s.tone])} aria-hidden>
              <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
            <div className="min-w-0 text-sm">
              <p className={cn("font-medium", s.state === "upcoming" ? "text-ink-3" : "text-ink")}>
                {s.label}
                <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (in progress)" : " (not yet)"}</span>
              </p>
              {s.at ? (
                <p className="text-xs text-ink-3">
                  {fmtLongDate(s.at)} · {fmtTime(s.at)}
                  {s.by ? ` · ${s.by}` : ""}
                </p>
              ) : null}
              {s.detail ? <p className="text-xs text-ink-3">{s.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
