"use client";

import { useId, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Switch, toast } from "@/components/ui/misc";
import { setEventRemindersAction } from "../actions";

/** "Remind me before events": the Reminders job's starting-soon notices (in-app and push, never email). */
export function RemindersToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const id = useId();

  function change(next: boolean) {
    setOn(next);
    start(async () => {
      const r = await setEventRemindersAction(next);
      if (r.ok) toast.success(next ? "We'll remind you about an hour before events." : "Event reminders are off. Changes and cancellations still reach you.");
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
          Remind me before events
        </label>
        <p id={`${id}-hint`} className="mt-0.5 text-sm text-ink-3">
          About an hour before events at clubs you&apos;re in or follow, and before trainings WSUSA requires of you. On the bell and on your phone, never by email.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-label="Saving" /> : null}
        <Switch id={id} checked={on} onCheckedChange={change} disabled={pending} aria-describedby={`${id}-hint`} />
      </div>
    </div>
  );
}
