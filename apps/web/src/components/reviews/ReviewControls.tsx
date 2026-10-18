"use client";

import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Flag, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/form";
import { StarInput, toast } from "@/components/ui/misc";
import { deleteReviewAction, flagReviewAction, saveReviewAction } from "@/components/reviews/actions";

const MAX_BODY = 2000;
const RATING_WORDS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

/** Star rating + optional text. Creating and editing share it (one review per person per club). */
export function ReviewForm({
  clubId,
  clubName,
  initial,
  onDone,
}: {
  clubId: string;
  clubName: string;
  initial?: { rating: number; body: string | null };
  onDone?: () => void;
}) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [body, setBody] = useState(initial?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bodyId = useId();
  const ratingLabelId = useId();
  const errorId = useId();
  const editing = Boolean(initial);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      setError("Pick a star rating first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await saveReviewAction(clubId, { rating, body });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(editing ? "Your review is updated" : "Thanks — your review is posted", { description: editing ? undefined : `It helps other Wildcats decide whether ${clubName} is for them.` });
      onDone?.();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={error ? errorId : undefined} noValidate>
      <div>
        <p id={ratingLabelId} className="text-sm font-medium text-ink">
          Your rating<span className="text-danger"> *</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3" aria-labelledby={ratingLabelId}>
          <StarInput defaultValue={rating} onChange={(v) => setRating(v)} />
          <span className="text-sm font-medium text-ink-2" aria-live="polite">
            {rating ? RATING_WORDS[rating] : "Tap a star"}
          </span>
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={bodyId} className="block text-sm font-medium text-ink">
          What should other students know? <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <Textarea
          id={bodyId}
          value={body}
          maxLength={MAX_BODY}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder={`What are meetings like? Who would love ${clubName}?`}
        />
        <p className="text-right text-xs tabular-nums text-ink-3">
          {body.length.toLocaleString("en-US")} / {MAX_BODY.toLocaleString("en-US")}
        </p>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {editing ? "Save changes" : "Post review"}
        </Button>
        {onDone && editing ? (
          <Button variant="ghost" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** The viewer's own review: shown as posted, with Edit and Delete. */
export function MyReview({ clubId, clubName, review, children }: { clubId: string; clubName: string; review: { id: string; rating: number; body: string | null }; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const r = await deleteReviewAction(review.id);
      if (!r.ok) toast.error(r.error);
      else toast.success("Your review is deleted");
    });
  }

  if (editing) return <ReviewForm clubId={clubId} clubName={clubName} initial={{ rating: review.rating, body: review.body }} onDone={() => setEditing(false)} />;

  return (
    <div>
      {children}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={pending}>
          <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} disabled={pending} className="text-danger hover:bg-danger-50 hover:text-danger">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />} Delete
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        danger
        title="Delete your review?"
        description={`It comes off ${clubName}'s page right away. You can write a new one later.`}
        confirmLabel="Delete review"
        cancelLabel="Keep it"
        onConfirm={remove}
      />
    </div>
  );
}

const REPORT_REASONS = [
  "Spam or advertising",
  "Harassment, hate or personal attacks",
  "Not about this club",
  "Looks like coordinated review bombing",
  "Shares someone's private information",
  "Something else",
];

/** Flag a review for WSUSA admins (one flag per person). "Report" is for concerns (/report), never for reviews. */
export function ReportReviewButton({ reviewId, reported }: { reviewId: string; reported: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(reported);
  const [pending, startTransition] = useTransition();
  const detailsId = useId();
  const groupName = useId();

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-3">
        <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Flagged
      </span>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = details.trim() ? `${reason}: ${details.trim()}` : reason;
    if (reason === "Something else" && !details.trim()) {
      setError("Tell us briefly what's wrong.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await flagReviewAction(reviewId, text.slice(0, 500));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(true);
      setOpen(false);
      toast.success("Thanks — WSUSA admins will take a look", { description: "The reviewer isn't told who flagged it." });
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-ink-3" onClick={() => setOpen(true)}>
        <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Flag
      </Button>
      <DialogContent title="Flag this review" description="Flags go to WSUSA admins only. They'll decide whether the review stays up.">
        <form onSubmit={submit}>
          <fieldset>
            <legend className="text-sm font-medium text-ink">What&rsquo;s wrong with it?</legend>
            <div className="mt-2 space-y-1.5">
              {REPORT_REASONS.map((r) => (
                <label key={r} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-muted">
                  <input type="radio" name={groupName} value={r} checked={reason === r} onChange={() => setReason(r)} className="h-4 w-4 accent-[var(--color-brand)]" />
                  {r}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 space-y-1.5">
            <label htmlFor={detailsId} className="block text-sm font-medium text-ink">
              Anything else? <span className="font-normal text-ink-3">{reason === "Something else" ? "(required)" : "(optional)"}</span>
            </label>
            <Textarea id={detailsId} rows={3} maxLength={400} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Flag review
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
