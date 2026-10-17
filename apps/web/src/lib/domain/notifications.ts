import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, notFound, parse } from "@/lib/domain/kit";

/**
 * The notification bell: reading your own notifications and marking them
 * read. Notifications are written only by lib/domain/notify (notify()), so
 * this module never creates them.
 *
 * Read state is personal UI state, so single reads aren't written to the
 * activity stream (it would bury real activity); "mark all read" is.
 */

export const NOTIFICATIONS_PAGE = 200;

const ListOpts = z.object({
  take: z.number().int().min(1).max(NOTIFICATIONS_PAGE).default(NOTIFICATIONS_PAGE),
  unreadOnly: z.boolean().default(false),
});

/** Your notifications, unread first, newest first within each group. */
export async function listNotifications(actor: Actor | null, opts: { take?: number; unreadOnly?: boolean } = {}) {
  assertSignedIn(actor);
  const o = parse(ListOpts, opts);
  const unread = await db.notification.findMany({
    where: { userId: actor.id, readAt: null },
    orderBy: { createdAt: "desc" },
    take: o.take,
  });
  if (o.unreadOnly || unread.length >= o.take) return unread;
  const read = await db.notification.findMany({
    where: { userId: actor.id, readAt: { not: null } },
    orderBy: { createdAt: "desc" },
    take: o.take - unread.length,
  });
  return [...unread, ...read];
}

export async function unreadNotificationCount(actor: Actor | null) {
  assertSignedIn(actor);
  return db.notification.count({ where: { userId: actor.id, readAt: null } });
}

/** Mark one of your notifications read. Already-read ones keep their original time. */
export async function markRead(actor: Actor | null, notificationId: string) {
  assertSignedIn(actor);
  const id = parse(z.string().min(1).max(64), notificationId);
  const n = await db.notification.findUnique({ where: { id }, select: { userId: true, readAt: true, href: true } });
  // Someone else's notification looks exactly like a missing one.
  if (!n || n.userId !== actor.id) throw notFound("Notification");
  if (!n.readAt) await db.notification.update({ where: { id }, data: { readAt: new Date() } });
  return { href: n.href };
}

/** Mark one of your notifications unread again ("Mark as unread"). */
export async function markUnread(actor: Actor | null, notificationId: string) {
  assertSignedIn(actor);
  const id = parse(z.string().min(1).max(64), notificationId);
  const r = await db.notification.updateMany({ where: { id, userId: actor.id }, data: { readAt: null } });
  if (!r.count) throw notFound("Notification");
}

/** Mark every unread notification read. Returns how many changed. */
export async function markAllRead(actor: Actor | null) {
  assertSignedIn(actor);
  const r = await db.notification.updateMany({ where: { userId: actor.id, readAt: null }, data: { readAt: new Date() } });
  if (r.count) await logActivity({ actorId: actor.id, action: "notifications.read_all", entityType: "user", entityId: actor.id, data: { count: r.count } });
  return { count: r.count };
}
