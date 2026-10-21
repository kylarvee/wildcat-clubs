"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { approveEventReviewAction, requestEventChangesAction } from "./actions";

/**
 * Approve an event (an optional note goes to the club with it) or send it
 * back with a note saying what to change. One note box serves both.
 */
export function ReviewDecision({ eventId, title, clubName }: { eventId: string; title: string; clubName: string }) {
  const router = useRouter();
  const id = useId();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"approve" | "changes" | null>(null);

  function decide(kind: "approve" | "changes") {
    setError(null);
    const text = note.trim();
    if (kind === "changes" && text.length < 5) return setError(`Tell ${clubName} what to change, in the note.`);
    setWhich(kind);
    start(async () => {
      const r = kind === "approve" ? await approveEventReviewAction(eventId, text || null).catch(() => null) : await requestEventChangesAction(eventId, text).catch(() => null);
      setWhich(null);
      if (!r) return setError("We couldn't reach the server, so nothing changed. Try again.");
      if (!r.ok) return setError(r.error);
      toast.success(kind === "approve" ? `“${title}” is approved and posted` : `Sent back to ${clubName} with your note`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-note`}>
        Note to the club <span className="font-normal text-ink-3">(needed to ask for changes; optional when approving)</span>
      </Label>
      <Textarea id={`${id}-note`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please add a second adult driver for the overnight trip." />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => decide("approve")} disabled={pending}>
          {pending && which === "approve" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Approve and post
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide("changes")} disabled={pending}>
          {pending && which === "changes" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageSquareWarning className="h-4 w-4" aria-hidden />} Ask for changes
        </Button>
      </div>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </div>
  );
}
