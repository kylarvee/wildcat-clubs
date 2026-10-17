"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { closeReviewBombingCheck, hideReview, keepReportedReview, restoreReview } from "@/lib/domain/reviews";

/** Moderation changes what everyone sees on club pages and the clubs list. */
function refresh() {
  revalidatePath("/admin/reviews");
  revalidatePath("/clubs");
  revalidatePath("/clubs/[slug]", "page");
}

export async function hideReviewAction(reviewId: string, reason: string) {
  const r = await act((actor) => hideReview(actor, reviewId, { reason }));
  if (r.ok) refresh();
  return r;
}

export async function restoreReviewAction(reviewId: string) {
  const r = await act((actor) => restoreReview(actor, reviewId));
  if (r.ok) refresh();
  return r;
}

export async function keepReviewAction(reviewId: string) {
  const r = await act((actor) => keepReportedReview(actor, reviewId));
  if (r.ok) refresh();
  return r;
}

export async function closeBombingCheckAction(clubId: string) {
  const r = await act((actor) => closeReviewBombingCheck(actor, clubId));
  if (r.ok) refresh();
  return r;
}
