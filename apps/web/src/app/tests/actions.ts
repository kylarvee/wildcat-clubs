"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { prefillGradingSuggestions, saveAnswer, startAttempt, submitAttempt } from "@/lib/domain/tests";

/** Taking a test: start (the server sets the clock), autosave answers, hand in. */

export async function startAttemptAction(testId: string) {
  const r = await act((actor) => startAttempt(actor, testId));
  if (r.ok) revalidatePath(`/tests/${testId}`);
  return r;
}

/** Autosave one answer. Not revalidated: it runs every few seconds while someone types. */
export async function saveAnswerAction(attemptId: string, input: { questionId: string; selectedOptionIds?: string[]; text?: string | null }) {
  return act((actor) => saveAnswer(actor, attemptId, input));
}

export async function submitAttemptAction(attemptId: string, opts: { auto?: boolean } = {}) {
  const r = await act((actor) => submitAttempt(actor, attemptId, { auto: Boolean(opts.auto) }));
  if (r.ok) {
    // Claude's suggestions (when grading assist is on) are ready before a reviewer opens the attempt.
    if (r.data.needsReview) after(() => prefillGradingSuggestions(attemptId));
    revalidatePath("/tests", "layout");
    revalidatePath("/admin/tests", "layout");
    revalidatePath("/clubs/[slug]/manage", "layout");
    revalidatePath("/tasks");
  }
  return r;
}
