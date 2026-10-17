"use client";

import { CheckCircle2, FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/layout";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useRunAction } from "@/components/roles/useRunAction";
import { fmtMoney } from "@/lib/time";
import { createInvoiceAction, markInvoiceProcessedAction } from "@/app/admin/funding/actions";

/** Creates the request's invoice (next WC-<year>-#### number) and the admins' follow-up task. */
export function CreateInvoiceButton({ requestId, amountCents, clubName }: { requestId: string; amountCents: number; clubName: string }) {
  const { pending, error, run } = useRunAction();
  return (
    <div className="space-y-3">
      <ConfirmDialog
        trigger={
          <Button disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FilePlus2 className="h-4 w-4" aria-hidden />} Create invoice for {fmtMoney(amountCents)}
          </Button>
        }
        title={`Create the invoice for ${clubName}?`}
        description={`It's numbered automatically and adds a task for WSUSA admins to make sure the ${fmtMoney(amountCents)} goes through in the university finance system within 10 days. The club can download it right away.`}
        confirmLabel="Create invoice"
        onConfirm={() => {
          void run(() => createInvoiceAction(requestId), { success: "Invoice created. Its follow-up task is in the admin inbox." });
        }}
      />
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </div>
  );
}

/** The transfer showed up in the university finance system: close the invoice and its task. */
export function MarkProcessedButton({ invoiceId, number, amountCents }: { invoiceId: string; number: string; amountCents: number }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Mark processed
        </Button>
      }
      title={`Mark ${number} processed?`}
      description={`Do this once the ${fmtMoney(amountCents)} shows up in the university finance system. The invoice task closes and the club is told their funding went through.`}
      confirmLabel="Mark processed"
      onConfirm={() => {
        void run(() => markInvoiceProcessedAction(invoiceId), { success: `${number} marked processed.`, toastError: true });
      }}
    />
  );
}
