"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarPlus, ChevronDown, Loader2, Rss, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Switch, toast } from "@/components/ui/misc";
import { CopyField } from "@/components/calendar/CopyField";
import { INSTITUTION } from "@/lib/institution";
import { resetCalendarLinkAction, setUniversityCalendarAction } from "@/app/events/actions";

export type FeedLinks = { https: string; webcal: string; google: string };

const linkBtn =
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-line-2 bg-surface px-3 text-sm font-medium text-ink hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand";

function FeedButtons({ feed, what }: { feed: FeedLinks; what: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <a href={feed.google} target="_blank" rel="noopener noreferrer" className={linkBtn} aria-label={`Subscribe to ${what} in Google Calendar`}>
        <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Google Calendar
      </a>
      <a href={feed.webcal} className={linkBtn} aria-label={`Subscribe to ${what} in Apple Calendar or Outlook`}>
        <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Apple / Outlook
      </a>
    </div>
  );
}

/**
 * The Events page's "Subscribe" menu: calendar feeds for phones and laptops.
 * Signed in, your private feed is "Mine" (the clubs you follow, plus
 * university events while that switch is on), with a link to copy and a
 * reset. Everyone gets the public feed of every public club and university
 * event. Following a club stays on its page; this menu is only about feeds.
 */
export function SubscribeMenu({ mine, publicFeed, university, loginHref }: { mine: FeedLinks | null; publicFeed: FeedLinks; university: boolean; loginHref: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [uni, setUni] = useState(university);
  const [pending, start] = useTransition();

  function toggleUniversity(on: boolean) {
    setUni(on);
    start(async () => {
      const r = await setUniversityCalendarAction(on);
      if (!r.ok) {
        setUni(!on);
        toast.error(r.error);
        return;
      }
      toast.success(on ? "University events are on your calendar" : "University events are off your calendar");
    });
  }

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant="outline">
            <Rss className="h-4 w-4" aria-hidden="true" /> Subscribe <ChevronDown className="h-4 w-4 text-ink-3" aria-hidden="true" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            collisionPadding={12}
            aria-label="Subscribe to a calendar"
            className="z-50 max-h-[min(36rem,calc(100vh-6rem))] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-pop)] focus:outline-none"
          >
            <div className="space-y-5 pr-6">
              {mine ? (
                <section aria-labelledby={`${id}-mine`} className="space-y-3">
                  <div>
                    <h2 id={`${id}-mine`} className="text-sm font-semibold text-ink">
                      Your calendar
                    </h2>
                    <p className="text-xs text-ink-3">Everything under Mine, on your phone or laptop. New events show up on their own.</p>
                  </div>
                  <FeedButtons feed={mine} what="your calendar" />
                  <CopyField value={mine.https} label="Your private calendar link" hint="Anyone with this link can see your calendar, including members-only events. Don't post it publicly." />
                  <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`${id}-uni`} className="block cursor-pointer text-sm font-medium text-ink">
                        University events
                      </label>
                      <p className="text-xs text-ink-3">Officer trainings and campus-wide events, in Mine and your feed</p>
                    </div>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-hidden="true" /> : null}
                    <Switch id={`${id}-uni`} checked={uni} onCheckedChange={toggleUniversity} disabled={pending} />
                  </div>
                  <button
                    type="button"
                    className="text-sm font-medium text-brand-600 hover:underline"
                    onClick={() => {
                      setOpen(false);
                      setConfirmReset(true);
                    }}
                  >
                    Reset private link
                  </button>
                </section>
              ) : (
                <p className="text-sm text-ink-2">
                  <Link href={loginHref} className="font-medium text-brand-600 hover:underline">
                    Sign in
                  </Link>{" "}
                  to subscribe to your own calendar: the clubs you follow, members-only events included.
                </p>
              )}
              <section aria-labelledby={`${id}-public`} className="space-y-3 border-t border-line pt-4">
                <div>
                  <h2 id={`${id}-public`} className="text-sm font-semibold text-ink">
                    {INSTITUTION.shortName} public calendar
                  </h2>
                  <p className="text-xs text-ink-3">Every public club event and university event.</p>
                </div>
                <FeedButtons feed={publicFeed} what={`the ${INSTITUTION.shortName} public calendar`} />
                <CopyField value={publicFeed.https} label="Public calendar link" />
              </section>
            </div>
            <Popover.Close className="absolute right-3 top-3 rounded-md p-1 text-ink-3 hover:bg-muted hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </Popover.Close>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset your private calendar link?"
        description="Your current link stops working right away. Subscribe again in Google, Apple or Outlook with the new one."
        confirmLabel="Reset link"
        danger
        onConfirm={async () => {
          const r = await resetCalendarLinkAction();
          if (r.ok) toast.success("New private link ready. Subscribe again with it.");
          else toast.error(r.error);
        }}
      />
    </>
  );
}
