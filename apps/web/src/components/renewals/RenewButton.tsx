"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Loader2 } from "lucide-react";
import { activeConfirmation, RENEWAL_NOTE_MAX } from "@/lib/renewals/rules";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Field, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { renewClubAction } from "@/components/renewals/actions";

/**
 * "Renew for 2026–27": the one check nothing can compute (the club will be
 * active this academic year), an optional note for WSUSA, and done. Off, with
 * the reason beside it on the card, until the required checks pass.
 */
export function RenewButton({ clubId, clubName, year, disabled, describedBy }: { clubId: string; clubName: string; year: string; disabled: boolean; describedBy?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = `Renew for ${year}`;

  if (disabled) {
    return (
      <Button disabled aria-describedby={describedBy}>
        <BadgeCheck className="h-4 w-4" aria-hidden /> {label}
      </Button>
    );
  }

  function renew() {
    setError(null);
    start(async () => {
      const r = await renewClubAction({ clubId, confirmActive: confirmed, note });
      if (!r.ok) return setError(r.error);
      toast.success(`${clubName} is re-registered for ${year}`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <BadgeCheck className="h-4 w-4" aria-hidden /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={`Renew ${clubName} for ${year}`} description="This re-registers the club with WSUSA for the academic year. Everyone's renewal task closes, and the club page shows it right away.">
        <div className="space-y-4">
          <Checkbox label={activeConfirmation(clubName)} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <Field label="Note for WSUSA" hint="Optional. Kept with the renewal, for anything WSUSA should know, like a new meeting time or a leadership change coming up.">
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={RENEWAL_NOTE_MAX} />}
          </Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
        </div>
        <DialogFooter>
          <DialogClose className={buttonClasses("outline")}>Not now</DialogClose>
          <Button onClick={renew} disabled={!confirmed || pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BadgeCheck className="h-4 w-4" aria-hidden />}
            {pending ? "Renewing…" : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
