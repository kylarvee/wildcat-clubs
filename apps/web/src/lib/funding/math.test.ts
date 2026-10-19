import { describe, expect, it } from "vitest";
import {
  decideLines,
  dollarsToCents,
  earlierFundedCents,
  formatInvoiceNumber,
  lineCents,
  nextInvoiceNumber,
  occurrencesInTerm,
  parseInvoiceNumber,
  requestTotals,
  sumBySource,
  sumCents,
  termLineTotal,
} from "@/lib/funding/math";
import { defaultFundingSource } from "@/lib/funding/defaults";
import { requestTimeline } from "@/lib/funding/timeline";

const FALL = "term-fall";
const SPRING = "term-spring";

describe("cents", () => {
  it("converts typed dollars without float drift", () => {
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(dollarsToCents(1250)).toBe(125000);
  });

  it("rounds a fractional quantity to the cent", () => {
    expect(lineCents(2.5, 333)).toBe(833); // 832.5 → 833
    expect(lineCents(150, 15)).toBe(2250);
    expect(lineCents(1, 0)).toBe(0);
  });
});

describe("occurrence multiplication", () => {
  const snacks = { eventId: "ev1", perOccurrence: true, termId: FALL, quantity: 1, unitCostCents: 2500 };
  const photographer = { eventId: "ev2", perOccurrence: false, termId: FALL, quantity: 1, unitCostCents: 15000 };
  const tshirts = { eventId: null, perOccurrence: false, termId: FALL, quantity: 40, unitCostCents: 1250 };

  it("multiplies per-meeting event lines by the meetings in the term", () => {
    expect(termLineTotal(snacks, FALL, 12)).toEqual({ occurrences: 12, setCents: 2500, totalCents: 30000 });
  });

  it("counts a repeating event's meetings in each term separately", () => {
    // Filed under fall (its first meeting), but spring meetings cost spring money.
    expect(termLineTotal(snacks, SPRING, 4).totalCents).toBe(10000);
    expect(termLineTotal(snacks, FALL, 0).totalCents).toBe(0);
  });

  it("counts one-time event lines once, only in their own term", () => {
    expect(occurrencesInTerm(photographer, FALL, 12)).toBe(1);
    expect(occurrencesInTerm(photographer, SPRING, 4)).toBe(0);
    expect(termLineTotal(photographer, FALL, 12).totalCents).toBe(15000);
  });

  it("counts general costs once, in their own term, ignoring meetings", () => {
    expect(termLineTotal(tshirts, FALL, 99)).toEqual({ occurrences: 1, setCents: 50000, totalCents: 50000 });
    expect(termLineTotal(tshirts, SPRING, 99).totalCents).toBe(0);
  });

  it("never multiplies by a negative meeting count", () => {
    expect(occurrencesInTerm(snacks, FALL, -3)).toBe(0);
  });
});

describe("totals", () => {
  const rows = [
    { fundingSource: "WSUSA" as const, totalCents: 30000 },
    { fundingSource: "DEPARTMENT" as const, totalCents: 15000 },
    { fundingSource: "WSUSA" as const, totalCents: 2250 },
  ];

  it("sums every line", () => {
    expect(sumCents(rows)).toBe(47250);
    expect(sumCents([])).toBe(0);
  });

  it("splits planned money by funding source, with every source present", () => {
    expect(sumBySource(rows)).toEqual({ UNIVERSITY: 0, WSUSA: 32250, COLLEGE: 0, DEPARTMENT: 15000 });
  });

  it("counts requested, approved and pending by status", () => {
    const t = requestTotals([
      { status: "DRAFT", fundingSource: "WSUSA", amountRequestedCents: 99999, amountApprovedCents: null },
      { status: "SUBMITTED", fundingSource: "WSUSA", amountRequestedCents: 10000, amountApprovedCents: null },
      { status: "APPROVED", fundingSource: "WSUSA", amountRequestedCents: 20000, amountApprovedCents: 20000 },
      { status: "PARTIALLY_APPROVED", fundingSource: "DEPARTMENT", amountRequestedCents: 30000, amountApprovedCents: 12000 },
      { status: "DENIED", fundingSource: "WSUSA", amountRequestedCents: 5000, amountApprovedCents: null },
      { status: "WITHDRAWN", fundingSource: "WSUSA", amountRequestedCents: 7000, amountApprovedCents: null },
    ]);
    expect(t.requested).toBe(65000);
    expect(t.approved).toBe(32000);
    expect(t.pending).toBe(10000);
    expect(t.bySource.WSUSA).toEqual({ requested: 35000, approved: 20000 });
    expect(t.bySource.DEPARTMENT).toEqual({ requested: 30000, approved: 12000 });
    expect(t.bySource.COLLEGE).toEqual({ requested: 0, approved: 0 });
  });

  it("counts approved money by the source that funded it", () => {
    const t = requestTotals([
      { status: "APPROVED", fundingSource: "DEPARTMENT", fundedSource: "WSUSA", amountRequestedCents: 20000, amountApprovedCents: 20000 },
      { status: "PARTIALLY_APPROVED", fundingSource: "COLLEGE", fundedSource: null, amountRequestedCents: 9000, amountApprovedCents: 4000 },
    ]);
    expect(t.bySource.DEPARTMENT).toEqual({ requested: 20000, approved: 0 });
    expect(t.bySource.WSUSA).toEqual({ requested: 0, approved: 20000 });
    expect(t.bySource.COLLEGE).toEqual({ requested: 9000, approved: 4000 });
  });
});

describe("line-by-line decisions", () => {
  const lines = [
    { id: "food", totalCents: 22000 },
    { id: "room", totalCents: 15000 },
    { id: "banner", totalCents: 18500 },
  ];

  it("approves every line in full when no amounts are changed", () => {
    expect(decideLines(lines)).toMatchObject({ ok: true, status: "APPROVED", approvedCents: 55500, reduced: 0 });
    expect(decideLines(lines, { food: 22000 })).toMatchObject({ ok: true, status: "APPROVED" });
  });

  it("makes it a partial approval when any line gets less, and sums the lines", () => {
    const d = decideLines(lines, { banner: 0 });
    expect(d).toMatchObject({ ok: true, status: "PARTIALLY_APPROVED", approvedCents: 37000, reduced: 1 });
    if (d.ok) expect(d.lines.map((l) => l.approvedCents)).toEqual([22000, 15000, 0]);
    expect(decideLines(lines, { food: 12000, banner: 0 })).toMatchObject({ ok: true, approvedCents: 27000, reduced: 2 });
  });

  it("refuses more than a line asks for, negative or missing amounts, and approving nothing", () => {
    expect(decideLines(lines, { room: 15001 })).toMatchObject({ ok: false, problem: expect.stringMatching(/more than it asks/) });
    expect(decideLines(lines, { room: -1 })).toMatchObject({ ok: false });
    expect(decideLines(lines, { room: Number.NaN })).toMatchObject({ ok: false });
    expect(decideLines(lines, { food: 0, room: 0, banner: 0 })).toMatchObject({ ok: false, problem: expect.stringMatching(/Don't approve/) });
  });

  it("refuses an amount for a line that isn't in the request", () => {
    expect(decideLines(lines, { other: 100 })).toMatchObject({ ok: false });
  });

  it("knows how much of a line was funded before it was asked for again", () => {
    // 12 sets × $95: half funded earlier, so the new request asks for the other $570.
    expect(earlierFundedCents({ quantity: 12, unitCostCents: 9500, occurrences: 1, totalCents: 57000 })).toBe(57000);
    expect(earlierFundedCents({ quantity: 1, unitCostCents: 2500, occurrences: 12, totalCents: 30000 })).toBe(0);
  });
});

describe("invoice numbers", () => {
  it("formats WC-<year>-<4 digits>", () => {
    expect(formatInvoiceNumber(2026, 7)).toBe("WC-2026-0007");
    expect(formatInvoiceNumber(2026, 12345)).toBe("WC-2026-12345");
  });

  it("parses only well-formed numbers", () => {
    expect(parseInvoiceNumber("WC-2026-0010")).toEqual({ year: 2026, seq: 10 });
    expect(parseInvoiceNumber("WC-26-0010")).toBeNull();
    expect(parseInvoiceNumber("INV-2026-0010")).toBeNull();
  });

  it("continues the year's sequence from the highest number used", () => {
    expect(nextInvoiceNumber(["WC-2026-0001", "WC-2026-0010", "WC-2026-0002"], 2026)).toBe("WC-2026-0011");
  });

  it("restarts the sequence each year", () => {
    expect(nextInvoiceNumber(["WC-2026-0010", "WC-2025-0042"], 2027)).toBe("WC-2027-0001");
    expect(nextInvoiceNumber([], 2026)).toBe("WC-2026-0001");
  });

  it("ignores numbers that don't follow the pattern", () => {
    expect(nextInvoiceNumber(["WC-2026-abc", "manual-1"], 2026)).toBe("WC-2026-0001");
  });
});

describe("default funding source", () => {
  it("follows ARCHITECTURE §6", () => {
    expect(defaultFundingSource({ type: "REGISTERED", departmentId: "d1" })).toBe("WSUSA");
    expect(defaultFundingSource({ type: "SPONSORED", departmentId: "d1" })).toBe("DEPARTMENT");
    expect(defaultFundingSource({ type: "AFFILIATE", departmentId: null })).toBe("WSUSA");
    expect(defaultFundingSource({ type: "COLLEGE_AMBASSADORS", departmentId: null })).toBe("COLLEGE");
    expect(defaultFundingSource(null)).toBe("UNIVERSITY");
  });
});

describe("request timeline", () => {
  const base = { createdAt: new Date("2026-09-01"), submittedAt: new Date("2026-09-03"), decidedAt: new Date("2026-09-10"), invoice: null };

  it("shows a draft waiting to be submitted", () => {
    const steps = requestTimeline({ ...base, status: "DRAFT", submittedAt: null, decidedAt: null });
    expect(steps.map((s) => s.state)).toEqual(["done", "current", "upcoming", "upcoming", "upcoming"]);
  });

  it("stops at a denial or a withdrawal", () => {
    expect(requestTimeline({ ...base, status: "DENIED" }).at(-1)).toMatchObject({ key: "decision", tone: "danger" });
    expect(requestTimeline({ ...base, status: "WITHDRAWN" })).toHaveLength(3);
  });

  it("follows an approval through its invoice", () => {
    const open = requestTimeline({ ...base, status: "APPROVED", invoice: { number: "WC-2026-0011", status: "OPEN", createdAt: new Date("2026-09-11"), processedAt: null } });
    expect(open.at(-1)).toMatchObject({ key: "processed", state: "current" });
    const done = requestTimeline({ ...base, status: "PARTIALLY_APPROVED", invoice: { number: "WC-2026-0011", status: "PROCESSED", createdAt: new Date("2026-09-11"), processedAt: new Date("2026-09-15") } });
    expect(done.every((s) => s.state === "done")).toBe(true);
  });
});
