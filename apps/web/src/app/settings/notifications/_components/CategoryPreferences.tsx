"use client";

import { useId, useState, useTransition } from "react";
import { Loader2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch, toast } from "@/components/ui/misc";
import type { Channel, NotificationCategory } from "@/components/notifications/catalog";
import { setNotificationPreferenceAction } from "../actions";

export type CategoryRow = {
  key: NotificationCategory;
  label: string;
  hint: string;
  /** Extra line: kinds in it that always send, or what admins get in the digest. */
  notes: string[];
  /** Every kind in it always sends (Your account): no switches. */
  always: boolean;
  email: boolean;
  push: boolean;
};

const CHANNEL_LABEL: Record<Channel, string> = { email: "Email", push: "Push" };

/**
 * One row per category (components/notifications/catalog) with an Email and a
 * Push switch. In-app always arrives, so neither switch touches the bell.
 * With the master email switch off, the Email switches are shown off and
 * can't change until it's back on.
 */
export function CategoryPreferences({ rows, emailOn }: { rows: CategoryRow[]; emailOn: boolean }) {
  const [state, setState] = useState(() => new Map(rows.map((r) => [r.key, { email: r.email, push: r.push }])));
  const [pending, setPending] = useState<string | null>(null);
  const [, start] = useTransition();
  const baseId = useId();

  function change(row: CategoryRow, channel: Channel, on: boolean) {
    const before = state.get(row.key)!;
    setState((s) => new Map(s).set(row.key, { ...before, [channel]: on }));
    setPending(`${row.key}:${channel}`);
    start(async () => {
      const r = await setNotificationPreferenceAction({ key: row.key, channel, on });
      setPending(null);
      if (r.ok) {
        const what = channel === "email" ? "emails" : "push notifications";
        toast.success(on ? `${row.label}: ${what} are back on.` : `${row.label}: no more ${what}. They still show on the bell.`);
      } else {
        setState((s) => new Map(s).set(row.key, before));
        toast.error(r.error);
      }
    });
  }

  return (
    <div>
      {!emailOn ? (
        <p className="mb-3 rounded-lg bg-muted/60 px-3 py-2 text-sm text-ink-2">
          Email is off for everything right now. Turn on <span className="font-medium">Email me notifications</span> above to choose which kinds are emailed.
        </p>
      ) : null}
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const id = `${baseId}-${row.key}`;
          const s = state.get(row.key)!;
          return (
            <li key={row.key} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p id={`${id}-name`} className="font-medium text-ink">
                  {row.label}
                </p>
                <p id={`${id}-hint`} className="mt-0.5 text-sm text-ink-3">
                  {row.hint}
                </p>
                {row.notes.map((n) => (
                  <p key={n} className="mt-1 text-sm text-ink-3">
                    {n}
                  </p>
                ))}
              </div>
              {row.always ? (
                <Badge tone="neutral" className="shrink-0 self-start">
                  <Lock className="h-3 w-3" aria-hidden /> Always on
                </Badge>
              ) : (
                <div className="flex shrink-0 items-center gap-5" role="group" aria-labelledby={`${id}-name`}>
                  {(["email", "push"] as const).map((channel) => {
                    const busy = pending === `${row.key}:${channel}`;
                    const lockedOff = channel === "email" && !emailOn;
                    return (
                      <div key={channel} className="flex items-center gap-2">
                        <label htmlFor={`${id}-${channel}`} className="text-sm text-ink-2">
                          {CHANNEL_LABEL[channel]}
                        </label>
                        <Switch
                          id={`${id}-${channel}`}
                          aria-label={`${CHANNEL_LABEL[channel]} for ${row.label}`}
                          checked={lockedOff ? false : s[channel]}
                          onCheckedChange={(on) => change(row, channel, on)}
                          disabled={pending !== null || lockedOff}
                          aria-describedby={`${id}-hint`}
                        />
                        <span className="w-4" aria-live="polite">
                          {busy ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-label="Saving" /> : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
