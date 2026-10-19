"use client";

import { useId, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Switch, toast } from "@/components/ui/misc";
import { DIGEST_PREF } from "@/components/notifications/catalog";
import { setNotificationPreferenceAction } from "../actions";

/** WSUSA admins: one morning email about the WSUSA queue (lib/jobs/notifications) instead of one email per submission. */
export function DigestToggle({ initial, emailOn }: { initial: boolean; emailOn: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const id = useId();

  function change(next: boolean) {
    setOn(next);
    start(async () => {
      const r = await setNotificationPreferenceAction({ key: DIGEST_PREF, channel: "email", on: next });
      if (r.ok) toast.success(next ? "You'll get one digest each morning instead of an email for each submission." : "Digest off. Club submissions, funding requests and flagged reviews will be emailed one at a time.");
      else {
        setOn(!next);
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="font-medium text-ink">
          Daily WSUSA digest
        </label>
        <p id={`${id}-hint`} className="mt-0.5 text-sm text-ink-3">
          One email around 7 AM about what&apos;s waiting on WSUSA, instead of an email for each club submission, funding request, custom document or flagged review. Turn it off to get those one at a time.
          {emailOn ? null : " Email is off for everything right now, so no digest is sent."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-label="Saving" /> : null}
        <Switch id={id} checked={emailOn && on} onCheckedChange={change} disabled={pending || !emailOn} aria-describedby={`${id}-hint`} />
      </div>
    </div>
  );
}
