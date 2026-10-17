import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoicePdfData } from "@/lib/funding/invoice-pdf";

const base: InvoicePdfData = {
  number: "WC-2026-0011",
  amountCents: 42000,
  status: "OPEN",
  createdAt: new Date("2026-10-14T17:00:00Z"),
  processedAt: null,
  createdBy: { name: "Dana Whitaker" },
  request: {
    id: "req_123",
    title: "Fall speaker series",
    justification: "Three evening talks with Wasatch Front finance professionals — we expect 35–50 students at each.\nRefreshments keep people after class.",
    status: "PARTIALLY_APPROVED",
    fundingSource: "DEPARTMENT",
    amountRequestedCents: 61000,
    amountApprovedCents: 42000,
    submittedAt: new Date("2026-10-01T18:00:00Z"),
    decidedAt: new Date("2026-10-10T18:00:00Z"),
    decisionNote: "Covers the speakers and snacks; the banner should come from WSUSA's printing allowance.",
    submittedBy: { name: "Maya Ortiz" },
    decidedBy: { name: "Dana Whitaker" },
    term: { name: "Fall 2026" },
    items: [
      { id: "i1", description: "Pizza and drinks", eventTitle: "Finance Speaker Night", quantity: 1, unitCostCents: 8500, occurrences: 3, totalCents: 25500 },
      { id: "i2", description: "Speaker gift cards", eventTitle: "Finance Speaker Night", quantity: 3, unitCostCents: 5000, occurrences: 1, totalCents: 15000 },
      { id: "i3", description: "Vinyl banner 3×6 ft", eventTitle: null, quantity: 1, unitCostCents: 20500, occurrences: 1, totalCents: 20500 },
    ],
    club: { name: "Finance & Investment Club 💸", type: "SPONSORED", contactEmail: "finance.club@weber.edu", department: { name: "Department of Finance" }, college: { name: "Goddard School of Business & Economics" } },
  },
};

describe("invoice PDF", () => {
  it("renders a partial approval", async () => {
    const pdf = await renderInvoicePdf(base);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
    if (process.env.PDF_OUT) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${process.env.PDF_OUT}/invoice-partial.pdf`, pdf);
    }
  }, 30000);

  it("renders a long, processed invoice across pages", async () => {
    const items = Array.from({ length: 45 }, (_, n) => ({ id: `l${n}`, description: `Supplies batch ${n + 1}`, eventTitle: n % 2 ? "Open Build Night" : null, quantity: 2, unitCostCents: 1250, occurrences: n % 2 ? 12 : 1, totalCents: n % 2 ? 30000 : 2500 }));
    const total = items.reduce((s, i) => s + i.totalCents, 0);
    const pdf = await renderInvoicePdf({
      ...base,
      status: "PROCESSED",
      processedAt: new Date("2026-10-15T20:00:00Z"),
      amountCents: total,
      request: { ...base.request, status: "APPROVED", amountRequestedCents: total, amountApprovedCents: total, decisionNote: null, items },
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    if (process.env.PDF_OUT) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${process.env.PDF_OUT}/invoice-long.pdf`, pdf);
    }
  }, 30000);
});
