import { describe, expect, it } from "vitest";
import { awaitingGrade, requirementState, type AttemptLike } from "./requirement-rules";

const due = new Date("2026-10-21T18:00:00Z");
const before = new Date("2026-10-20T18:00:00Z");
const after = new Date("2026-10-22T18:00:00Z");
const waiting = (submittedAt: Date | null): AttemptLike => ({ status: "NEEDS_REVIEW", submittedAt });

describe("awaitingGrade", () => {
  it("counts an attempt handed in by the deadline that waits for a grader", () => {
    expect(awaitingGrade([waiting(before)], due)).toBe(true);
    expect(awaitingGrade([waiting(due)], due)).toBe(true);
  });

  it("doesn't count one handed in late, one still in progress or one already graded", () => {
    expect(awaitingGrade([waiting(after)], due)).toBe(false);
    expect(awaitingGrade([{ status: "IN_PROGRESS", submittedAt: null }], due)).toBe(false);
    expect(awaitingGrade([{ status: "GRADED", submittedAt: before }], due)).toBe(false);
    expect(awaitingGrade([], due)).toBe(false);
  });

  it("counts any attempt waiting for a grader when there's no deadline", () => {
    expect(awaitingGrade([waiting(after)], null)).toBe(true);
    expect(awaitingGrade([waiting(null)], null)).toBe(false);
  });
});

describe("requirementState", () => {
  it("is met once it's met, whatever the date", () => {
    expect(requirementState({ met: true, awaitingGrade: false, dueAt: due, at: after })).toBe("met");
  });

  it("is due until the deadline and overdue after it", () => {
    expect(requirementState({ met: false, awaitingGrade: false, dueAt: due, at: before })).toBe("due");
    expect(requirementState({ met: false, awaitingGrade: false, dueAt: due, at: due })).toBe("due");
    expect(requirementState({ met: false, awaitingGrade: false, dueAt: due, at: after })).toBe("overdue");
  });

  it("never pauses anyone while an on-time attempt waits for grading, even past the deadline", () => {
    const on = awaitingGrade([waiting(before)], due);
    expect(requirementState({ met: false, awaitingGrade: on, dueAt: due, at: before })).toBe("review");
    expect(requirementState({ met: false, awaitingGrade: on, dueAt: due, at: after })).toBe("review");
  });

  it("goes back to the normal rule, on the same clock, once grading fails it", () => {
    const failed: AttemptLike[] = [{ status: "GRADED", submittedAt: before }];
    expect(requirementState({ met: false, awaitingGrade: awaitingGrade(failed, due), dueAt: due, at: before })).toBe("due");
    expect(requirementState({ met: false, awaitingGrade: awaitingGrade(failed, due), dueAt: due, at: after })).toBe("overdue");
  });

  it("is overdue past the deadline when the attempt was handed in late", () => {
    expect(requirementState({ met: false, awaitingGrade: awaitingGrade([waiting(after)], due), dueAt: due, at: after })).toBe("overdue");
  });
});
