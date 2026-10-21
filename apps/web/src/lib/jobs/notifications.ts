import "server-only";
import { db } from "@/lib/db";
import { officeQueue, queueScopeOf, type OfficeQueue } from "@/lib/analytics/admin";
import { emailSender, sendEmail, type DeliveryResult } from "@/lib/integrations/email";
import { pushSender } from "@/lib/integrations/push";
import { DIGEST_KINDS, digestOn, readPrefs } from "@/components/notifications/catalog";
import { DIGEST_KEY_PREFIX, DIGEST_LIST_MAX, DIGEST_LOOKBACK_MS, digestDue, digestEmail, digestKey } from "@/lib/jobs/digest-rules";

/**
 * The "Send queued messages" scheduled job (lib/jobs/tick), every ~15 minutes:
 *
 *  - The daily digest, with the first run at or after 7 AM campus time
 *    (lib/jobs/digest-rules): one email per admin or office staffer who
 *    keeps email and the digest on, about what's waiting in their office's
 *    queue (WSUSA's for the admins) and the digest-kind notices held back
 *    since the last one. Its ReminderLog key (digest:admins:<campus date>) is
 *    claimed before anything is sent, so a second run that day sends nothing.
 *  - The queue: big sends (lib/domain/notify, more than QUEUE_OVER people)
 *    record their emails and pushes as QUEUED outbox rows. Each run sends
 *    the oldest QUEUE_BATCH of them and marks each SENT, MOCKED (integration
 *    off) or FAILED, with sentAt. A run claims its rows first (sentAt on a
 *    QUEUED row), so two overlapping runs never send the same message; a
 *    claim older than CLAIM_STALE_MS (a run that died) is picked up again.
 */

/** Queued messages sent per run, oldest first. */
export const QUEUE_BATCH = 200;
const CLAIM_STALE_MS = 15 * 60_000;
const DIGEST_KEEP_MS = 30 * 86_400_000;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export type QueueRun = { emails: number; pushes: number; mocked: number; failed: number; left: number };
export type DigestRun = { state: "sent"; admins: number } | { state: "early" | "done" | "empty" };

/** Runs the digest, then a batch of the queue, and returns the job's line for System → Scheduled jobs. */
export async function runNotificationJobs(now: Date = new Date()): Promise<string> {
  const digest = await sendAdminDigest(now);
  const queue = await sendQueuedMessages(now);
  const sent = queue.emails + queue.pushes;
  const parts = [
    digest.state === "sent"
      ? `Sent the daily digest to ${plural(digest.admins, "admin or office staffer", "admins and office staff")}`
      : digest.state === "done"
        ? "The daily digest already went out today"
        : digest.state === "empty"
          ? "Nothing was waiting on WSUSA or any office, so there was no digest today"
          : "The daily digest goes out after 7 AM",
    sent
      ? `sent ${plural(sent, "queued message")} (${[queue.emails ? plural(queue.emails, "email") : null, queue.pushes ? plural(queue.pushes, "push", "pushes") : null].filter(Boolean).join(", ")}${queue.mocked ? `; ${queue.mocked === sent ? "all" : queue.mocked.toLocaleString("en-US")} recorded in the outbox in mock mode` : ""}${queue.failed ? `; ${queue.failed.toLocaleString("en-US")} failed` : ""})`
      : "no messages were waiting to send",
  ];
  if (sent) parts.push(queue.left ? `${queue.left.toLocaleString("en-US")} still waiting for the next run` : "none left waiting");
  return parts.join("; ") + ".";
}

// ─── The queue ───────────────────────────────────────────────────────────────

export async function sendQueuedMessages(now: Date = new Date(), limit = QUEUE_BATCH): Promise<QueueRun> {
  const stale = new Date(now.getTime() - CLAIM_STALE_MS);
  // Claim the oldest waiting rows in one statement (the outbox's (status, createdAt) index serves it).
  const claimed = await db.$queryRaw<{ id: string }[]>`
    UPDATE "OutboxMessage" SET "sentAt" = (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    WHERE id IN (
      SELECT id FROM "OutboxMessage"
      WHERE status = 'QUEUED' AND ("sentAt" IS NULL OR "sentAt" < (${stale.toISOString()}::timestamptz AT TIME ZONE 'UTC'))
      ORDER BY "createdAt", id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  const run: QueueRun = { emails: 0, pushes: 0, mocked: 0, failed: 0, left: 0 };
  if (claimed.length) {
    const rows = await db.outboxMessage.findMany({
      where: { id: { in: claimed.map((c) => c.id) } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, channel: true, to: true, subject: true, body: true, href: true },
    });
    const email = rows.some((r) => r.channel === "EMAIL") ? await emailSender() : null;
    const push = rows.some((r) => r.channel === "PUSH") ? await pushSender() : null;
    for (const r of rows) {
      const m = { to: r.to, subject: r.subject ?? "", body: r.body, href: r.href };
      const result: DeliveryResult = r.channel === "EMAIL" ? await email!(m) : await push!(m);
      // Marked one by one, so a run that dies partway leaves only unsent rows to pick up again.
      await db.outboxMessage.update({ where: { id: r.id }, data: { status: result.status, error: result.error, sentAt: new Date() } });
      if (r.channel === "EMAIL") run.emails++;
      else run.pushes++;
      if (result.status === "MOCKED") run.mocked++;
      if (result.status === "FAILED") run.failed++;
    }
  }
  run.left = await db.outboxMessage.count({ where: { status: "QUEUED" } });
  return run;
}

// ─── WSUSA's daily digest ────────────────────────────────────────────────────

export async function sendAdminDigest(now: Date = new Date()): Promise<DigestRun> {
  if (!digestDue(now)) return { state: "early" };
  const key = digestKey(now);
  const [previous] = await Promise.all([
    db.reminderLog.findFirst({ where: { key: { startsWith: DIGEST_KEY_PREFIX, not: key } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
    db.reminderLog.deleteMany({ where: { key: { startsWith: DIGEST_KEY_PREFIX }, sentAt: { lt: new Date(now.getTime() - DIGEST_KEEP_MS) } } }),
  ]);
  const claim = await db.reminderLog.createMany({ data: [{ key, sentAt: now }], skipDuplicates: true });
  if (claim.count !== 1) return { state: "done" };

  const since = previous && previous.sentAt > new Date(now.getTime() - 7 * 86_400_000) ? previous.sentAt : null;
  const from = since ?? new Date(now.getTime() - DIGEST_LOOKBACK_MS);
  // Platform admins read WSUSA's queue; an office's staff read their own office's.
  const readers = await db.user.findMany({
    where: { status: "ACTIVE", emailNotifications: true, OR: [{ platformRole: { in: ["ADMIN", "SYSADMIN"] } }, { officeMemberships: { some: { office: { umbrella: false } } } }] },
    select: { id: true, email: true, notificationPrefs: true, platformRole: true, officeMemberships: { where: { office: { umbrella: false } }, select: { officeId: true } } },
  });
  // One queue per distinct scope: every admin shares WSUSA's.
  const queues = new Map<string, Promise<OfficeQueue & { name: string }>>();
  const queueOf = (r: (typeof readers)[number]) => {
    const all = r.platformRole === "ADMIN" || r.platformRole === "SYSADMIN";
    const officeIds = r.officeMemberships.map((m) => m.officeId).sort();
    const key = all ? "*" : officeIds.join(",");
    if (!queues.has(key))
      queues.set(
        key,
        queueScopeOf({ all, officeIds }).then(async (c) => ({ ...(await officeQueue(c.scope, now)), name: c.name })),
      );
    return queues.get(key)!;
  };
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  let sent = 0;
  for (const a of readers.filter((x) => digestOn(readPrefs(x.notificationPrefs)))) {
    const where = { userId: a.id, kind: { in: DIGEST_KINDS }, createdAt: { gte: from, lte: now } };
    const [held, count, queue] = await Promise.all([
      db.notification.findMany({ where, orderBy: { createdAt: "asc" }, take: DIGEST_LIST_MAX, select: { title: true, createdAt: true } }),
      db.notification.count({ where }),
      queueOf(a),
    ]);
    const mail = digestEmail({ rows: queue.rows, notices: held, more: Math.max(0, count - held.length), since, now, appUrl, office: queue.name });
    if (!mail) continue;
    await sendEmail({ to: a.email, subject: mail.subject, body: mail.body, href: mail.href });
    sent++;
  }
  return sent ? { state: "sent", admins: sent } : { state: "empty" };
}
