/**
 * Time rules for taking a test — pure, shared by the server (enforcement) and
 * the attempt page (the ticking clock). The server is the authority: the
 * client clock only decides when to auto-submit; late answers are refused here.
 */
import type { Cycle } from "@/lib/tests/cycles";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Slack for the last autosave or Submit that left the browser just before time ran out. */
export const ANSWER_GRACE_MS = 15_000;

/** The moment an attempt must be in: start + time limit, but never past a one-off test's closing time. */
export function attemptDeadline(startedAt: Date, timeLimitMinutes: number | null, closesAt: Date | null): Date | null {
  const byLimit = timeLimitMinutes ? new Date(startedAt.getTime() + timeLimitMinutes * MINUTE) : null;
  if (byLimit && closesAt) return byLimit < closesAt ? byLimit : closesAt;
  return byLimit ?? closesAt ?? null;
}

/** Answers are accepted until the deadline (plus a little network grace). Untimed attempts always accept. */
export function acceptsAnswers(now: Date, deadlineAt: Date | null): boolean {
  return !deadlineAt || now.getTime() <= deadlineAt.getTime() + ANSWER_GRACE_MS;
}

/** True when the scheduled job should submit an attempt someone walked away from. */
export function isAbandoned(now: Date, deadlineAt: Date | null): boolean {
  return Boolean(deadlineAt) && now.getTime() > deadlineAt!.getTime() + ANSWER_GRACE_MS;
}

/**
 * When an assignment is due. One-off tests with a closing time are due then;
 * otherwise `dueDays` after the person was assigned, but never after the
 * cycle ends (a weekly quiz can't be due next month).
 */
export function assignmentDueAt(input: { assignedAt: Date; dueDays: number; closesAt: Date | null; cycle: Pick<Cycle, "end">; oneOff: boolean }): Date {
  if (input.oneOff && input.closesAt) return input.closesAt;
  const due = new Date(input.assignedAt.getTime() + Math.max(1, input.dueDays) * DAY);
  const end = input.cycle.end;
  if (end && end > input.assignedAt && end < due) return end;
  return due;
}

export type TimerState = {
  mode: "down" | "up";
  /** Remaining (down) or elapsed (up) milliseconds, never negative. */
  ms: number;
  /** Warnings fire at 5 minutes and 1 minute left. */
  warning: null | "five" | "one";
  expired: boolean;
};

/** What the clock shows. Counts down with a limit; counts up without one (the clock always runs). */
export function timerState(nowMs: number, startedAtMs: number, deadlineMs: number | null): TimerState {
  if (deadlineMs === null) return { mode: "up", ms: Math.max(0, nowMs - startedAtMs), warning: null, expired: false };
  const left = deadlineMs - nowMs;
  const ms = Math.max(0, left);
  return { mode: "down", ms, warning: left <= MINUTE && left > 0 ? "one" : left <= 5 * MINUTE && left > 0 ? "five" : null, expired: left <= 0 };
}

/** "4:05", "29:59", "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Spoken form for screen readers: "29 minutes left", "1 hour 2 minutes elapsed". */
export function describeClock(ms: number, mode: "down" | "up"): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m || h) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (!h && m < 2) parts.push(`${s} second${s === 1 ? "" : "s"}`);
  return `${parts.join(" ")} ${mode === "down" ? "left" : "elapsed"}`;
}

/** "30 minutes", "1 hour", "1 hour 30 minutes". */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hs = h ? `${h} hour${h === 1 ? "" : "s"}` : "";
  const ms = m ? `${m} minute${m === 1 ? "" : "s"}` : "";
  return [hs, ms].filter(Boolean).join(" ") || "0 minutes";
}

/** Time taken, for results tables: "12 min", "1 h 4 min", "45 s". */
export function durationLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
