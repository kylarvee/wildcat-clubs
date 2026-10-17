import "server-only";
import { differenceInCalendarDays } from "date-fns";
import { fmtDate, fmtTime, inCampusTime } from "@/lib/time";
import type { NotificationGroup, NotificationItem } from "@/components/notifications/NotificationList";

type Row = { id: string; kind: string; title: string; body: string | null; href: string | null; createdAt: Date; readAt: Date | null };

/** "Today", "Yesterday", "Monday", "Oct 2", "Sep 14, 2025" — campus days. */
export function dayLabel(d: Date, now: Date): string {
  const days = differenceInCalendarDays(inCampusTime(now), inCampusTime(d));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return fmtDate(d, "EEEE");
  return inCampusTime(d).getFullYear() === inCampusTime(now).getFullYear() ? fmtDate(d, "EEE, MMM d") : fmtDate(d, "MMM d, yyyy");
}

function timeLabel(d: Date, now: Date): string {
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  return fmtTime(d);
}

export function toNotificationItem(n: Row, now: Date): NotificationItem {
  return { id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, at: n.createdAt.toISOString(), timeLabel: timeLabel(n.createdAt, now), unread: !n.readAt };
}

/** Rows (already newest first) grouped into campus days, keeping their order. */
export function groupByDay(rows: Row[], now: Date, prefix = ""): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  for (const n of rows) {
    const label = dayLabel(n.createdAt, now);
    const key = `${prefix}${fmtDate(n.createdAt, "yyyy-MM-dd")}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(toNotificationItem(n, now));
    else groups.push({ key, label, items: [toNotificationItem(n, now)] });
  }
  return groups;
}
