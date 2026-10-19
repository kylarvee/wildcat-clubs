import type { ReactNode } from "react";
import type { InvoiceStatus } from "@prisma/client";
import { ChevronDown, Download, ExternalLink, FileText } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InvoiceBadge } from "@/components/budget/StatusBadge";
import { fmtLongDate, fmtMoney } from "@/lib/time";

export type InvoiceSummary = { id: string; number: string; amountCents: number; status: InvoiceStatus; createdAt: Date; processedAt: Date | null; createdBy?: { name: string } | null };

export const invoicePdfUrl = (id: string, download = false) => `/api/invoices/${encodeURIComponent(id)}/pdf${download ? "?download=1" : ""}`;

/**
 * One invoice: number, amount, where it stands, and the PDF (preview inline,
 * open in a tab, or download). Admin pages pass their buttons as children,
 * and the open invoice's due date (its task's) to show whether it's late.
 */
export function InvoicePanel({ invoice, children, defaultOpen, dueAt, now = new Date() }: { invoice: InvoiceSummary; children?: ReactNode; defaultOpen?: boolean; dueAt?: Date | null; now?: Date }) {
  const late = invoice.status === "OPEN" && dueAt ? dueAt < now : false;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand" aria-hidden>
          <FileText className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Invoice {invoice.number}</p>
          <p className="text-sm text-ink-3">
            {fmtMoney(invoice.amountCents)} · created {fmtLongDate(invoice.createdAt)}
            {invoice.createdBy ? ` by ${invoice.createdBy.name}` : ""}
            {invoice.processedAt ? ` · processed ${fmtLongDate(invoice.processedAt)}` : ""}
            {invoice.status === "OPEN" && dueAt ? ` · ${late ? "was due" : "due"} ${fmtLongDate(dueAt)} in the finance system` : ""}
          </p>
        </div>
        <span className="flex flex-wrap gap-1.5">
          {late ? <Badge tone="danger">Past due</Badge> : null}
          <InvoiceBadge status={invoice.status} />
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={invoicePdfUrl(invoice.id, true)} className={buttonClasses("outline", "sm")} download>
          <Download className="h-4 w-4" aria-hidden /> Download PDF
        </a>
        <a href={invoicePdfUrl(invoice.id)} target="_blank" rel="noopener" className={buttonClasses("ghost", "sm")}>
          <ExternalLink className="h-4 w-4" aria-hidden /> Open in a new tab
        </a>
        {children}
      </div>
      <details className="group rounded-xl border border-line bg-surface" open={defaultOpen}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
          Preview invoice
          <ChevronDown className="h-4 w-4 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <iframe src={invoicePdfUrl(invoice.id)} title={`Invoice ${invoice.number} (PDF)`} className="block w-full border-0 border-t border-line bg-muted" style={{ height: "min(720px, 75vh)" }} loading="lazy" />
      </details>
    </div>
  );
}
