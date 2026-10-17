"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck, Circle, Loader2, MailOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { toast } from "@/components/ui/misc";
import { isUrgentKind, notificationIcon } from "@/components/notifications/kinds";
import { markAllReadAction, markReadAction, markUnreadAction } from "@/app/notifications/actions";

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  /** ISO time, plus a label worked out on the server in campus time ("2:15 PM", "3 min ago"). */
  at: string;
  timeLabel: string;
  unread: boolean;
};

export type NotificationGroup = { key: string; label: string; items: NotificationItem[] };

/**
 * Notifications grouped by day. Opening one marks it read and follows its
 * link; each can also be marked read or unread on its own.
 */
export function NotificationList({ groups, headingLevel = 3 }: { groups: NotificationGroup[]; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`notif-day-${g.key}`}>
          <H id={`notif-day-${g.key}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
            {g.label}
          </H>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
            {g.items.map((n) => (
              // Keyed on read state too, so "Mark all as read" resets each row's local state.
              <NotificationRow key={`${n.id}:${n.unread}`} n={n} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NotificationRow({ n }: { n: NotificationItem }) {
  const router = useRouter();
  const [unread, setUnread] = useState(n.unread);
  const [opening, setOpening] = useState(false);
  const [pending, start] = useTransition();
  const Icon = notificationIcon(n.kind);
  const urgent = isUrgentKind(n.kind);

  function setRead(read: boolean) {
    setUnread(!read);
    start(async () => {
      const r = read ? await markReadAction(n.id) : await markUnreadAction(n.id);
      if (!r.ok) {
        setUnread(read);
        toast.error(r.error);
      }
    });
  }

  async function open(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!unread) return; // Already read: a plain link.
    // New-tab clicks keep the browser's behavior; the read mark goes out alongside.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      setUnread(false);
      void markReadAction(n.id);
      return;
    }
    e.preventDefault();
    setOpening(true);
    setUnread(false);
    // Mark read first so the header count is right on the page we land on.
    await markReadAction(n.id).catch(() => null);
    router.push(n.href!);
  }

  const titleId = `notif-${n.id}`;
  return (
    <li className={cn("relative flex gap-3 px-4 py-3.5 transition-colors sm:px-5", unread ? "bg-brand-50/50" : "", n.href ? "hover:bg-muted/60" : "")} aria-labelledby={titleId}>
      <span
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          urgent ? "bg-warning-50 text-warning" : unread ? "bg-brand-100 text-brand" : "bg-muted text-ink-3",
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p id={titleId} className={cn("text-sm [overflow-wrap:anywhere]", unread ? "font-semibold text-ink" : "font-medium text-ink-2")}>
          {unread ? <span className="sr-only">Unread: </span> : null}
          {n.href ? (
            <Link href={n.href} onClick={(e) => void open(e)} className="rounded-sm after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-2 focus-visible:outline-brand">
              {n.title}
            </Link>
          ) : (
            n.title
          )}
        </p>
        {n.body ? <p className="mt-0.5 line-clamp-3 text-sm text-ink-2 [overflow-wrap:anywhere]">{n.body}</p> : null}
        <p className="mt-1 text-xs text-ink-3">
          <time dateTime={n.at}>{n.timeLabel}</time>
        </p>
      </div>
      <div className="relative z-10 flex shrink-0 items-start gap-1">
        {opening ? <Loader2 className="mt-2 h-4 w-4 animate-spin text-ink-3" aria-label="Opening" /> : null}
        {unread ? <Circle className="mt-2.5 h-2.5 w-2.5 fill-brand text-brand" aria-hidden /> : null}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-ink-3"
          onClick={() => setRead(unread)}
          disabled={pending || opening}
          aria-label={unread ? `Mark “${n.title}” as read` : `Mark “${n.title}” as unread`}
          title={unread ? "Mark as read" : "Mark as unread"}
        >
          {unread ? <CheckCheck className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
        </Button>
      </div>
    </li>
  );
}

/** "Mark all as read" for the page header. */
export function MarkAllReadButton({ count }: { count: number }) {
  const [pending, start] = useTransition();
  if (!count) return null;
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await markAllReadAction();
          if (r.ok) toast.success(r.data.count === 1 ? "Marked 1 notification as read." : `Marked ${r.data.count} notifications as read.`);
          else toast.error(r.error);
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCheck className="h-4 w-4" aria-hidden />}
      Mark all as read
    </Button>
  );
}
