import { differenceInCalendarDays } from "date-fns";
import { fmtDate, fmtTime, inCampusTime } from "@/lib/time";

/**
 * The rules behind reminders (pure; lib/jobs/reminders runs them, and
 * lib/domain/attendance sends the one-time "You can review" notice):
 * when each reminder is due, the ReminderLog keys that keep it to one, and
 * what it says.
 */

const MINUTE = 60_000;
const DAY = 86_400_000;

// ─── Events starting soon ────────────────────────────────────────────────────

/**
 * The job runs about every 15 minutes, and each run reminds people about the
 * dates starting 45–75 minutes from then, so every date is in one or two
 * runs' windows (its key keeps it to one reminder).
 */
export const STARTING_SOON_MINUTES = { from: 45, to: 75 } as const;

export function startingSoonWindow(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() + STARTING_SOON_MINUTES.from * MINUTE), to: new Date(now.getTime() + STARTING_SOON_MINUTES.to * MINUTE) };
}

export function isStartingSoon(startsAt: Date, now: Date): boolean {
  const w = startingSoonWindow(now);
  return startsAt >= w.from && startsAt <= w.to;
}

/** "Starting soon: Build Night" · "Starts at 6:00 PM · NB 220 · RC Wrecker Bots Club". */
export function startingSoonNotice(o: { title: string; startsAt: Date; place: string | null; host: string | null; required?: boolean }): { title: string; body: string } {
  const bits = [`Starts at ${fmtTime(o.startsAt)}`, o.place, o.host, o.required ? "Required by WSUSA" : null].filter((b): b is string => Boolean(b));
  return { title: `Starting soon: ${o.title}`, body: bits.join(" · ") };
}

// ─── Requirements due ────────────────────────────────────────────────────────

export type DueStage = "7d" | "1d";

const STAGES: [DueStage, number][] = [
  ["1d", 1],
  ["7d", 7],
];

/**
 * The due-date reminder an open required task is owed now: "7d" in its last
 * week, "1d" in its last day. Each only if the task already existed at that
 * mark: someone handed a task three days before its deadline just heard about
 * it, so they skip the week-ahead reminder. Overdue tasks get the overdue
 * notice (lib/domain/requirements) instead.
 */
export function dueStage(task: { dueAt: Date; createdAt: Date }, now: Date): DueStage | null {
  const left = task.dueAt.getTime() - now.getTime();
  if (left <= 0) return null;
  for (const [stage, days] of STAGES) {
    if (left <= days * DAY) return task.createdAt.getTime() <= task.dueAt.getTime() - days * DAY ? stage : null;
  }
  return null;
}

/** "today", "tomorrow", "in 6 days" (campus calendar days). */
export function dueWhen(dueAt: Date, now: Date): string {
  const days = differenceInCalendarDays(inCampusTime(dueAt), inCampusTime(now));
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** Task titles start with what to do ("Pass: …"); the reminder says it as a sentence. */
const DO: [RegExp, string][] = [
  [/^Pass: /, "Pass it"],
  [/^Attend: /, "Attend a session"],
  [/^Fill out: /, "Fill it out"],
  [/^Fill in: /, "Fill them in"],
  [/^Confirm: /, "Confirm them"],
  [/^Take: /, "Take it"],
];

/**
 * "Club Officer Policy Test is due in 7 days" · "Pass it by Tue, Oct 27 at
 * 3:00 PM to keep your permissions in Wildcat Investors." `gatesClub`: the club
 * whose permissions pause if it's late (a leader's requirement), else null.
 */
export function dueSoonNotice(t: { title: string; dueAt: Date; gatesClub: string | null }, now: Date): { title: string; body: string } {
  const action = DO.find(([re]) => re.test(t.title));
  const name = action ? t.title.replace(action[0], "") : t.title;
  const by = `${action?.[1] ?? "Finish it"} by ${fmtDate(t.dueAt, "EEE, MMM d")} at ${fmtTime(t.dueAt)}`;
  return {
    title: `${name} is due ${dueWhen(t.dueAt, now)}`,
    body: t.gatesClub ? `${by} to keep your permissions in ${t.gatesClub}.` : `${by}. WSUSA requires it.`,
  };
}

// ─── Review unlocked (sent from check-in, not the job) ──────────────────────

/**
 * "You can review Pre-Med Club now". Check-ins count once their event has
 * started (lib/metrics), so a check-in made before the start that will unlock
 * reviews says when: `opensAt`.
 */
export function reviewUnlockedNotice(o: { clubName: string; attended: number; opensAt: Date | null }): { title: string; body: string } {
  return o.opensAt
    ? { title: `You can review ${o.clubName} from ${fmtTime(o.opensAt)}`, body: `That's when this event starts, your ${ordinal(o.attended)} with the club. Tell other students what it's like.` }
    : { title: `You can review ${o.clubName} now`, body: `You've been to ${o.attended} of its events. Tell other students what it's like.` };
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ─── Keys ────────────────────────────────────────────────────────────────────

/**
 * ReminderLog keys. A reminder claims its key before it's sent, so a repeated
 * or overlapping run sends nothing twice. Start and due times are part of the
 * key, so a date that moves is reminded again at its new time.
 */
export const reminderKeys = {
  startingSoon: (occurrenceId: string, startsAt: Date) => `event:${occurrenceId}:${startsAt.getTime()}`,
  due: (taskId: string, stage: DueStage, dueAt: Date) => `due:${taskId}:${stage}:${dueAt.getTime()}`,
  /** Kept for good: "once per person and club". */
  reviewUnlocked: (userId: string, clubId: string) => `review:${userId}:${clubId}`,
};

/** The job prunes its own keys after 30 days. Review keys stay, and other jobs' markers in ReminderLog aren't ours to clear. */
export const PRUNED_KEY_PREFIXES = ["event:", "due:"] as const;
export const REMINDER_KEEP_DAYS = 30;

export function pruneBefore(now: Date): Date {
  return new Date(now.getTime() - REMINDER_KEEP_DAYS * DAY);
}
