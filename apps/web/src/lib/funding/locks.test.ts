import { describe, expect, it } from "vitest";
import { grantedCents, holdsLock, lineStanding, type CoveringLine } from "@/lib/funding/locks";

const line = (status: CoveringLine["status"], totalCents: number, approvedCents: number | null = null): CoveringLine => ({ status, totalCents, approvedCents });

describe("the cost-line lock rule", () => {
  it("locks a line while its request is in WSUSA review", () => {
    expect(holdsLock(line("SUBMITTED", 18500))).toBe(true);
  });

  it("keeps a line locked once WSUSA funds it in full", () => {
    expect(holdsLock(line("APPROVED", 18500, 18500))).toBe(true);
    // Approved in full inside a partly approved request: still locked.
    expect(holdsLock(line("PARTIALLY_APPROVED", 22000, 22000))).toBe(true);
  });

  it("unlocks a line WSUSA funded for less than it asked, or not at all", () => {
    expect(holdsLock(line("PARTIALLY_APPROVED", 18500, 0))).toBe(false);
    expect(holdsLock(line("PARTIALLY_APPROVED", 114000, 57000))).toBe(false);
  });

  it("treats an approval with no line amounts (before line-by-line decisions) as funded in full", () => {
    expect(holdsLock(line("APPROVED", 18500, null))).toBe(true);
    expect(grantedCents(line("APPROVED", 18500, null))).toBe(18500);
  });

  it("never locks for drafts, denials or withdrawals", () => {
    for (const s of ["DRAFT", "DENIED", "WITHDRAWN"] as const) expect(holdsLock(line(s, 18500, s === "DENIED" ? 0 : null))).toBe(false);
  });

  it("counts only approved money as funded", () => {
    expect(grantedCents(line("SUBMITTED", 18500))).toBe(0);
    expect(grantedCents(line("DENIED", 18500, 0))).toBe(0);
    expect(grantedCents(line("PARTIALLY_APPROVED", 114000, 57000))).toBe(57000);
  });
});

describe("where a budget item stands", () => {
  it("is open in full before any request", () => {
    expect(lineStanding(18500, [])).toEqual({ lockedBy: null, fundedCents: 0, openCents: 18500, requestable: true });
  });

  it("is locked, with nothing open, while a request covers it", () => {
    const s = lineStanding(18500, [line("SUBMITTED", 18500)]);
    expect(s.lockedBy).not.toBeNull();
    expect(s).toMatchObject({ openCents: 0, requestable: false });
  });

  it("opens again in full after a line WSUSA didn't fund", () => {
    expect(lineStanding(18500, [line("PARTIALLY_APPROVED", 18500, 0)])).toEqual({ lockedBy: null, fundedCents: 0, openCents: 18500, requestable: true });
  });

  it("leaves only the unfunded part open after a line funded in part", () => {
    expect(lineStanding(114000, [line("PARTIALLY_APPROVED", 114000, 57000)])).toEqual({ lockedBy: null, fundedCents: 57000, openCents: 57000, requestable: true });
  });

  it("locks again when another source's request for the rest is in review, then funded", () => {
    const first = line("PARTIALLY_APPROVED", 114000, 57000);
    expect(lineStanding(114000, [first, line("SUBMITTED", 57000)]).lockedBy?.status).toBe("SUBMITTED");
    const done = lineStanding(114000, [first, line("APPROVED", 57000, 57000)]);
    expect(done).toMatchObject({ fundedCents: 114000, openCents: 0, requestable: false });
    expect(done.lockedBy?.status).toBe("APPROVED");
  });

  it("isn't requestable when what's funded already covers its cost (it was changed after the decision)", () => {
    expect(lineStanding(40000, [line("PARTIALLY_APPROVED", 114000, 57000)])).toMatchObject({ lockedBy: null, openCents: 0, requestable: false });
  });

  it("ignores denied and withdrawn requests", () => {
    expect(lineStanding(18500, [line("DENIED", 18500, 0), line("WITHDRAWN", 18500)])).toEqual({ lockedBy: null, fundedCents: 0, openCents: 18500, requestable: true });
  });
});
