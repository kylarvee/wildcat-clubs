"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useRunAction } from "@/components/roles/useRunAction";
import { fmtMoney } from "@/lib/time";
import { markInvoiceProcessedAction } from "@/app/admin/funding/actions";

/** The transfer showed up in the university finance system: close the invoice and its task. (Approving a request creates its invoice.) */
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
