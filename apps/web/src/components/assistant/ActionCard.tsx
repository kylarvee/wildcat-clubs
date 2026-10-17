"use client";

import Link from "next/link";
import { useId } from "react";
import { ArrowRight, Check, CircleSlash, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { ActionCard as Card, ActionStatus } from "@/lib/ai/types";

/**
 * An action the assistant wants to take, shown before anything happens:
 * exactly what will change, then Confirm or Cancel. After a decision it stays
 * in the transcript as a record of what was done.
 */
export function ActionCard({
  card,
  status,
  outcome,
  href,
  working,
  disabled,
  onDecide,
  onLinkClick,
}: {
  card: Card;
  status: ActionStatus;
  outcome: string | null;
  href: string | null;
  /** Confirm / Cancel is being sent. */
  working: boolean;
  /** Another request is running. */
  disabled: boolean;
  onDecide: (approve: boolean) => void;
  onLinkClick?: () => void;
}) {
  const titleId = useId();
  const pending = status === "pending";
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={cn(
        "rounded-xl border p-3.5 text-sm",
        pending ? "border-brand-200 bg-brand-50/60" : status === "approved" ? "border-green-200 bg-success-50/60" : status === "failed" ? "border-amber-200 bg-warning-50/60" : "border-line bg-muted/60",
      )}
    >
      {pending ? (
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Needs your OK
        </p>
      ) : null}
      <p id={titleId} className="font-semibold text-ink [overflow-wrap:anywhere]">
        {card.title}
      </p>
      <ul className="mt-2 space-y-1.5 text-ink-2">
        {card.details.map((d, i) => (
          <li key={i} className="flex gap-2 [overflow-wrap:anywhere]">
            <span aria-hidden className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
            <span>{d}</span>
          </li>
        ))}
      </ul>
      {card.preview ? (
        <div className="mt-3 rounded-lg border border-line bg-surface">
          <p className="border-b border-line px-3 py-1.5 text-xs font-semibold text-ink [overflow-wrap:anywhere]">{card.preview.label}</p>
          <div tabIndex={0} aria-label="Full text" className="max-h-48 overflow-y-auto whitespace-pre-wrap px-3 py-2 text-ink-2 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-brand">
            {card.preview.text}
          </div>
        </div>
      ) : null}

      {pending ? (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {working ? (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-ink-3" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Working on it…
            </span>
          ) : null}
          <Button variant="outline" size="sm" disabled={disabled || working} onClick={() => onDecide(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={disabled || working} onClick={() => onDecide(true)}>
            {card.confirmLabel}
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "mt-3 flex flex-wrap items-start gap-x-2 gap-y-1 border-t pt-2.5 text-sm",
            status === "approved" ? "border-green-200 text-green-900" : status === "failed" ? "border-amber-200 text-amber-900" : "border-line text-ink-2",
          )}
        >
          {status === "approved" ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : status === "failed" ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CircleSlash className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <span className="sr-only">{status === "approved" ? "Done: " : status === "failed" ? "Didn't work: " : "Cancelled: "}</span>
            {outcome ?? (status === "approved" ? "Done." : status === "failed" ? "That didn't work." : "Cancelled — nothing changed.")}
          </span>
          {status === "approved" && href ? (
            <Link href={href} onClick={onLinkClick} className="inline-flex items-center gap-1 font-medium text-brand-600 underline-offset-2 hover:underline">
              View <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
