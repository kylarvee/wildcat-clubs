"use client";

import { useState, useTransition } from "react";
import { Switch, toast } from "@/components/ui/misc";
import { setRequirementActiveAction } from "./actions";

/** Turn a requirement on or off from the list. */
export function ActiveToggle({ id, name, active }: { id: string; name: string; active: boolean }) {
  const [on, setOn] = useState(active);
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm text-ink-2">
      <Switch
        checked={on}
        disabled={pending}
        aria-label={`${name} is ${on ? "on" : "off"}`}
        onCheckedChange={(next) => {
          setOn(next);
          start(async () => {
            const r = await setRequirementActiveAction(id, next).catch(() => null);
            if (!r || !r.ok) {
              setOn(!next);
              toast.error(r && !r.ok ? r.error : "We couldn't reach the server. Try again.");
              return;
            }
            toast.success(next ? `${name} is on. Leaders who need it are getting a task.` : `${name} is off. Its open tasks are closing.`);
          });
        }}
      />
      {on ? "On" : "Off"}
    </label>
  );
}
