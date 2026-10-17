import type { FundingSource, FundingStatus } from "@prisma/client";

/**
 * The money math behind the Budget tool, funding requests and invoices.
 * Pure and client-safe (no server imports), so the request builder shows
 * exactly the numbers the domain will store. All amounts are integer cents.
 */

/** Statuses whose line items are spoken for: the club can't ask for them twice or edit them. */
export const ACTIVE_REQUEST_STATUSES: FundingStatus[] = ["SUBMITTED", "APPROVED", "PARTIALLY_APPROVED"];
/** Statuses that count as money the club asked for (withdrawn and draft requests don't). */
export const ASKED_STATUSES: FundingStatus[] = ["SUBMITTED", "APPROVED", "PARTIALLY_APPROVED", "DENIED"];
export const APPROVED_STATUSES: FundingStatus[] = ["APPROVED", "PARTIALLY_APPROVED"];

/** Ceiling for one request (well under Postgres int), so a typo can't overflow a total. */
export const MAX_REQUEST_CENTS = 1_000_000_000; // $10,000,000
/** Characters of "why we need it" a request needs before it can be submitted. */
export const MIN_JUSTIFICATION = 20;
/** Ceiling for one general cost line (quantity × unit cost). */
export const MAX_LINE_CENTS = 100_000_000; // $1,000,000

export function isActiveRequest(status: FundingStatus) {
  return ACTIVE_REQUEST_STATUSES.includes(status);
}

/** Dollars typed in a form → integer cents (19.99 → 1999). */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** One set of a line: quantity × unit cost, rounded to the cent (2.5 × $3.33 = $8.33). */
export function lineCents(quantity: number, unitCostCents: number): number {
  return Math.round(quantity * unitCostCents);
}

export type CostLineShape = {
  eventId: string | null;
  perOccurrence: boolean;
  /** The term the line is filed under (an event line's term is its first meeting's). */
  termId: string;
  quantity: number;
  unitCostCents: number;
};

/**
 * How many times a line counts in `termId`. Per-meeting event lines multiply by
 * the event's scheduled meetings in that term (a weekly meeting's snacks repeat
 * every week); one-time event lines and general costs count once, in the term
 * they're filed under. Matches eventCostSummaries() in lib/domain/events.
 */
export function occurrencesInTerm(line: CostLineShape, termId: string, eventMeetingsInTerm: number): number {
  if (line.eventId && line.perOccurrence) return Math.max(0, eventMeetingsInTerm);
  return line.termId === termId ? 1 : 0;
}

/** A line's cost in one term: one set × how many times it counts there. */
export function termLineTotal(line: CostLineShape, termId: string, eventMeetingsInTerm: number) {
  const occurrences = occurrencesInTerm(line, termId, eventMeetingsInTerm);
  const setCents = lineCents(line.quantity, line.unitCostCents);
  return { occurrences, setCents, totalCents: setCents * occurrences };
}

export function sumCents<T extends { totalCents: number }>(rows: T[]): number {
  return rows.reduce((s, r) => s + r.totalCents, 0);
}

export const emptyBySource = (): Record<FundingSource, number> => ({ UNIVERSITY: 0, WSUSA: 0, COLLEGE: 0, DEPARTMENT: 0 });

/** Planned cents per funding source. */
export function sumBySource<T extends { fundingSource: FundingSource; totalCents: number }>(rows: T[]): Record<FundingSource, number> {
  const out = emptyBySource();
  for (const r of rows) out[r.fundingSource] += r.totalCents;
  return out;
}

export type RequestMoney = { status: FundingStatus; fundingSource: FundingSource; amountRequestedCents: number; amountApprovedCents: number | null };

/**
 * Requested = everything the club asked for (submitted or decided, not
 * withdrawn); approved = what was granted; pending = still waiting on a decision.
 */
export function requestTotals(requests: RequestMoney[]) {
  const bySource = { UNIVERSITY: { requested: 0, approved: 0 }, WSUSA: { requested: 0, approved: 0 }, COLLEGE: { requested: 0, approved: 0 }, DEPARTMENT: { requested: 0, approved: 0 } } as Record<
    FundingSource,
    { requested: number; approved: number }
  >;
  let requested = 0;
  let approved = 0;
  let pending = 0;
  for (const r of requests) {
    if (ASKED_STATUSES.includes(r.status)) {
      requested += r.amountRequestedCents;
      bySource[r.fundingSource].requested += r.amountRequestedCents;
    }
    if (APPROVED_STATUSES.includes(r.status)) {
      approved += r.amountApprovedCents ?? 0;
      bySource[r.fundingSource].approved += r.amountApprovedCents ?? 0;
    }
    if (r.status === "SUBMITTED") pending += r.amountRequestedCents;
  }
  return { requested, approved, pending, bySource };
}

/** Problem with a partial approval amount, or null when it's fine. */
export function partialAmountProblem(requestedCents: number, approvedCents: number): string | null {
  if (!Number.isFinite(approvedCents) || approvedCents <= 0) return "Enter the amount you're approving. To approve nothing, choose Deny instead.";
  if (approvedCents >= requestedCents) return "A partial approval has to be less than the amount requested. To approve everything, choose Approve instead.";
  return null;
}

// ─── Invoice numbers ─────────────────────────────────────────────────────────

const INVOICE_RE = /^WC-(\d{4})-(\d{4,})$/;

/** WC-2026-0007 */
export function formatInvoiceNumber(year: number, seq: number): string {
  return `WC-${year}-${String(seq).padStart(4, "0")}`;
}

export function parseInvoiceNumber(number: string): { year: number; seq: number } | null {
  const m = INVOICE_RE.exec(number.trim());
  return m ? { year: Number(m[1]), seq: Number(m[2]) } : null;
}

/** The next number in `year`'s sequence, given the numbers already used. Sequences restart every year. */
export function nextInvoiceNumber(existing: string[], year: number): string {
  let max = 0;
  for (const n of existing) {
    const p = parseInvoiceNumber(n);
    if (p && p.year === year && p.seq > max) max = p.seq;
  }
  return formatInvoiceNumber(year, max + 1);
}
