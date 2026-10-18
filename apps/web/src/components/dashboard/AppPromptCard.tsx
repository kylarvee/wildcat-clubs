"use client";

import { useState, useTransition } from "react";
import { BellRing, QrCode, Smartphone } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/misc";
import { dismissAppPromptAction } from "@/app/dashboard/actions";

/**
 * "Get the app" — the dashboard shows it when shouldPromptForApp says so (the
 * app is in a store and you haven't signed in on it). "Not now" hides it, and
 * the prompt after registering, for 30 days.
 */
export function AppPromptCard() {
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  if (hidden) return null;
  return (
    <section aria-labelledby="dash-app-title">
      <Card className="overflow-hidden border-brand-100 bg-brand-50/60 p-4 sm:p-5">
        <h2 id="dash-app-title" className="flex items-center gap-2 font-semibold text-brand-700">
          <Smartphone className="h-5 w-5" aria-hidden /> Get the Wildcat Clubs app
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-2">
          <li className="flex gap-2">
            <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden /> Scan the code at meetings to check in.
          </li>
          <li className="flex gap-2">
            <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden /> Get reminders before events and new announcements.
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href="/get-the-app" size="sm">
            Get the app
          </ButtonLink>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setHidden(true);
              start(async () => {
                const r = await dismissAppPromptAction();
                if (!r.ok) {
                  setHidden(false);
                  toast.error(r.error);
                }
              });
            }}
          >
            Not now
          </Button>
        </div>
      </Card>
    </section>
  );
}
