import type { FundingStatus, InvoiceStatus } from "@prisma/client";
import { CheckCircle2, Clock, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FUNDING_STATUS_LABEL, FUNDING_STATUS_TONE, INVOICE_STATUS_LABEL } from "@/lib/funding/labels";

/** A funding request's status, in words (never color alone). */
export function FundingStatusBadge({ status, className }: { status: FundingStatus; className?: string }) {
  return (
    <Badge tone={FUNDING_STATUS_TONE[status]} className={className}>
      {FUNDING_STATUS_LABEL[status]}
    </Badge>
  );
}

export function InvoiceBadge({ number, status, className }: { number?: string; status: InvoiceStatus; className?: string }) {
  const Icon = status === "PROCESSED" ? CheckCircle2 : Clock;
  return (
    <Badge tone={status === "PROCESSED" ? "success" : "info"} className={className}>
      {number ? <FileText className="h-3 w-3" aria-hidden /> : <Icon className="h-3 w-3" aria-hidden />}
      {number ? `${number} · ${INVOICE_STATUS_LABEL[status].toLowerCase()}` : `Invoice ${INVOICE_STATUS_LABEL[status].toLowerCase()}`}
    </Badge>
  );
}
