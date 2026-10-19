import "server-only";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/integrations/email";
import { sendPush } from "@/lib/integrations/push";
import { adminIds, clubCapabilityHolders } from "@/lib/authz/people";
import type { Capability } from "@/lib/authz";

/**
 * The one way to tell people something happened. Writes the in-app
 * notification (the bell), then emails and pushes per the user's settings.
 * Never pass anonymous-complaint content through here.
 */
export type NotifyInput = {
  userIds: string[];
  kind: string; // e.g. "membership.approved", "event.cohost_request"
  title: string;
  body?: string;
  href?: string;
  email?: boolean; // default true
  push?: boolean; // default true
  /** Skip this user (usually the actor). */
  exceptUserId?: string | null;
};

export async function notify(input: NotifyInput) {
  const ids = [...new Set(input.userIds)].filter((id) => id && id !== input.exceptUserId);
  if (ids.length === 0) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({ userId, kind: input.kind, title: input.title, body: input.body, href: input.href })),
  });
  const users = await db.user.findMany({
    where: { id: { in: ids }, status: { not: "DEACTIVATED" } },
    select: { id: true, email: true, emailNotifications: true },
  });
  await Promise.all(
    users.map(async (u) => {
      if (input.email !== false && u.emailNotifications) {
        await sendEmail({ to: u.email, subject: input.title, body: input.body ?? input.title, href: input.href });
      }
      if (input.push !== false) await sendPush(u.id, { title: input.title, body: input.body, href: input.href });
    }),
  );
}

export async function notifyAdmins(input: Omit<NotifyInput, "userIds">) {
  await notify({ ...input, userIds: await adminIds() });
}

export async function notifyClubCapability(clubId: string, cap: Capability, input: Omit<NotifyInput, "userIds">) {
  await notify({ ...input, userIds: await clubCapabilityHolders(clubId, cap) });
}

/**
 * notify() for big audiences (a club's followers, everyone owed a reminder):
 * the same notification, sent `size` people at a time so one batch's email
 * and push work stays small. Run it after the response (next/server after()).
 */
export async function notifyInBatches(input: NotifyInput, size = 100) {
  const ids = [...new Set(input.userIds)].filter((id) => id && id !== input.exceptUserId);
  for (let i = 0; i < ids.length; i += size) await notify({ ...input, userIds: ids.slice(i, i + size) });
}

/** Sends to an address that may not have an account yet (advisor invites). */
export async function emailAddress(to: string, subject: string, body: string, href?: string) {
  await sendEmail({ to, subject, body, href });
}
