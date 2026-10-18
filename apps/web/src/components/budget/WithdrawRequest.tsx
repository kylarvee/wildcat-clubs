"use client";

import { useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useRunAction } from "@/components/roles/useRunAction";
import { withdrawRequestAction } from "@/app/clubs/[slug]/manage/budget/actions";

/** Pull a submitted request back before WSUSA decides. Its lines unlock so they can be requested again. */
export function WithdrawRequest({ requestId, title }: { requestId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, error, setError, run } = useRunAction();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Undo2 className="h-4 w-4" aria-hidden /> Withdraw
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setError(null);
        }}
      >
        <DialogContent title={`Withdraw “${title}”?`} description="WSUSA stops reviewing it and its approval task closes. Its cost lines unlock, so you can change them or put them in a new request.">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run(() => withdrawRequestAction(requestId, reason.trim() || undefined), { success: "Request withdrawn." });
              if (r.ok) setOpen(false);
            }}
          >
            <Field label="Why? (optional)" hint="WSUSA sees this, for example “Costumes were donated”.">
              {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} />}
            </Field>
            {error ? <Callout tone="danger">{error}</Callout> : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Keep it in WSUSA review
              </Button>
              <Button type="submit" variant="danger" disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Withdraw request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
