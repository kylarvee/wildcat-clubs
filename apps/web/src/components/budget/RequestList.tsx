import Link from "next/link";
import type { FundingSource, FundingStatus, InvoiceStatus } from "@prisma/client";
import { ChevronRight } from "lucide-react";
import { FundingStatusBadge, InvoiceBadge } from "@/components/budget/StatusBadge";
import { fmtLongDate, fmtMoney } from "@/lib/time";
import { plural } from "@/lib/funding/labels";

export type RequestListItem = {
  id: string;
  title: string;
  status: FundingStatus;
  /** The source the club expects. */
  fundingSource: FundingSource;
  /** The source that funded it (approvals). */
  fundedSource: FundingSource | null;
  amountRequestedCents: number;
  amountApprovedCents: number | null;
  createdAt: Date;
  submittedAt: Date | null;
  decidedAt: Date | null;
  term?: { name: string } | null;
  invoices: { number: string; status: InvoiceStatus }[];
  /** Drafts: what the picked lines add up to now. */
  liveCents?: number;
  staleLines?: number;
};

function when(r: RequestListItem) {
  if (r.status === "DRAFT") return `Started ${fmtLongDate(r.createdAt)}`;
  if (r.decidedAt && r.status !== "SUBMITTED") return `${r.status === "WITHDRAWN" ? "Withdrawn" : "Decided"} ${fmtLongDate(r.decidedAt)}`;
  return r.submittedAt ? `Submitted ${fmtLongDate(r.submittedAt)}` : "";
}

/** A club's funding requests as tappable rows. */
export function RequestList({ requests, base, sourceNames, showTerm }: { requests: RequestListItem[]; base: string; sourceNames: Record<FundingSource, string>; showTerm?: boolean }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      {requests.map((r) => {
        const asked = r.status === "DRAFT" ? (r.liveCents ?? r.amountRequestedCents) : r.amountRequestedCents;
        const invoice = r.invoices[0];
        return (
          <li key={r.id}>
            <Link
              href={`${base}/requests/${r.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{r.title}</span>
                  <FundingStatusBadge status={r.status} />
                  {invoice ? <InvoiceBadge status={invoice.status} /> : null}
                </div>
                <p className="mt-0.5 text-sm text-ink-3">
                  {showTerm && r.term ? `${r.term.name} · ` : ""}
                  {r.status === "APPROVED" || r.status === "PARTIALLY_APPROVED" ? `Funded by ${sourceNames[r.fundedSource ?? r.fundingSource]}` : `Expects ${sourceNames[r.fundingSource]}`} · {when(r)}
                </p>
                {r.staleLines ? <p className="mt-0.5 text-xs text-warning">{plural(r.staleLines, "line")} removed from the budget since this draft was saved</p> : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold tabular-nums text-ink">{fmtMoney(r.amountApprovedCents ?? asked)}</p>
                <p className="text-xs text-ink-3">
                  {r.amountApprovedCents != null ? (r.amountApprovedCents === asked ? "approved" : `approved of ${fmtMoney(asked)}`) : r.status === "DRAFT" ? "so far" : "requested"}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
