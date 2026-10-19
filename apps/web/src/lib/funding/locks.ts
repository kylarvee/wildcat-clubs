import type { FundingStatus } from "@prisma/client";

/**
 * The lock rule for cost lines, in one place. The Budget tool's general
 * costs, the Events Builder's event costs and the request builder all read
 * it: lib/domain/funding (loadClubTermBudget) and lib/domain/events
 * (costLineLocks). Pure and client-safe.
 *
 * A funding request's line keeps its budget item locked, so the item still
 * matches what the club asked for, while the request is in WSUSA review and
 * after WSUSA funds that line in full. A line WSUSA funds for less than it
 * asked (0 = not funded) lets go: the club can change the item and ask
 * another source for what's left. Drafts, requests WSUSA didn't approve and
 * withdrawn requests hold nothing.
 */

export type CoveringLine = {
  status: FundingStatus;
  /** What the request line asked for. */
  totalCents: number;
  /** WSUSA's decision on the line: null until decided, 0 = not funded. */
  approvedCents: number | null;
};

const APPROVED: FundingStatus[] = ["APPROVED", "PARTIALLY_APPROVED"];

/** Does this request line keep its budget item locked? */
export function holdsLock(line: CoveringLine): boolean {
  if (line.status === "SUBMITTED") return true;
  // An approval with no line amounts (recorded before WSUSA decided line by line) counts as funding every line in full.
  if (APPROVED.includes(line.status)) return line.approvedCents === null || line.approvedCents >= line.totalCents;
  return false;
}

/** What WSUSA granted for this request line: 0 unless its request was approved. */
export function grantedCents(line: CoveringLine): number {
  if (!APPROVED.includes(line.status)) return 0;
  return line.approvedCents ?? line.totalCents;
}

export type LineStanding<T> = {
  /** The request line holding the item locked, if one does. */
  lockedBy: T | null;
  /** What approved requests granted for it so far. */
  fundedCents: number;
  /** What a new request would ask for: its cost minus what's funded (0 while it's locked). */
  openCents: number;
  /** A new request may include it: it's unlocked and not already funded in full. */
  requestable: boolean;
};

/**
 * Where one budget item stands, from its cost and every submitted or decided
 * request line that covers it. Per-meeting lines are requested term by term,
 * so callers pass one term's cost and that term's request lines.
 */
export function lineStanding<T extends CoveringLine>(totalCents: number, covering: T[]): LineStanding<T> {
  const lockedBy = covering.find(holdsLock) ?? null;
  const fundedCents = covering.reduce((s, l) => s + grantedCents(l), 0);
  const openCents = lockedBy ? 0 : Math.max(0, totalCents - fundedCents);
  return { lockedBy, fundedCents, openCents, requestable: !lockedBy && (openCents > 0 || fundedCents === 0) };
}
