"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { CalendarPlus, Compass, Loader2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ClubLogo } from "@/components/ui/avatar";
import { Switch, toast } from "@/components/ui/misc";
import { CalendarView } from "@/components/calendar/CalendarView";
import { CopyField } from "@/components/calendar/CopyField";
import { ConfirmDialog } from "@/components/ui/dialog";
import { resetCalendarLinkAction, setClubSubscriptionAction, setUniversityCalendarAction } from "@/app/calendar/actions";

export type MyCalendarClub = { id: string; name: string; slug: string; logoColor: string; logoUrl: string | null; subscribed: boolean };

/**
 * The signed-in united calendar: your tailored calendar plus the switches that
 * decide what's on it, and links to subscribe from Google or Apple Calendar.
 */
export function MyCalendar({
  memberClubs,
  following,
  university,
  feed,
  aside,
}: {
  memberClubs: MyCalendarClub[];
  following: MyCalendarClub[];
  university: boolean;
  feed: { https: string; webcal: string; google: string };
  /** Extra sidebar cards rendered on the server (e.g. leaders' planned costs). */
  aside?: ReactNode;
}) {
  const [version, setVersion] = useState(0);
  const [subs, setSubs] = useState<Record<string, boolean>>(() => Object.fromEntries([...memberClubs, ...following].map((c) => [c.id, c.subscribed])));
  const [uni, setUni] = useState(university);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();

  function toggleClub(c: MyCalendarClub, on: boolean) {
    setSubs((s) => ({ ...s, [c.id]: on }));
    setPendingId(c.id);
    start(async () => {
      const res = await setClubSubscriptionAction(c.id, on);
      setPendingId(null);
      if (!res.ok) {
        setSubs((s) => ({ ...s, [c.id]: !on }));
        toast.error(res.error);
        return;
      }
      setVersion((v) => v + 1);
    });
  }

  function toggleUniversity(on: boolean) {
    setUni(on);
    setPendingId("university");
    start(async () => {
      const res = await setUniversityCalendarAction(on);
      setPendingId(null);
      if (!res.ok) {
        setUni(!on);
        toast.error(res.error);
        return;
      }
      setVersion((v) => v + 1);
    });
  }

  const row = (c: MyCalendarClub) => (
    <li key={c.id} className="flex items-center gap-3 py-2">
      <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
      <Link href={`/clubs/${c.slug}`} className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:underline">
        {c.name}
      </Link>
      {pendingId === c.id ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-hidden /> : null}
      <Switch checked={subs[c.id] ?? false} onCheckedChange={(on) => toggleClub(c, on)} aria-label={`Show ${c.name} on my calendar`} />
    </li>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <CalendarView source={{ scope: "me" }} refreshKey={version} emptyMessage="Nothing on your calendar for this stretch. Follow more clubs to fill it in." />

      <aside className="min-w-0 space-y-6">
        <Card>
          <CardHeader title="On your calendar" description="Turn clubs on or off. Leaving a club removes it." />
          <CardBody className="space-y-4">
            {memberClubs.length ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Your clubs</p>
                <ul className="divide-y divide-line">{memberClubs.map(row)}</ul>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line-2 px-3 py-4 text-center text-sm text-ink-3">
                <Compass className="mx-auto mb-1.5 h-5 w-5" aria-hidden />
                You haven&apos;t joined a club yet.{" "}
                <Link href="/clubs" className="font-medium text-brand-600 hover:underline">
                  Browse clubs
                </Link>
              </div>
            )}
            {following.length ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Following</p>
                <ul className="divide-y divide-line">{following.map(row)}</ul>
              </div>
            ) : null}
            <div className="flex items-center gap-3 border-t border-line pt-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-xs font-bold text-white" aria-hidden>
                W
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">University events</p>
                <p className="text-xs text-ink-3">Officer trainings and campus-wide events</p>
              </div>
              {pendingId === "university" ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-hidden /> : null}
              <Switch checked={uni} onCheckedChange={toggleUniversity} aria-label="Show university events on my calendar" />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Add to your phone or laptop" description="Subscribe once and new events show up on their own." />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <a href={feed.google} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line-2 bg-surface px-3 text-sm font-medium text-ink hover:bg-muted">
                <CalendarPlus className="h-4 w-4" /> Google Calendar
              </a>
              <a href={feed.webcal} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line-2 bg-surface px-3 text-sm font-medium text-ink hover:bg-muted">
                <CalendarPlus className="h-4 w-4" /> Apple / Outlook
              </a>
            </div>
            <CopyField value={feed.https} label="Your private calendar link" hint="Anyone with this link can see your calendar, including members-only events. Don't post it publicly." />
            <ConfirmDialog
              trigger={<button type="button" className="text-sm font-medium text-brand-600 hover:underline">Reset private link</button>}
              title="Reset your private calendar link?"
              description="Your current link stops working right away. Re-subscribe in Google or Apple Calendar with the new one."
              confirmLabel="Reset link"
              danger
              onConfirm={async () => {
                const r = await resetCalendarLinkAction();
                if (r.ok) toast.success("New private link ready. Re-subscribe with it.");
                else toast.error(r.error);
              }}
            />
          </CardBody>
        </Card>

        {aside}
      </aside>
    </div>
  );
}
