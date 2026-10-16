"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { decideDocumentAction } from "@/app/admin/clubs/actions";

/** Approve (takes effect + applies the stated settings) or return a custom constitution/bylaws. */
export function DocumentDecision({ docId, label }: { docId: string; label: string }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(approve: boolean) {
    setError(null);
    if (!approve && note.trim().length < 3) return setError("Tell the club what to change.");
    start(async () => {
      const r = await decideDocumentAction({ docId, approve, note: approve ? undefined : note });
      if (!r.ok) return setError(r.error);
      toast.success(approve ? `${label} approved and in effect` : `${label} returned to the club`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {rejecting ? (
        <div className="space-y-2">
          <Field label="What needs to change?" required>
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} autoFocus />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={() => decide(false)} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Return to club
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => decide(true)} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRejecting(true)} disabled={pending}>
            <X className="h-4 w-4" aria-hidden /> Don&apos;t approve
          </Button>
        </div>
      )}
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </div>
  );
}
