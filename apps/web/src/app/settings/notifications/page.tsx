import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bell, CalendarDays, CheckCircle2, Mail, Smartphone } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { settingsUser } from "@/lib/profiles/queries";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmailToggle } from "@/components/profile/settings/EmailToggle";

export const metadata: Metadata = { title: "Settings · Notifications & calendar" };

/**
 * How Wildcat Clubs reaches you: email on or off, the mobile app (push and
 * check-in) and your calendar. The calendar's subscriptions are managed on
 * /calendar — its one input tool — so this page only links there.
 */
export default async function NotificationSettingsPage() {
  const actor = await requireUser("/settings/notifications");
  const user = await settingsUser(actor.id);
  if (!user) notFound();

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
          <Smartphone className="h-5 w-5 text-ink-3" aria-hidden /> Mobile app
        </h2>
        {user.hasMobileApp ? (
          <div className="mt-3 flex gap-2 text-sm text-ink-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            <p>
              You&apos;ve signed in on the Wildcat Clubs app, so push notifications reach your phone. To turn them off or on, use your phone&apos;s notification settings for the app.
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-ink-2">
              You haven&apos;t signed in on the app yet. It&apos;s where you scan the QR code to check in at meetings, and it sends reminders before events and when announcements are posted.
            </p>
            <ButtonLink href="/get-the-app" variant="secondary">
              <Smartphone className="h-4 w-4" aria-hidden /> Get the app
            </ButtonLink>
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <CalendarDays className="h-5 w-5 text-ink-3" aria-hidden /> Calendar
        </h2>
        <p className="mt-3 text-sm text-ink-2">
          Your calendar shows events from the clubs you&apos;re in and follow. Choose which clubs and whether university events appear, and copy your private link into Google Calendar or Apple Calendar, on the calendar page.
        </p>
        <ButtonLink href="/calendar" variant="outline" className="mt-4">
          <CalendarDays className="h-4 w-4" aria-hidden /> Open my calendar
        </ButtonLink>
      </Card>
    </div>
  );
}
