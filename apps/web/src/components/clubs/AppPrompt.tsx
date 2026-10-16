"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { BellRing, CheckCircle2, QrCode, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button, ButtonLink } from "@/components/ui/button";
import { toast } from "@/components/ui/misc";
import { dismissAppPromptAction } from "@/app/clubs/[slug]/actions";

/**
 * After someone registers for a club we celebrate and suggest the mobile app
 * (that's where check-in and reminders live). Shown once per page visit, and
 * never again after "Not now" or once they've signed in on the app.
 */

type AppPromptApi = {
  /** Opens the "You're in!" dialog. Returns false when the prompt isn't wanted, so callers can toast instead. */
  celebrate: (clubName: string) => boolean;
};

const AppPromptContext = createContext<AppPromptApi>({ celebrate: () => false });

export function useAppPrompt() {
  return useContext(AppPromptContext);
}

export function AppPromptProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [available, setAvailable] = useState(enabled);
  const [clubName, setClubName] = useState<string | null>(null);

  const celebrate = useCallback(
    (name: string) => {
      if (!available) return false;
      setAvailable(false);
      setClubName(name);
      return true;
    },
    [available],
  );

  function notNow() {
    setClubName(null);
    void dismissAppPromptAction().then((r) => {
      if (!r.ok) toast.error(r.error);
    });
  }

  return (
    <AppPromptContext.Provider value={{ celebrate }}>
      {children}
      <Dialog open={clubName !== null} onOpenChange={(open) => (open ? null : setClubName(null))}>
        <DialogContent
          title={
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-success" aria-hidden="true" /> You&rsquo;re in!
            </span>
          }
          description={clubName ? `You're now a member of ${clubName}, and their events are on your calendar.` : undefined}
        >
          <div className="rounded-xl bg-brand-50 p-4">
            <p className="font-semibold text-brand-700">Get the Wildcat Clubs app so you don&rsquo;t miss a meeting</p>
            <ul className="mt-3 space-y-2.5 text-sm text-ink-2">
              <li className="flex gap-2.5">
                <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                Check in at meetings by scanning the code on screen — it takes two seconds.
              </li>
              <li className="flex gap-2.5">
                <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                Get reminders before events and see announcements as soon as they&rsquo;re posted.
              </li>
              <li className="flex gap-2.5">
                <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                Sign in with the same Weber State account — your clubs are already there.
              </li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={notNow}>
              Not now
            </Button>
            <ButtonLink href="/get-the-app" onClick={() => setClubName(null)}>
              <Smartphone className="h-4 w-4" aria-hidden="true" /> Get the app
            </ButtonLink>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppPromptContext.Provider>
  );
}
