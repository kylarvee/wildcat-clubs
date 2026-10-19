import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { isAdmin } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { categoryAlways, DIGEST_PREF, NOTIFICATION_CATEGORIES, readPrefs, withChoice, type NotificationPrefs, type PrefKey } from "@/components/notifications/catalog";

/**
 * The notification bell: reading your own notifications and marking them
 * read, and your choices on Settings → Notifications (how each category
 * reaches you). Notifications are written only by lib/domain/notify
 * (notify()), so this module never creates them.
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

// ─── Your choices (Settings → Notifications) ─────────────────────────────────

const PrefKeys: [PrefKey, ...PrefKey[]] = [DIGEST_PREF, ...NOTIFICATION_CATEGORIES.map((c) => c.key)];

const PreferenceInput = z.object({
  key: z.enum(PrefKeys, { error: "Choose a kind of notification." }),
  channel: z.enum(["email", "push"], { error: "Choose email or push." }),
  on: z.boolean(),
});

/**
 * One switch: a category's Email or Push, or (WSUSA admins) the daily digest.
 * Saved in User.notificationPrefs the way the registry reads it
 * (components/notifications/catalog withChoice: back to the default clears the
 * choice). "Your account" has no switches, since those notices always send;
 * the master email switch and "Remind me before events" are
 * profiles.updateNotificationSettings.
 */
export async function setNotificationPreference(actor: Actor | null, input: unknown): Promise<{ prefs: NotificationPrefs }> {
  assertSignedIn(actor);
  const v = parse(PreferenceInput, input);
  const admin = isAdmin(actor);
  if (v.key === DIGEST_PREF) {
    if (!admin) throw forbidden("Only WSUSA administrators get the daily digest.");
    if (v.channel !== "email") throw invalid("The daily digest is an email.");
  } else if (categoryAlways(v.key)) {
    throw invalid("These notices always reach you, so they can't be switched off.");
  }
  const prefs = await db.$transaction(async (tx) => {
    // One change at a time per person, so two quick switches can't undo each other.
    await tx.$queryRaw`SELECT 1 AS locked FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
    const row = await tx.user.findUnique({ where: { id: actor.id }, select: { notificationPrefs: true } });
    const next = withChoice(readPrefs(row?.notificationPrefs), v.key, v.channel, v.on, { admin });
    await tx.user.update({ where: { id: actor.id }, data: { notificationPrefs: next as Prisma.InputJsonObject } });
    return next;
  });
  await logActivity({ actorId: actor.id, action: "user.settings_updated", entityType: "user", entityId: actor.id, data: { notifications: { [v.key]: { [v.channel]: v.on } } } });
  return { prefs };
}
