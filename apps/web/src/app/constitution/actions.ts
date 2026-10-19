"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as constitution from "@/lib/domain/constitution";
import type { DraftData } from "@/lib/constitution/templates";

export async function createDraftAction(input: { title?: string; clubId?: string | null; fromDraftId?: string | null; fromCurrent?: boolean | null }) {
  const r = await act(async (actor) => {
    const d = await constitution.createDraft(actor, input);
    return { id: d.id };
  });
  if (r.ok) revalidatePath("/constitution");
  return r;
}

export async function saveDraftAction(input: { draftId: string; title: string; data: DraftData }) {
  const r = await act(async (actor) => {
    const s = await constitution.saveDraft(actor, input);
    return { savedAt: s.updatedAt.toISOString() };
  });
  return r;
}

export async function deleteDraftAction(draftId: string) {
  const r = await act((actor) => constitution.deleteDraft(actor, draftId));
  if (r.ok) revalidatePath("/constitution");
  return r;
}

export async function adoptDraftAction(input: { draftId: string; clubIds: string[] }) {
  const r = await act((actor) => constitution.adoptDraft(actor, input));
  if (r.ok) {
    revalidatePath("/clubs/[slug]/manage", "layout");
    revalidatePath("/clubs/[slug]", "page");
    revalidatePath("/constitution", "layout");
  }
  return r;
}
