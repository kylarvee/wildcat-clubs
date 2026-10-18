"use client";

import { useId, useState } from "react";
import { Check, CheckCheck, EyeOff, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/form";
import { useRunAction } from "@/components/roles/useRunAction";
import type { ActionResult } from "@/lib/domain/kit";
import { closeBombingCheckAction, hideReviewAction, keepReviewAction, restoreReviewAction } from "@/app/admin/reviews/actions";

const REASONS = [
  "Part of a coordinated effort to lower the club's rating",
  "Personal attack or harassment",
  "Not about the club's activities",
  "Spam or unrelated content",
];

/** Hide a review with a reason the author will see. */
export function HideReviewButton({ reviewId, author, clubName }: { reviewId: string; author: string; clubName: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, error, setError, run } = useRunAction();
  const id = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="danger">
          <EyeOff className="h-4 w-4" aria-hidden /> Hide
        </Button>
      </DialogTrigger>
      <DialogContent title="Hide this review" description={`${author}'s review disappears from ${clubName}'s page and stops counting toward its rating. ${author} is told it was hidden and why.`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => hideReviewAction(reviewId, reason), { success: "Review hidden", onSuccess: () => setOpen(false) });
          }}
          className="space-y-3"
        >
          <div className="flex flex-wrap gap-1.5" aria-label="Common reasons">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="rounded-full bg-muted px-2.5 py-1 text-xs text-ink-2 hover:bg-brand-50 hover:text-brand focus-visible:outline-2 focus-visible:outline-brand"
              >
                {r}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={id} className="block text-sm font-medium text-ink">
              Reason <span className="text-danger">*</span>
            </label>
            <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} aria-invalid={error ? true : undefined} />
            <p className="text-xs text-ink-3">The reviewer sees this. Keep it short and factual.</p>
          </div>
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
              Hide review
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmButton({
  label,
  icon,
  variant = "outline",
  title,
  description,
  confirmLabel,
  success,
  action,
}: {
  label: string;
  icon: React.ReactNode;
  variant?: "outline" | "primary" | "secondary";
  title: string;
  description: string;
  confirmLabel: string;
  success: string;
  action: () => Promise<ActionResult<unknown>>;
}) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant={variant} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
          {label}
        </Button>
      }
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      onConfirm={() => void run(action, { success, toastError: true })}
    />
  );
}

export function RestoreReviewButton({ reviewId }: { reviewId: string }) {
  return (
    <ConfirmButton
      label="Restore"
      icon={<RotateCcw className="h-4 w-4" aria-hidden />}
      title="Restore this review?"
      description="It shows on the club page again and counts toward the club's rating."
      confirmLabel="Restore review"
      success="Review restored"
      action={() => restoreReviewAction(reviewId)}
    />
  );
}

export function KeepReviewButton({ reviewId, reports }: { reviewId: string; reports: number }) {
  return (
    <ConfirmButton
      label="Keep"
      icon={<Check className="h-4 w-4" aria-hidden />}
      title="Keep this review up?"
      description={`It stays on the club page. Its ${reports === 1 ? "flag is" : `${reports} flags are`} cleared and the task closes.`}
      confirmLabel="Keep review"
      success="Review kept — flags cleared"
      action={() => keepReviewAction(reviewId)}
    />
  );
}

export function CloseCheckButton({ clubId, clubName }: { clubId: string; clubName: string }) {
  return (
    <ConfirmButton
      label="Close check"
      variant="primary"
      icon={<CheckCheck className="h-4 w-4" aria-hidden />}
      title={`Finish the review-bombing check for ${clubName}?`}
      description="This closes the admin task. Reviews you hid stay hidden; everything else stays up. A new check opens automatically if another burst of low ratings arrives."
      confirmLabel="Close check"
      success="Check closed"
      action={() => closeBombingCheckAction(clubId)}
    />
  );
}
