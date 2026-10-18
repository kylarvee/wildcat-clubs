"use client";

import { useState } from "react";
import { Loader2, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { useRunAction } from "@/components/roles/useRunAction";
import { REQUEST_NOTE_MAX } from "@/lib/ambassadors/rules";
import { requestAmbassadorAction, withdrawAmbassadorRequestAction } from "./actions";

/** Ask the college's ambassador program to embed an ambassador, with an optional note. */
export function RequestAmbassadorButton({ clubId, clubName, programName, another }: { clubId: string; clubName: string; programName: string; another: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { pending, error, setError, run } = useRunAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={another ? "outline" : "secondary"}>
          <Send className="h-4 w-4" aria-hidden /> {another ? "Ask for another ambassador" : "Request a college ambassador"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Ask ${programName} for an ambassador`}
        description={`${programName} chooses one of its club representatives and places them in ${clubName}'s College Ambassador seat. You'll get a notification when they do.`}
      >
        <Field label="Anything they should know?" hint="Optional. For example, what you'd like help with or when you meet.">
          {(id) => (
            <Textarea
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={REQUEST_NOTE_MAX}
              rows={3}
              placeholder="We meet Tuesdays at 6 and would love help promoting our spring showcase."
            />
          )}
        </Field>
        {error ? (
          <Callout tone="danger" className="mt-4">
            {error}
          </Callout>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={async () => {
              const r = await run(() => requestAmbassadorAction({ clubId, note: note.trim() || null }), { success: `Request sent to ${programName}.` });
              if (r.ok) {
                setOpen(false);
                setNote("");
              }
            }}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WithdrawRequestButton({ clubId, programName }: { clubId: string; programName: string }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />} Withdraw request
        </Button>
      }
      title="Withdraw your request?"
      description={`${programName} won't place an ambassador from this request. You can ask again any time.`}
      confirmLabel="Withdraw request"
      cancelLabel="Keep it"
      onConfirm={() => {
        void run(() => withdrawAmbassadorRequestAction(clubId), { success: "Request withdrawn.", toastError: true });
      }}
    />
  );
}
