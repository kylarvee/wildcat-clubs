import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlarmClock, Bell, CalendarDays, CheckCircle2, Inbox, Info, ListChecks, Mail, Smartphone } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can, isAdmin } from "@/lib/authz";
import { integrationLive } from "@/lib/config";
import { db } from "@/lib/db";
import { shouldPromptForApp } from "@/lib/clubs/queries";
import { settingsUser } from "@/lib/profiles/queries";
import { categoryAlways, categoryChoice, digestOn, kindsIn, NOTIFICATION_CATEGORIES, NOTIFICATION_REGISTRY, readPrefs, type KindRule } from "@/components/notifications/catalog";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmailToggle } from "@/components/profile/settings/EmailToggle";
import { CategoryPreferences, type CategoryRow } from "./_components/CategoryPreferences";
import { DigestToggle } from "./_components/DigestToggle";
import { RemindersToggle } from "./_components/RemindersToggle";

export const metadata: Metadata = { title: "Settings · Notifications & calendar" };

/**
 * How Wildcat Clubs reaches you: email on or off, which kinds of
 * notification come by email and push (one row per category of the
 * notification registry, components/notifications/catalog), WSUSA's daily
 * digest for admins, reminders before events, push notifications on your
 * phone and your calendar. The push line says push reaches your phone only
 * when it does: a phone is registered (PushToken) and a sysadmin has switched
 * push on (integrations.push); otherwise it says how to get there. The
 * calendar's subscriptions are managed on /calendar — its one input tool — so
 * this page only links there.
 */
export default async function NotificationSettingsPage() {
  const actor = await requireUser("/settings/notifications");
  const [user, offerApp, prefs, pushLive] = await Promise.all([
    settingsUser(actor.id),
    shouldPromptForApp(actor.id, { ignoreSnooze: true }),
    db.user.findUnique({ where: { id: actor.id }, select: { eventReminders: true, notificationPrefs: true, _count: { select: { pushTokens: true } } } }),
    integrationLive("push"),
  ]);
  if (!user || !prefs) notFound();
  const phones = prefs._count.pushTokens;
  const admin = isAdmin(actor);
  const choices = readPrefs(prefs.notificationPrefs);
  const rows: CategoryRow[] = NOTIFICATION_CATEGORIES.map((c) => {
    const always = categoryAlways(c.key);
    const someAlways = !always && kindsIn(c.key).some((k) => (NOTIFICATION_REGISTRY[k] as KindRule).always);
    const notes: string[] = [];
    if (someAlways && "note" in c) notes.push(c.note);
    if (admin && "adminHint" in c) notes.push(c.adminHint);
    return { key: c.key, label: c.label, hint: c.hint, notes, always, email: categoryChoice(choices, c.key, "email", { admin }), push: categoryChoice(choices, c.key, "push", { admin }) };
  });

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <Mail className="h-5 w-5 text-ink-3" aria-hidden /> Email
        </h2>
        <div className="mt-4">
          <EmailToggle initial={user.emailNotifications} email={user.email} />
        </div>
        <p className="mt-4 border-t border-line pt-4 text-sm text-ink-3">
          Every notification also shows on the{" "}
          <Link href="/notifications" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
            <Bell className="h-3.5 w-3.5" aria-hidden /> bell
          </Link>{" "}
          at the top of the page, whatever you choose here. Advisor invitations are always emailed, since they can go to people who don&apos;t have an account yet.
        </p>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <ListChecks className="h-5 w-5 text-ink-3" aria-hidden /> What reaches you
        </h2>
        <p className="mt-1 text-sm text-ink-3">Everything shows on the bell. Choose which kinds also come by email and to your phone. On means the usual: email only for what needs you, like an approval or a last-minute cancellation.</p>
        <div className="mt-4">
          <CategoryPreferences rows={rows} emailOn={user.emailNotifications} />
        </div>
      </Card>

      {admin ? (
        <Card className="p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <Inbox className="h-5 w-5 text-ink-3" aria-hidden /> WSUSA digest
          </h2>
          <div className="mt-4">
            <DigestToggle initial={digestOn(choices)} emailOn={user.emailNotifications} />
          </div>
          <p className="mt-4 border-t border-line pt-4 text-sm text-ink-3">New reports, possible review bombing and clubs that lose a leader are still emailed as they happen.</p>
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <AlarmClock className="h-5 w-5 text-ink-3" aria-hidden /> Event reminders
        </h2>
        <div className="mt-4">
          <RemindersToggle initial={prefs.eventReminders} />
        </div>
        <p className="mt-4 border-t border-line pt-4 text-sm text-ink-3">
          Either way, you&apos;ll hear when an event in the next two weeks is cancelled, moved or changes rooms.
        </p>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <Smartphone className="h-5 w-5 text-ink-3" aria-hidden /> Push notifications
        </h2>
        <PushStatus phones={phones} pushLive={pushLive} hasApp={user.hasMobileApp} offerApp={offerApp} sysadmin={can(actor, "system.config")} />
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <CalendarDays className="h-5 w-5 text-ink-3" aria-hidden /> Calendar
        </h2>
        <p className="mt-3 text-sm text-ink-2">
          Your calendar is Mine on the Events page: the clubs you follow, plus university events if you keep them on. Follow or unfollow a club on its page. Subscribe on the Events page puts it in Google Calendar, Apple Calendar or Outlook with your private link.
        </p>
        <ButtonLink href="/events?scope=mine" variant="outline" className="mt-4">
          <CalendarDays className="h-4 w-4" aria-hidden /> Open Events
        </ButtonLink>
      </Card>
    </div>
  );
}

/**
 * Whether push reaches this person's phone, and if not, the one thing that
 * would change that: a registered phone (PushToken, from the app) and push
 * switched on for the platform (integrations.push, System → AI & integrations).
 */
function PushStatus({ phones, pushLive, hasApp, offerApp, sysadmin }: { phones: number; pushLive: boolean; hasApp: boolean; offerApp: boolean; sysadmin: boolean }) {
  if (phones > 0 && pushLive) {
    return (
      <div className="mt-3 flex gap-2 text-sm text-ink-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        <p>
          Push notifications reach {phones === 1 ? "your phone" : `your ${phones} phones`}. To stop them, turn off <span className="font-medium">Push notifications on this phone</span> in the app&apos;s Me tab, or in your phone&apos;s settings.
        </p>
      </div>
    );
  }
  const notSending = sysadmin ? (
    <>
      Turn on Push in{" "}
      <Link href="/system/integrations" className="font-medium text-brand-600 hover:underline">
        System → AI &amp; integrations
      </Link>{" "}
      to send them.
    </>
  ) : (
    "Everything shows on the bell until then."
  );
  if (phones > 0) {
    return (
      <Note>
        Your phone is set up, but Wildcat Clubs isn&apos;t sending push notifications yet. {notSending}
      </Note>
    );
  }
  if (hasApp) {
    return (
      <Note>
        Push notifications aren&apos;t reaching a phone yet. To get them, open the Wildcat Clubs app, go to <span className="font-medium">Me</span> and turn on <span className="font-medium">Push notifications on this phone</span>, then allow notifications if your phone asks.
        {pushLive ? null : <> Wildcat Clubs isn&apos;t sending push notifications yet, either. {notSending}</>}
      </Note>
    );
  }
  if (offerApp) {
    return (
      <div className="mt-3 space-y-3">
        <p className="text-sm text-ink-2">
          Push notifications come through the Wildcat Clubs app: reminders before events, announcements and approvals, on your phone. Get the app, sign in with your Weber State account and allow notifications when it asks.
          {pushLive ? null : " They'll start once Wildcat Clubs switches push on."}
        </p>
        <ButtonLink href="/get-the-app" variant="secondary">
          <Smartphone className="h-4 w-4" aria-hidden /> Get the app
        </ButtonLink>
      </div>
    );
  }
  return <Note>Push notifications come through the Wildcat Clubs phone app, which isn&apos;t in the App Store or Google Play yet. Until it is, everything shows on the bell.</Note>;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex gap-2 text-sm text-ink-2">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
      <p>{children}</p>
    </div>
  );
}
