import type { FundingStatus, InvoiceStatus } from "@prisma/client";

/**
 * A funding request's life as steps: drafted → submitted → decided → invoiced
 * → processed. Pure, so the club's and the admin's views read the same story.
 */

export type TimelineState = "done" | "current" | "upcoming";
export type TimelineTone = "neutral" | "success" | "warning" | "danger";

export type TimelineStep = {
  key: "draft" | "submitted" | "decision" | "invoice" | "processed";
  label: string;
  state: TimelineState;
  tone: TimelineTone;
  at: Date | null;
  by?: string | null;
  detail?: string | null;
};

export type TimelineInput = {
  status: FundingStatus;
  createdAt: Date;
  submittedAt: Date | null;
  submittedBy?: string | null;
  decidedAt: Date | null;
  decidedBy?: string | null;
  invoice: { number: string; status: InvoiceStatus; createdAt: Date; processedAt: Date | null } | null;
};

export function requestTimeline(r: TimelineInput): TimelineStep[] {
  const steps: TimelineStep[] = [{ key: "draft", label: "Draft started", state: "done", tone: "neutral", at: r.createdAt }];

  steps.push(
    r.submittedAt
      ? { key: "submitted", label: "Submitted for review", state: "done", tone: "neutral", at: r.submittedAt, by: r.submittedBy }
      : { key: "submitted", label: "Submit for review", state: "current", tone: "neutral", at: null, detail: "Still a draft — WSUSA can't see it yet." },
  );

  switch (r.status) {
    case "DRAFT":
      steps.push({ key: "decision", label: "WSUSA decides", state: "upcoming", tone: "neutral", at: null });
      break;
    case "SUBMITTED":
      steps.push({ key: "decision", label: "Waiting for a decision", state: "current", tone: "neutral", at: null, detail: "WSUSA staff are reviewing it." });
      break;
    case "APPROVED":
      steps.push({ key: "decision", label: "Approved", state: "done", tone: "success", at: r.decidedAt, by: r.decidedBy });
      break;
    case "PARTIALLY_APPROVED":
      steps.push({ key: "decision", label: "Partly approved", state: "done", tone: "warning", at: r.decidedAt, by: r.decidedBy });
      break;
    case "DENIED":
      steps.push({ key: "decision", label: "Not approved", state: "done", tone: "danger", at: r.decidedAt, by: r.decidedBy });
      return steps;
    case "WITHDRAWN":
      steps.push({ key: "decision", label: "Withdrawn by the club", state: "done", tone: "neutral", at: r.decidedAt });
      return steps;
  }

  const approved = r.status === "APPROVED" || r.status === "PARTIALLY_APPROVED";
  if (r.invoice) {
    steps.push({ key: "invoice", label: `Invoice ${r.invoice.number} created`, state: "done", tone: "neutral", at: r.invoice.createdAt });
    steps.push(
      r.invoice.status === "PROCESSED"
        ? { key: "processed", label: "Funding went through", state: "done", tone: "success", at: r.invoice.processedAt, detail: "Processed in the university finance system." }
        : { key: "processed", label: "Processing in the finance system", state: "current", tone: "neutral", at: null, detail: "WSUSA is moving the money through the university finance system." },
    );
  } else {
    steps.push({ key: "invoice", label: approved ? "Invoice being prepared" : "Invoice", state: approved ? "current" : "upcoming", tone: "neutral", at: null });
    steps.push({ key: "processed", label: "Funding goes through", state: "upcoming", tone: "neutral", at: null });
  }
  return steps;
}
