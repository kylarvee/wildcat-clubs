import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, GraduationCap, Link2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

export type SeatCardHolder = {
  assignmentId: string;
  person: { name: string; handle: string; avatarUrl: string | null; avatarColor: string };
  internalTitle?: string | null;
  viaClub?: { name: string; slug: string } | null;
  /** Where they stand on WSUSA requirements — only pass for leader viewers. */
  training?: "pending" | "overdue" | null;
  /** Extra line under the name (e.g. "Since Sep 2025"). */
  meta?: ReactNode;
  /** Per-holder controls (manage view). */
  actions?: ReactNode;
};

/**
 * One org chart seat: its name, who holds it, their internal titles, and a
 * Responsibilities disclosure — so anyone can see who's accountable for what.
 * Presentational and hook-free: the public chart and the Org Chart tool share it.
 */
export function SeatCard({
  name,
  roleLabel,
  responsibilities,
  maxHolders,
  holders,
  actions,
  footer,
  note,
  className,
  headingLevel = 3,
}: {
  name: string;
  roleLabel: string;
  responsibilities: string[];
  maxHolders: number;
  holders: SeatCardHolder[];
  actions?: ReactNode;
  footer?: ReactNode;
  note?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3 | 4;
}) {
  const vacant = holders.length === 0;
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <article
      aria-label={`${name}${vacant ? " (vacant)" : ""}`}
      className={cn(
        "flex h-full flex-col gap-3 rounded-[var(--radius-card)] border p-4 text-left",
        vacant ? "border-dashed border-amber-300 bg-warning-50/50" : "border-line bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{roleLabel}</p>
          <H className="text-[15px] font-semibold leading-snug text-ink">{name}</H>
        </div>
        {vacant ? (
          <Badge tone="warning">Vacant</Badge>
        ) : maxHolders > 1 ? (
          // Spelled out for screen readers ("1/2" reads as a fraction) and touch (no hover title).
          <span className="mt-0.5 text-xs tabular-nums text-ink-3">
            <span aria-hidden="true">
              {holders.length}/{maxHolders}
            </span>
            <span className="sr-only">
              {holders.length} of {maxHolders} spots filled
            </span>
          </span>
        ) : null}
        {actions}
      </header>

      {vacant ? (
        <p className="text-sm text-amber-900/80">No one holds this seat right now.</p>
      ) : (
        <ul className="space-y-2.5">
          {holders.map((h) => (
            <li key={h.assignmentId} className="flex items-start gap-3">
              <Avatar name={h.person.name} src={h.person.avatarUrl} color={h.person.avatarColor} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <Link href={`/u/${h.person.handle}`} className="block truncate text-sm font-medium text-ink hover:text-brand-600 hover:underline">
                  {h.person.name}
                </Link>
                {h.internalTitle ? <p className="truncate text-xs text-ink-2">{h.internalTitle}</p> : null}
                {h.viaClub ? (
                  <p className="flex items-center gap-1 truncate text-xs text-ink-3">
                    <Link2 className="h-3 w-3 shrink-0" aria-hidden /> Placed by{" "}
                    <Link href={`/clubs/${h.viaClub.slug}`} className="hover:underline">
                      {h.viaClub.name}
                    </Link>
                  </p>
                ) : null}
                {h.meta ? <p className="text-xs text-ink-3">{h.meta}</p> : null}
                {h.training ? (
                  <p className={cn("mt-0.5 flex items-center gap-1 text-xs font-medium", h.training === "overdue" ? "text-danger" : "text-warning")}>
                    <GraduationCap className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {h.training === "overdue" ? "Requirement overdue — permissions paused" : "WSUSA requirements pending"}
                  </p>
                ) : null}
              </div>
              {h.actions}
            </li>
          ))}
        </ul>
      )}

      {note}

      {responsibilities.length > 0 ? (
        <details className="group mt-auto border-t border-line pt-2.5 text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md font-medium text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
            <span>
              Responsibilities <span className="font-normal text-ink-3">({responsibilities.length})</span>
            </span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2 marker:text-ink-3">
            {responsibilities.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {footer ? <div className={cn(responsibilities.length ? "" : "mt-auto", "pt-1")}>{footer}</div> : null}
    </article>
  );
}
