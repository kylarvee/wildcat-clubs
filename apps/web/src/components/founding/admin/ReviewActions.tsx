"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MessageSquareWarning, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";
import { decideClubAction } from "@/app/admin/clubs/actions";

type Decision = "APPROVE" | "CHANGES" | "REJECT";

const COPY: Record<Decision, { label: string; placeholder: string; done: string }> = {
  APPROVE: { label: "Approve", placeholder: "Optional welcome note for the founders.", done: "Club approved" },
  CHANGES: { label: "Request changes", placeholder: "List exactly what to fix — the founders see this note at the top of their checklist.", done: "Changes requested" },
  REJECT: { label: "Don't approve", placeholder: "Explain why the club can't be approved and what the founders can do instead.", done: "Decision sent" },
};

/** Approve / request changes / reject a submitted club. Notes are required except for approval. */
export function ReviewActions({ clubId, approveBlockers }: { clubId: string; approveBlockers: string[] }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    if (!decision) return;
    setError(null);
    if (decision !== "APPROVE" && note.trim().length < 3) return setError("Add a note so the founders know what to do next.");
    start(async () => {
      const r = await decideClubAction({ clubId, decision, note });
      if (!r.ok) return setError(r.error);
      toast.success(COPY[decision].done);
      setDecision(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Decision">
        <Button variant={decision === "APPROVE" ? "primary" : "outline"} aria-pressed={decision === "APPROVE"} onClick={() => setDecision("APPROVE")} disabled={approveBlockers.length > 0}>
          <Check className="h-4 w-4" aria-hidden /> Approve
        </Button>
        <Button variant={decision === "CHANGES" ? "primary" : "outline"} aria-pressed={decision === "CHANGES"} onClick={() => setDecision("CHANGES")}>
          <MessageSquareWarning className="h-4 w-4" aria-hidden /> Request changes
        </Button>
        <Button variant={decision === "REJECT" ? "danger" : "outline"} aria-pressed={decision === "REJECT"} onClick={() => setDecision("REJECT")}>
          <X className="h-4 w-4" aria-hidden /> Don&apos;t approve
        </Button>
      </div>
      {approveBlockers.length ? (
        <Callout tone="warning" title="Before you can approve">
          <ul className="list-disc pl-5">
            {approveBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      {decision ? (
        <div className={cn("space-y-3 rounded-xl border p-4", decision === "REJECT" ? "border-red-200 bg-danger-50/40" : "border-line bg-muted/30")}>
          <Field label={decision === "APPROVE" ? "Note (optional)" : "Note to the founders"} required={decision !== "APPROVE"}>
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={4000} placeholder={COPY[decision].placeholder} autoFocus />}
          </Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant={decision === "REJECT" ? "danger" : "primary"} onClick={submit} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {pending ? "Sending…" : `${COPY[decision].label} and notify founders`}
            </Button>
            <Button variant="ghost" onClick={() => setDecision(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
