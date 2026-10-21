import "server-only";
import { db } from "@/lib/db";
import { queueEmails, sendEmail, type EmailInput } from "@/lib/integrations/email";
import { queuePushes, sendPush, type PushInput } from "@/lib/integrations/push";
import { adminIds, clubCapabilityHolders } from "@/lib/authz/people";
import type { Capability } from "@/lib/authz";
import { readPrefs, resolveDelivery, type Recipient } from "@/components/notifications/catalog";

/**
 * The one way to tell people something happened. Writes the in-app
 * notification (the bell) for everyone at once, then emails and pushes each
 * person as the notification registry (components/notifications/catalog
 * resolveDelivery) and their Settings → Notifications choices say.
 *
 * A send that reaches more than QUEUE_OVER people records its emails and
 * pushes as QUEUED in the outbox instead of sending them, and the "Send
 * queued messages" job (lib/jobs/notifications) delivers them in batches, so
 * a big audience never makes a request wait on hundreds of emails. WSUSA's
 * digest kinds aren't emailed to admins or office staff one by one: the
 * daily digest covers them (same job).
 *
 * Never pass anonymous-complaint content through here.
 */
export type NotifyInput = {
  userIds: string[];
  kind: string; // a registry key, e.g. "membership.approved", "event.cohost_request"
  title: string;
  body?: string;
  href?: string;
  /**
   * Only when it's situational ("a cancellation within 48 hours also
   * emails"): this send's default instead of the kind's. The registry holds
   * each kind's usual channels, and a person's own choice still wins.
   */
  email?: boolean;
  push?: boolean;
  /** Skip this user (usually the actor). */
  exceptUserId?: string | null;
};

/** One send reaching more people than this queues its email and push for the scheduled job. */
export const QUEUE_OVER = 50;

type Send = { n: NotifyInput; ids: string[] };

const CHUNK = 1000;
const chunks = <T,>(list: readonly T[], size = CHUNK): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

function recipients(n: NotifyInput): string[] {
  return [...new Set(n.userIds)].filter((id) => id && id !== n.exceptUserId);
}

export async function notify(input: NotifyInput) {
  await sendAll([input]);
}

/**
 * One kind of notice worded for each person, like a sweep's or a job's
 * one-per-person notices ("Club Officer Policy Test is due in 7 days"): one
 * write for the bells, and when together they reach more than QUEUE_OVER
 * people, their email and push are queued like one large notify(). Use it
 * instead of notify() in a loop.
 */
export async function notifyEach(input: { kind: string; notices: readonly Omit<NotifyInput, "kind">[] }) {
  await sendAll(input.notices.map((n) => ({ ...n, kind: input.kind })));
}

async function sendAll(inputs: NotifyInput[]) {
  const sends = inputs.map((n) => ({ n, ids: recipients(n) })).filter((s) => s.ids.length);
  const people = sends.reduce((sum, s) => sum + s.ids.length, 0);
  if (!people) return;
  await writeBells(sends);
  await deliver(sends, people > QUEUE_OVER);
}

export async function notifyAdmins(input: Omit<NotifyInput, "userIds">) {
  await notify({ ...input, userIds: await adminIds() });
}

export async function notifyClubCapability(clubId: string, cap: Capability, input: Omit<NotifyInput, "userIds">) {
  await notify({ ...input, userIds: await clubCapabilityHolders(clubId, cap) });
}

/**
 * notify() for big audiences (a club's followers, everyone owed a reminder):
 * the same notification, `size` people at a time, so no single write or
 * lookup grows with the audience. Above QUEUE_OVER people in all, every
 * batch's email and push are queued. Run it after the response (next/server after()).
 */
export async function notifyInBatches(input: NotifyInput, size = 100) {
  const ids = recipients(input);
  const queue = ids.length > QUEUE_OVER;
  for (let i = 0; i < ids.length; i += size) {
    const send = [{ n: input, ids: ids.slice(i, i + size) }];
    await writeBells(send);
    await deliver(send, queue);
  }
}

/** Sends to an address that may not have an account yet (advisor invites). */
export async function emailAddress(to: string, subject: string, body: string, href?: string) {
  await sendEmail({ to, subject, body, href });
}

// ─── Delivery ────────────────────────────────────────────────────────────────

/** The bells, in place before any email or push goes out. */
async function writeBells(sends: Send[]) {
  const rows = sends.flatMap(({ n, ids }) => ids.map((userId) => ({ userId, kind: n.kind, title: n.title, body: n.body, href: n.href })));
  for (const part of chunks(rows)) await db.notification.createMany({ data: part });
}

type Person = { id: string; email: string; emailNotifications: boolean; notificationPrefs: unknown; platformRole: string; officeMemberships?: { officeId: string }[] };

/** Admins and office staff (lib/offices) both read the daily digest, so digest kinds wait for it. */
const recipientOf = (u: Person): Recipient => ({
  emailOn: u.emailNotifications,
  admin: u.platformRole === "ADMIN" || u.platformRole === "SYSADMIN" || Boolean(u.officeMemberships?.length),
  prefs: readPrefs(u.notificationPrefs),
});

/** Email and push per the registry; queued for the scheduled job when `queue`. Deactivated accounts get neither. */
async function deliver(sends: Send[], queue: boolean) {
  const people = new Map<string, Person>();
  for (const ids of chunks([...new Set(sends.flatMap((s) => s.ids))])) {
    const rows = await db.user.findMany({
      where: { id: { in: ids }, status: { not: "DEACTIVATED" } },
      select: { id: true, email: true, emailNotifications: true, notificationPrefs: true, platformRole: true, officeMemberships: { where: { office: { umbrella: false } }, select: { officeId: true }, take: 1 } },
    });
    for (const u of rows) people.set(u.id, u);
  }
  const emails: EmailInput[] = [];
  const pushes: { userIds: string[]; input: PushInput }[] = [];
  for (const { n, ids } of sends) {
    const pushTo: string[] = [];
    for (const id of ids) {
      const u = people.get(id);
      if (!u) continue;
      const d = resolveDelivery(n.kind, recipientOf(u), { email: n.email, push: n.push });
      if (d.email === "now") emails.push({ to: u.email, subject: n.title, body: n.body ?? n.title, href: n.href, kind: n.kind });
      if (d.push) pushTo.push(u.id);
    }
    if (pushTo.length) pushes.push({ userIds: pushTo, input: { title: n.title, body: n.body, href: n.href, kind: n.kind } });
  }
  if (queue) {
    await queueEmails(emails);
    await queuePushes(pushes);
    return;
  }
  await Promise.all([...emails.map((e) => sendEmail(e)), ...pushes.flatMap((p) => p.userIds.map((id) => sendPush(id, p.input)))]);
}
