"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { REVIVAL_NOTE_MAX } from "@/lib/founding/rules";
import { requestClubRevivalAction } from "@/app/clubs/actions";

/**
 * "Ask to revive it": a student asks the retired club's office to bring it
 * back, with them as President (lib/domain/clubs requestClubRevival). Used by
 * the Start a club wizard's similar clubs and a retired club's page.
 */
export function AskToReviveDialog({
  clubId,
  clubName,
  office,
  onSent,
  size = "sm",
  variant = "outline",
}: {
  clubId: string;
  clubName: string;
  /** Who decides, when the page knows ("WSUSA", "Campus Recreation"). */
  office?: string | null;
  /** After the request goes: the caller updates itself (else the page refreshes). */
  onSent?: () => void;
  size?: "sm" | "md";
  variant?: "outline" | "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const who = office || "The office that oversees it";

  function send() {
    setError(null);
    start(async () => {
      const r = await requestClubRevivalAction({ clubId, note });
      if (!r.ok) return setError(r.error);
      toast.success(`Request sent to ${r.data.office}`, { description: `We'll let you know what they decide about ${clubName}.` });
      setOpen(false);
      setNote("");
      if (onSent) onSent();
      else router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          <RotateCcw className="h-4 w-4" aria-hidden /> Ask to revive it
        </Button>
      </DialogTrigger>
      <DialogContent title={`Bring ${clubName} back?`} description={`${who} reviews your request. If they approve it, ${clubName} is reinstated and you become its President.`}>
        <div className="space-y-3">
          <Field label="Anything they should know? (optional)" hint={`${note.length}/${REVIVAL_NOTE_MAX.toLocaleString("en-US")} · Who's interested, and what you'd like the club to do.`}>
            {(id) => (
              <Textarea
                id={id}
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, REVIVAL_NOTE_MAX))}
                rows={4}
                placeholder="A few of us want to restart its meetings this spring, and I'd be glad to lead it."
              />
            )}
          </Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {pending ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
