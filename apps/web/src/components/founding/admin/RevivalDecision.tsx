"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";
import { approveRevivalAction, declineRevivalAction } from "@/app/admin/clubs/actions";

/**
 * The office's answer to a revival request: reinstate the club with the
 * student as President (an optional note), or decline with a note. Either
 * way the student hears (lib/domain/clubs approveClubRevival, declineClubRevival).
 */
export function RevivalDecision({ clubId, requester, approvedBefore }: { clubId: string; requester: string; approvedBefore: boolean }) {
  const router = useRouter();
  const [choice, setChoice] = useState<"APPROVE" | "DECLINE" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const first = requester.split(/\s+/)[0] || requester;

  function submit() {
    if (!choice) return;
    setError(null);
    if (choice === "DECLINE" && note.trim().length < 3) return setError("Add a note so they know why.");
    start(async () => {
      const r = choice === "APPROVE" ? await approveRevivalAction({ clubId, note }) : await declineRevivalAction({ clubId, note });
      if (!r.ok) return setError(r.error);
      toast.success(choice === "APPROVE" ? `Club brought back, with ${requester} as President` : "Request declined");
      setChoice(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">
        {approvedBefore
          ? `Approving reinstates the club as approved (its members and leaders who were active when it retired come back, as with Reinstate) and makes ${requester} its President.`
          : `This club was never approved, so approving returns it to draft, with ${requester} as President to finish founding it.`}
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Decision">
        <Button variant={choice === "APPROVE" ? "primary" : "outline"} aria-pressed={choice === "APPROVE"} onClick={() => setChoice("APPROVE")} className="h-auto min-h-10 whitespace-normal py-2 text-left">
          <RotateCcw className="h-4 w-4 shrink-0" aria-hidden /> Bring it back with {first} as President
        </Button>
        <Button variant={choice === "DECLINE" ? "danger" : "outline"} aria-pressed={choice === "DECLINE"} onClick={() => setChoice("DECLINE")}>
          <X className="h-4 w-4" aria-hidden /> Decline
        </Button>
      </div>
      {choice ? (
        <div className={cn("space-y-3 rounded-xl border p-4", choice === "DECLINE" ? "border-red-200 bg-danger-50/40" : "border-line bg-muted/30")}>
          <Field label={choice === "APPROVE" ? `Note to ${first} (optional)` : `Note to ${first}`} required={choice === "DECLINE"}>
            {(id) => (
              <Textarea
                id={id}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={2000}
                autoFocus
                placeholder={choice === "APPROVE" ? "Welcome back! Next, invite an advisor and plan a first meeting." : "Why not now, and what they could do instead."}
              />
            )}
          </Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant={choice === "DECLINE" ? "danger" : "primary"} onClick={submit} disabled={pending} className="h-auto min-h-10 whitespace-normal py-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {pending ? "Sending…" : choice === "APPROVE" ? `Bring it back and tell ${first}` : `Decline and tell ${first}`}
            </Button>
            <Button variant="ghost" onClick={() => setChoice(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
