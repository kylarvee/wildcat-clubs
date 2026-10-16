import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** The quiet card shown in place of an embed the viewer can't see, or that no longer exists. */
export function EmbedNotice({ icon, title, children, action, className }: { icon: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-2 bg-surface px-3 py-3 sm:flex-nowrap", className)} role="note">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-3 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {children ? <p className="text-xs text-ink-3">{children}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
