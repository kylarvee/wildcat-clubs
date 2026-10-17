"use client";

import { useId, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Switch, toast } from "@/components/ui/misc";
import { setEmailNotificationsAction } from "@/app/settings/actions";

/** Email on or off. In-app notifications always arrive. */
export function EmailToggle({ initial, email }: { initial: boolean; email: string }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const id = useId();

  function change(next: boolean) {
    setOn(next);
    start(async () => {
      const r = await setEmailNotificationsAction(next);
      if (r.ok) toast.success(next ? `We'll email ${email} too.` : "Email notifications are off. You'll still see everything in the app.");
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
          Email me notifications
        </label>
        <p id={`${id}-hint`} className="mt-0.5 text-sm text-ink-3 [overflow-wrap:anywhere]">
          Sent to {email} when something needs you — a join request, a task, an election opening.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-label="Saving" /> : null}
        <Switch id={id} checked={on} onCheckedChange={change} disabled={pending} aria-describedby={`${id}-hint`} />
      </div>
    </div>
  );
}
