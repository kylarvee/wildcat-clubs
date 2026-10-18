"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import {
  archiveTest,
  createTest,
  deleteTest,
  duplicateTest,
  finalizeGrading,
  publishTest,
  requestGradingSuggestion,
  saveTest,
  searchTestPeople,
} from "@/lib/domain/tests";

/**
 * Server actions for the Test Tool builder and grading screens. They live
 * next to the shared components (like components/reviews/actions.ts) because
 * the same builder runs at /admin/tests and /clubs/[slug]/manage/tests.
 */

function refresh() {
  revalidatePath("/admin/tests", "layout");
  revalidatePath("/clubs/[slug]/manage/tests", "layout");
  revalidatePath("/tests", "layout");
  revalidatePath("/tasks");
}

export async function createTestAction(clubId: string | null, title: string, isForm = false) {
  const r = await act((actor) => createTest(actor, { clubId, title, isForm }));
  if (r.ok) refresh();
  return r;
}

export async function saveTestAction(testId: string, payload: unknown) {
  const r = await act((actor) => saveTest(actor, testId, payload));
  if (r.ok) refresh();
  return r;
}

export async function publishTestAction(testId: string) {
  const r = await act((actor) => publishTest(actor, testId));
  if (r.ok) refresh();
  return r;
}

export async function archiveTestAction(testId: string) {
  const r = await act((actor) => archiveTest(actor, testId));
  if (r.ok) refresh();
  return r;
}

export async function duplicateTestAction(testId: string) {
  const r = await act((actor) => duplicateTest(actor, testId));
  if (r.ok) refresh();
  return r;
}

export async function deleteTestAction(testId: string) {
  const r = await act((actor) => deleteTest(actor, testId));
  if (r.ok) refresh();
  return r;
}

export async function searchTestPeopleAction(clubId: string | null, q: string) {
  return act((actor) => searchTestPeople(actor, { clubId, q }));
}

export async function suggestGradeAction(answerId: string) {
  const r = await act((actor) => requestGradingSuggestion(actor, answerId));
  if (r.ok) refresh();
  return r;
}

export async function finalizeGradingAction(attemptId: string, grades: { questionId: string; points: number; comment?: string }[]) {
  const r = await act((actor) => finalizeGrading(actor, attemptId, { grades }));
  if (r.ok) {
    refresh();
    // A pass can lift a paused officer's permissions, which every workspace page reads.
    revalidatePath("/clubs/[slug]/manage", "layout");
  }
  return r;
}
