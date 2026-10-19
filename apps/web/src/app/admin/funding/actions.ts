"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as funding from "@/lib/domain/funding";
import type { FundingDecisionInput } from "@/lib/domain/funding";

/** Admin funding actions: decisions (an approval creates its invoice) and processing invoices (admin.funding, checked in the domain). */

function refresh() {
  revalidatePath("/admin/funding", "layout");
  revalidatePath("/clubs/[slug]/manage", "layout");
}

export async function decideFundingAction(input: FundingDecisionInput) {
  const r = await act((actor) => funding.decideFundingRequest(actor, input));
  if (r.ok) refresh();
  return r;
}


export async function markInvoiceProcessedAction(invoiceId: string) {
  const r = await act((actor) => funding.markInvoiceProcessed(actor, invoiceId));
  if (r.ok) refresh();
  return r;
}
