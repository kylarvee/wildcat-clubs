import "server-only";
import { db } from "@/lib/db";
import { listOffices, notifyOffice } from "@/lib/offices";
import { storedOfficeId } from "@/lib/offices/rules";
import { followUpKeys, fundingTasks, invoiceLateNotice, reviewLateNotice } from "@/lib/funding/review";

/**
 * The "Funding follow-ups" scheduled job (lib/jobs/tick). The staff of the
 * office that decides a club's funding (WSUSA's admins, or an office that
 * decides its clubs' funding: the task's office, lib/offices) get one in-app
 * reminder about each
 *
 *  - funding request waiting longer than that office's review time (its
 *    Office.reviewDays, in business days), ReminderLog key
 *    `funding:review:<requestId>`, and
 *  - invoice still open past its task's due date, `funding:invoice:<invoiceId>`.
 *
 * Both are also urgent rows in the office queue (lib/analytics/admin), by the
 * same rule (lib/funding/review). A reminder claims its key before it's sent,
 * so a run that repeats or overlaps another sends nothing twice. The keys stay
 * for good: each request and invoice is reminded about once.
 */

export type FundingFollowUpRun = {
  /** Reminders sent this run. */
  requests: number;
  invoices: number;
  /** Late now, reminded this run or before. */
  lateRequests: number;
  lateInvoices: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** True when this run is the one that sends it (nobody claimed the key yet). */
async function claim(key: string, now: Date): Promise<boolean> {
  const r = await db.reminderLog.createMany({ data: [{ key, sentAt: now }], skipDuplicates: true });
  return r.count === 1;
}

export async function sendFundingFollowUps(now: Date = new Date()): Promise<FundingFollowUpRun> {
  // Each office's own review time decides when its requests are late.
  const offices = (await listOffices()).map((o) => ({ officeId: storedOfficeId(o), reviewDays: o.reviewDays }));
  const days = new Map(offices.map((o) => [o.officeId, o.reviewDays]));
  const open = { status: "OPEN", assigneeType: "ADMINS" } as const;
  const [reviewTasks, invoiceTasks] = await Promise.all([
    db.task.findMany({ where: { ...open, OR: offices.map((o) => ({ officeId: o.officeId, ...fundingTasks("review", true, now, o.reviewDays) })) }, select: { sourceId: true, officeId: true } }),
    db.task.findMany({ where: { ...open, ...fundingTasks("invoice", true, now, 0) }, select: { sourceId: true, dueAt: true, officeId: true } }),
  ]);
  const officeOf = new Map([...reviewTasks, ...invoiceTasks].map((t) => [t.sourceId, t.officeId]));
  const ids = (rows: { sourceId: string | null }[]) => rows.map((t) => t.sourceId).filter((x): x is string => Boolean(x));
  const [requests, invoices] = await Promise.all([
    db.fundingRequest.findMany({
      where: { id: { in: ids(reviewTasks) }, status: "SUBMITTED", submittedAt: { not: null } },
      select: { id: true, title: true, amountRequestedCents: true, submittedAt: true, club: { select: { name: true } } },
      orderBy: { submittedAt: "asc" },
    }),
    db.invoice.findMany({
      where: { id: { in: ids(invoiceTasks) }, status: "OPEN" },
      select: { id: true, number: true, amountCents: true, request: { select: { id: true, title: true, club: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  let sentRequests = 0;
  for (const r of requests) {
    if (!(await claim(followUpKeys.review(r.id), now))) continue;
    const officeId = officeOf.get(r.id) ?? null;
    const copy = reviewLateNotice({ clubName: r.club.name, title: r.title, cents: r.amountRequestedCents, submittedAt: r.submittedAt!, reviewDays: days.get(officeId) ?? days.get(null) ?? 10 }, now);
    // In-app only: the registry's channels for this kind.
    await notifyOffice({ officeId }, { kind: "funding.overdue", title: copy.title, body: copy.body, href: `/admin/funding/${r.id}` });
    sentRequests++;
  }

  const dueAt = new Map(invoiceTasks.map((t) => [t.sourceId, t.dueAt]));
  let sentInvoices = 0;
  for (const i of invoices) {
    const due = dueAt.get(i.id);
    if (!due || !(await claim(followUpKeys.invoice(i.id), now))) continue;
    const copy = invoiceLateNotice({ number: i.number, clubName: i.request.club.name, title: i.request.title, cents: i.amountCents, dueAt: due });
    await notifyOffice({ officeId: officeOf.get(i.id) ?? null }, { kind: "invoice.overdue", title: copy.title, body: copy.body, href: `/admin/funding/${i.request.id}` });
    sentInvoices++;
  }

  return { requests: sentRequests, invoices: sentInvoices, lateRequests: requests.length, lateInvoices: invoices.length };
}

/** Runs the job and returns its line for System → Scheduled jobs. */
export async function runFundingFollowUps(now: Date = new Date()): Promise<string> {
  const r = await sendFundingFollowUps(now);
  const requests = r.requests
    ? `Reminded the deciding offices about ${plural(r.requests, "request")} past review time`
    : r.lateRequests
      ? `${plural(r.lateRequests, "request")} past review time, already reminded`
      : "No request is past its office's review time";
  const invoices = r.invoices
    ? `reminded the deciding offices about ${plural(r.invoices, "invoice")} past due`
    : r.lateInvoices
      ? `${plural(r.lateInvoices, "invoice")} past due, already reminded`
      : "no invoice is past due";
  return `${requests}; ${invoices}.`;
}
