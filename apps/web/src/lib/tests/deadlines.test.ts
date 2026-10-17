import { describe, expect, it } from "vitest";
import { ANSWER_GRACE_MS, acceptsAnswers, assignmentDueAt, attemptDeadline, describeClock, durationLabel, formatClock, isAbandoned, minutesLabel, timerState } from "@/lib/tests/deadlines";

const t0 = new Date("2026-10-16T16:00:00Z");
const min = (n: number) => new Date(t0.getTime() + n * 60_000);
const DAY = 86_400_000;

describe("attempt deadlines", () => {
  it("adds the time limit", () => {
    expect(attemptDeadline(t0, 30, null)).toEqual(min(30));
  });
  it("never runs past a one-off test's closing time", () => {
    expect(attemptDeadline(t0, 30, min(10))).toEqual(min(10));
    expect(attemptDeadline(t0, 30, min(90))).toEqual(min(30));
    expect(attemptDeadline(t0, null, min(90))).toEqual(min(90));
  });
  it("is open-ended without a limit or closing time", () => {
    expect(attemptDeadline(t0, null, null)).toBeNull();
  });
  it("accepts answers until the deadline plus a little grace", () => {
    const deadline = min(30);
    expect(acceptsAnswers(min(29), deadline)).toBe(true);
    expect(acceptsAnswers(new Date(deadline.getTime() + ANSWER_GRACE_MS), deadline)).toBe(true);
    expect(acceptsAnswers(new Date(deadline.getTime() + ANSWER_GRACE_MS + 1), deadline)).toBe(false);
    expect(acceptsAnswers(min(100_000), null)).toBe(true);
  });
  it("knows when the job should submit an abandoned attempt", () => {
    expect(isAbandoned(min(31), min(30))).toBe(true);
    expect(isAbandoned(min(30), min(30))).toBe(false);
    expect(isAbandoned(min(10_000), null)).toBe(false);
  });
});

describe("assignment due dates", () => {
  it("uses a one-off test's closing time", () => {
    expect(assignmentDueAt({ assignedAt: t0, dueDays: 30, closesAt: min(60), cycle: { end: null }, oneOff: true })).toEqual(min(60));
  });
  it("counts due days from assignment", () => {
    expect(assignmentDueAt({ assignedAt: t0, dueDays: 14, closesAt: null, cycle: { end: null }, oneOff: true }).getTime()).toBe(t0.getTime() + 14 * DAY);
  });
  it("caps at the end of the cycle", () => {
    const weekEnd = new Date(t0.getTime() + 3 * DAY);
    expect(assignmentDueAt({ assignedAt: t0, dueDays: 30, closesAt: null, cycle: { end: weekEnd }, oneOff: false })).toEqual(weekEnd);
  });
  it("ignores a cycle end that already passed", () => {
    const past = new Date(t0.getTime() - DAY);
    expect(assignmentDueAt({ assignedAt: t0, dueDays: 7, closesAt: null, cycle: { end: past }, oneOff: false }).getTime()).toBe(t0.getTime() + 7 * DAY);
  });
});

describe("the clock", () => {
  it("counts down with a limit and warns at 5 and 1 minutes", () => {
    const start = t0.getTime();
    const deadline = min(30).getTime();
    expect(timerState(start, start, deadline)).toMatchObject({ mode: "down", ms: 30 * 60_000, warning: null, expired: false });
    expect(timerState(min(25).getTime(), start, deadline).warning).toBe("five");
    expect(timerState(min(29.5).getTime(), start, deadline).warning).toBe("one");
    expect(timerState(min(31).getTime(), start, deadline)).toMatchObject({ ms: 0, expired: true, warning: null });
  });
  it("counts up without a limit", () => {
    expect(timerState(min(12).getTime(), t0.getTime(), null)).toMatchObject({ mode: "up", ms: 12 * 60_000, expired: false });
  });
  it("formats", () => {
    expect(formatClock(30 * 60_000)).toBe("30:00");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    expect(formatClock(-5)).toBe("0:00");
    expect(describeClock(29 * 60_000, "down")).toBe("29 minutes left");
    expect(describeClock(65_000, "down")).toBe("1 minute 5 seconds left");
    expect(minutesLabel(30)).toBe("30 minutes");
    expect(minutesLabel(90)).toBe("1 hour 30 minutes");
    expect(durationLabel(45_000)).toBe("45 s");
    expect(durationLabel(12 * 60_000)).toBe("12 min");
    expect(durationLabel(64 * 60_000)).toBe("1 h 4 min");
  });
});
