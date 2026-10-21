import type { Prisma } from "@prisma/client";
import { campusDate, fmtLongDate, fmtMoney, inCampusTime } from "@/lib/time";

/**
 * When an office's funding work is late, as one rule (pure and client-safe).
 * The "Funding follow-ups" job (lib/jobs/funding) reminds the deciding
 * office's staff, the office queue (lib/analytics/admin officeQueue) counts
 * these as urgent rows, and the admin funding pages mark them. Two things can
 * be late:
 *
 *  - a request waiting for a decision longer than the deciding office's
 *    review time (Office.reviewDays: WSUSA's, or the club's office's when it
 *    decides funding). It's counted in business days, Monday to Friday in
 *    campus time, the unit clubs are told to expect (holidays still count as
 *    business days);
 *  - an invoice still open past its task's due date (INVOICE_DUE_DAYS after
 *    the approval that created it).
 */

/** Days the deciding office gives itself to get approved money through the university finance system. */
export const INVOICE_DUE_DAYS = 10;

const DAY = 86_400_000;

/** A campus calendar date as UTC midnight, so stepping by a day never trips on daylight saving. */
function campusDay(d: Date): number {
  const c = inCampusTime(d);
  return Date.UTC(c.getFullYear(), c.getMonth(), c.getDate());
}

function isWeekday(day: number): boolean {
  const w = new Date(day).getUTCDay();
  return w !== 0 && w !== 6;
}

/** Business days since `from`: the weekdays after its campus date, up to and including today's. */
export function businessDaysSince(from: Date, now: Date): number {
  const end = campusDay(now);
  let n = 0;
  for (let d = campusDay(from) + DAY; d <= end; d += DAY) if (isWeekday(d)) n++;
  return n;
}

/** Has a request submitted at `submittedAt` waited longer than its office's review time? */
export function pastReviewTime(submittedAt: Date, now: Date, reviewDays: number): boolean {
  return businessDaysSince(submittedAt, now) > reviewDays;
}

/**
 * pastReviewTime() as a cutoff for queries: requests submitted before this
 * moment have waited longer than `reviewDays` business days by `now`. It's
 * the start of the weekday `reviewDays + 1` business days back, counting
 * today when it's a weekday.
 */
export function reviewCutoff(now: Date, reviewDays: number): Date {
  let day = campusDay(now);
  let left = Math.max(0, Math.floor(reviewDays)) + 1;
  for (;;) {
    if (isWeekday(day) && --left === 0) break;
    day -= DAY;
  }
  const d = new Date(day);
  return campusDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Open funding tasks, on time or late (Task where clauses for the queue, the
 * job and the funding page's counts; callers pair each with its office's
 * review time). A request's APPROVAL task opens the moment it's submitted; an
 * invoice's task carries its due date.
 */
export function fundingTasks(kind: "review" | "invoice", late: boolean, now: Date, reviewDays: number): Prisma.TaskWhereInput {
  if (kind === "review") {
    const cutoff = reviewCutoff(now, reviewDays);
    return { sourceType: "funding", createdAt: late ? { lt: cutoff } : { gte: cutoff } };
  }
  return late ? { sourceType: "invoice", dueAt: { lt: now } } : { sourceType: "invoice", OR: [{ dueAt: null }, { dueAt: { gte: now } }] };
}

/** ReminderLog keys: each late request and invoice is reminded about once, for good. */
export const followUpKeys = {
  review: (requestId: string) => `funding:review:${requestId}`,
  invoice: (invoiceId: string) => `funding:invoice:${invoiceId}`,
};

/** "Past review time: Wildcat Investors — Fall speaker series". */
export function reviewLateNotice(r: { clubName: string; title: string; cents: number; submittedAt: Date; reviewDays: number }, now: Date) {
  const days = businessDaysSince(r.submittedAt, now);
  return {
    title: `Past review time: ${r.clubName} — ${r.title}`,
    body: `${fmtMoney(r.cents)}, waiting for a decision since ${fmtLongDate(r.submittedAt)} (${days} business days). Clubs are told to expect one within about ${r.reviewDays}.`,
  };
}

/** "Invoice WC-2026-0012 is past due". */
export function invoiceLateNotice(i: { number: string; clubName: string; title: string; cents: number; dueAt: Date }) {
  return {
    title: `Invoice ${i.number} is past due`,
    body: `${fmtMoney(i.cents)} for ${i.clubName} — ${i.title} was due to go through the university finance system by ${fmtLongDate(i.dueAt)}. Mark the invoice processed once the transfer shows up.`,
  };
}
