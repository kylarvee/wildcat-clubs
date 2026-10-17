"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as funding from "@/lib/domain/funding";
import type { FundingRequestInput, GeneralCostInput } from "@/lib/domain/funding";

/** Budget tool server actions. Every write goes through lib/domain/funding. */

function refresh() {
  revalidatePath("/clubs/[slug]/manage", "layout");
  revalidatePath("/admin/funding", "layout");
}

export async function addCostAction(input: GeneralCostInput) {
  const r = await act(async (actor) => {
    const item = await funding.addBudgetItem(actor, input);
    return { id: item.id };
  });
  if (r.ok) refresh();
  return r;
}

export async function updateCostAction(itemId: string, input: Omit<GeneralCostInput, "clubId">) {
  const r = await act(async (actor) => {
    const item = await funding.updateBudgetItem(actor, itemId, input);
    return { id: item.id };
  });
  if (r.ok) refresh();
  return r;
}

export async function removeCostAction(itemId: string) {
  const r = await act((actor) => funding.removeBudgetItem(actor, itemId));
  if (r.ok) refresh();
  return r;
}

type RequestFields = Omit<FundingRequestInput, "clubId" | "termId">;

/**
 * Saves a request: creates the draft when there's no id yet, otherwise edits
 * it. With submit, the saved draft is then sent for review in the same step.
 */
export async function saveRequestAction(input: { requestId?: string | null; clubId: string; termId: string; submit?: boolean } & RequestFields) {
  const { requestId, clubId, termId, submit, ...fields } = input;
  const saved = await act(async (actor) => (requestId ? funding.updateFundingRequest(actor, requestId, fields) : funding.createFundingRequest(actor, { clubId, termId, ...fields })));
  if (!saved.ok) return { ...saved, savedId: null as string | null };
  refresh();
  if (!submit) return { ok: true as const, data: { id: saved.data.id, submitted: false }, savedId: saved.data.id };
  const sent = await act((actor) => funding.submitFundingRequest(actor, saved.data.id));
  if (sent.ok) refresh();
  // The draft is saved either way; the form uses savedId to stay on it when submitting fails.
  return sent.ok ? { ok: true as const, data: { id: saved.data.id, submitted: true }, savedId: saved.data.id } : { ...sent, savedId: saved.data.id };
}

export async function submitRequestAction(requestId: string) {
  const r = await act((actor) => funding.submitFundingRequest(actor, requestId));
  if (r.ok) refresh();
  return r;
}

export async function withdrawRequestAction(requestId: string, reason?: string) {
  const r = await act((actor) => funding.withdrawFundingRequest(actor, requestId, { reason }));
  if (r.ok) refresh();
  return r;
}

export async function discardDraftAction(requestId: string) {
  const r = await act((actor) => funding.discardFundingDraft(actor, requestId));
  if (r.ok) refresh();
  return r;
}
