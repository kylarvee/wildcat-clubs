"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { deleteReview, flagReview, writeReview } from "@/lib/domain/reviews";

/** Server actions for <ClubReviews/>. Ratings also show on the clubs list, so both refresh. */

function refresh() {
  revalidatePath("/clubs");
  revalidatePath("/clubs/[slug]", "page");
}

export async function saveReviewAction(clubId: string, input: { rating: number; body?: string | null }) {
  const result = await act((actor) => writeReview(actor, clubId, input));
  if (result.ok) refresh();
  return result;
}

export async function deleteReviewAction(reviewId: string) {
  const result = await act((actor) => deleteReview(actor, reviewId));
  if (result.ok) refresh();
  return result;
}

export async function flagReviewAction(reviewId: string, reason: string) {
  const result = await act((actor) => flagReview(actor, reviewId, { reason }));
  if (result.ok) revalidatePath("/clubs/[slug]", "page");
  return result;
}
