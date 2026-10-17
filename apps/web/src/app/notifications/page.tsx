import type { Metadata } from "next";
import Link from "next/link";
import { BellOff, CheckCircle2, Settings } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listNotifications, NOTIFICATIONS_PAGE } from "@/lib/domain/notifications";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Container, EmptyState, PageHeader } from "@/components/ui/layout";
import { MarkAllReadButton, NotificationList } from "@/components/notifications/NotificationList";
import { groupByDay } from "@/components/notifications/groups";

export const metadata: Metadata = { title: "Notifications" };

type SearchParams = Promise<{ show?: string }>;

/**
 * Your notifications: unread first, then everything else, each grouped by
 * day. Opening one marks it read. Email follows your settings; these always
 * arrive here.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser("/notifications");
  const unreadOnly = (await searchParams).show === "unread";
  const now = new Date();
  const rows = await listNotifications(user, { unreadOnly });
  const unread = rows.filter((r) => !r.readAt);
  const read = rows.filter((r) => r.readAt);

  return (
    <Container size="md">
      <PageHeader
        title="Notifications"
        description={unread.length ? `You have ${unread.length === NOTIFICATIONS_PAGE ? `${NOTIFICATIONS_PAGE}+` : unread.length} unread.` : "You're all caught up."}
        actions={
          <>
            <MarkAllReadButton count={unread.length} />
            <ButtonLink href="/settings/notifications" variant="ghost" aria-label="Notification settings">
              <Settings className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Settings</span>
            </ButtonLink>
          </>
        }
      />

      <nav aria-label="Show" className="mb-6 flex gap-1 border-b border-line">
        {[
          { href: "/notifications", label: "All", active: !unreadOnly },
          { href: "/notifications?show=unread", label: "Unread", active: unreadOnly, count: unread.length },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.active ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink")}
          >
            {t.label}
            {t.count ? <span className="rounded-full bg-brand-50 px-1.5 text-xs text-brand">{t.count}</span> : null}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        unreadOnly ? (
          <EmptyState
            icon={<CheckCircle2 />}
            title="No unread notifications"
            description="You've seen everything. New ones show up here and on the bell at the top of every page."
            action={
              <Link href="/notifications" className="text-sm font-medium text-brand-600 hover:underline">
                See all notifications
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<BellOff />}
            title="No notifications yet"
            description="When a club approves your request, an event you follow is about to start, someone assigns you a task or an election opens, you'll hear about it here."
            action={<ButtonLink href="/clubs">Browse clubs</ButtonLink>}
          />
        )
      ) : (
        <div className="space-y-10">
          {unread.length ? (
            <section aria-labelledby="notif-unread">
              <h2 id="notif-unread" className="mb-4 text-lg font-semibold text-ink">
                Unread
              </h2>
              <NotificationList groups={groupByDay(unread, now, "u-")} />
            </section>
          ) : null}
          {read.length ? (
            <section aria-labelledby="notif-earlier">
              <h2 id="notif-earlier" className="mb-4 text-lg font-semibold text-ink">
                {unread.length ? "Earlier" : "All notifications"}
              </h2>
              <NotificationList groups={groupByDay(read, now, "r-")} />
            </section>
          ) : null}
          {rows.length >= NOTIFICATIONS_PAGE ? <p className="text-center text-xs text-ink-3">Showing your latest {NOTIFICATIONS_PAGE} notifications.</p> : null}
        </div>
      )}
    </Container>
  );
}
