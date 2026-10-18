import type { AttemptStatus } from "@prisma/client";

/**
 * The pure part of the requirement rule (lib/authz/requirements), shared with
 * the task list, admin compliance and the seed checks. Client-safe.
 *
 * A requirement test someone handed in by its deadline that's waiting for a
 * grader (NEEDS_REVIEW) isn't overdue, so nobody's permissions pause over a
 * grader's delay. It isn't met either: it's met once it's graded as passed.
 * If it's graded as not passed, the normal rule applies again on the same
 * clock (so past the deadline it's overdue). tests.markMissedAssignments
 * treats a test assignment the same way.
 */

export type RequirementState = "met" | "review" | "due" | "overdue";

/** How tasks and admin compliance word the "review" state. */
export const AWAITING_GRADE_LABEL = "Submitted — waiting for grading";

export type AttemptLike = { status: AttemptStatus; submittedAt: Date | null };

/** True when one of these attempts was handed in by `dueAt` and is waiting for a grader. No deadline: any one waiting counts. */
export function awaitingGrade(attempts: readonly AttemptLike[], dueAt: Date | null): boolean {
  return attempts.some((a) => a.status === "NEEDS_REVIEW" && a.submittedAt !== null && (dueAt === null || a.submittedAt.getTime() <= dueAt.getTime()));
}

/** Where one requirement stands for one person at `at`. Only "overdue" pauses a leader's permissions. */
export function requirementState(v: { met: boolean; awaitingGrade: boolean; dueAt: Date; at: Date }): RequirementState {
  if (v.met) return "met";
  if (v.awaitingGrade) return "review";
  return v.at.getTime() > v.dueAt.getTime() ? "overdue" : "due";
}
