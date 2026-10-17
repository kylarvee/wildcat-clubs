import Link from "next/link";
import type { FundingSource, FundingStatus, InvoiceStatus } from "@prisma/client";
import { ChevronRight, Clock } from "lucide-react";
import { ClubLogo } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { FundingStatusBadge, InvoiceBadge } from "@/components/budget/StatusBadge";
import { DAY_MS, fmtLongDate, fmtMoney } from "@/lib/time";
import { plural, sourceName, type SourceContext } from "@/lib/funding/labels";

export type AdminRequestRow = {
  id: string;
  title: string;
  status: FundingStatus;
  fundingSource: FundingSource;
  amountRequestedCents: number;
  amountApprovedCents: number | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  club: SourceContext & { id: string; name: string; logoUrl: string | null; logoColor: string };
  term: { name: string };
  invoices: { id: string; number: string; status: InvoiceStatus }[];
  _count: { items: number };
};

function waitingDays(at: Date | null, now: number) {
  return at ? Math.max(0, Math.floor((now - at.getTime()) / DAY_MS)) : 0;
}

/**
 * The admin funding queue as rows that wrap on small screens. Waiting time
 * turns amber once a request has waited longer than WSUSA's usual review time.
 */
export function AdminRequestList({ rows, reviewDays, now = Date.now() }: { rows: AdminRequestRow[]; reviewDays: number; now?: number }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      {rows.map((r) => {
        const invoice = r.invoices[0];
        const days = r.status === "SUBMITTED" ? waitingDays(r.submittedAt, now) : 0;
        const decided = r.amountApprovedCents != null;
        return (
          <li key={r.id}>
            <Link
              href={`/admin/funding/${r.id}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:items-center"
            >
              <ClubLogo name={r.club.name} src={r.club.logoUrl} color={r.club.logoColor} size="sm" className="mt-0.5 sm:mt-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-ink-2">{r.club.name}</p>
                <p className="font-medium text-ink">{r.title}</p>
                <p className="mt-0.5 text-sm text-ink-3">
                  {r.term.name} · {sourceName(r.fundingSource, r.club)} · {plural(r._count.items, "line")}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <FundingStatusBadge status={r.status} />
                  {invoice ? <InvoiceBadge number={invoice.number} status={invoice.status} /> : r.status === "APPROVED" || r.status === "PARTIALLY_APPROVED" ? <span className="text-xs font-medium text-warning">Needs an invoice</span> : null}
                  {r.status === "SUBMITTED" ? (
                    <span className={cn("inline-flex items-center gap-1 text-xs", days > reviewDays ? "font-medium text-warning" : "text-ink-3")}>
                      <Clock className="h-3 w-3" aria-hidden />
                      {days === 0 ? "Submitted today" : `Waiting ${plural(days, "day")}`}
                    </span>
                  ) : r.decidedAt ? (
                    <span className="text-xs text-ink-3">
                      {r.status === "WITHDRAWN" ? "Withdrawn" : "Decided"} {fmtLongDate(r.decidedAt)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold tabular-nums text-ink">{fmtMoney(decided ? r.amountApprovedCents! : r.amountRequestedCents)}</p>
                <p className="text-xs text-ink-3">{decided ? (r.amountApprovedCents === r.amountRequestedCents ? "approved" : `of ${fmtMoney(r.amountRequestedCents)}`) : "requested"}</p>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink-3 sm:mt-0" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
