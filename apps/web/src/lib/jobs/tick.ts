import "server-only";
import { logActivity } from "@/lib/lake/activity";
import { advanceElections } from "@/lib/domain/elections";
import { runRequirementsJob } from "@/lib/jobs/requirements";
import { runClubRenewals } from "@/lib/jobs/renewals";
import { markMissedAssignments, prefillPendingSuggestions, runTestCycles, submitAbandonedAttempts } from "@/lib/domain/tests";
import { pruneSearchLog, reindexStale, SEARCH_LOG_DAYS } from "@/lib/search/index-build";
import { sendReminders } from "@/lib/jobs/reminders";
import { runClubStaffing } from "@/lib/jobs/staffing";
import { runFundingFollowUps } from "@/lib/jobs/funding";
import { runNotificationJobs } from "@/lib/jobs/notifications";

/**
 * CONTRACT (owner: tests & policy builder). Scheduled jobs, run by
 * GET/POST /api/cron/tick (with CRON_SECRET) and the "Run now" button in
 * System → Scheduled jobs. Every job is idempotent, so running early, late
 * or twice is safe; each returns one JobReport line for the System page.
 *
 * Suggested schedule: every 10–15 minutes (abandoned attempts and election
 * windows are the time-sensitive ones; the rest are daily in practice).
 */
export type JobReport = { name: string; ok: boolean; detail: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function job(name: string, fn: () => Promise<string>): Promise<JobReport> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, detail: `${detail} (${Date.now() - started} ms)` };
  } catch (e) {
    console.error(`[jobs] ${name} failed`, e);
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// One run at a time per server: a second trigger while one is running gets the same result.
let running: Promise<JobReport[]> | null = null;

export async function runAllJobs(now: Date = new Date()): Promise<JobReport[]> {
  if (running) return running;
  running = runSequence(now).finally(() => {
    running = null;
  });
  return running;
}

/**
 * Order matters: abandoned attempts are handed in first (a pass there
 * completes an assignment before the deadline check sees it), new rounds are
 * assigned before misses are counted, and requirements are re-checked after
 * attempts are handed in but before misses are marked, so people whose roles
 * ended are excused from officer tests instead of marked MISSED.
 */
async function runSequence(now: Date): Promise<JobReport[]> {
  const reports: JobReport[] = [];
  reports.push(
    await job("Hand in abandoned test attempts", async () => {
      const r = await submitAbandonedAttempts(now);
      const ai = await prefillPendingSuggestions();
      const parts = [`Submitted ${plural(r.submitted, "attempt")} whose time ran out`, `opened ${plural(r.reviewTasks, "grading task")}`];
      if (ai.attempts) parts.push(`added Claude suggestions to ${plural(ai.suggestions, "answer")}`);
      return parts.join("; ") + ".";
    }),
  );
  reports.push(
    await job("Recurring test rounds", async () => {
      const r = await runTestCycles(now);
      return `Checked ${plural(r.tests, "assigned test")}; assigned ${plural(r.assigned, "person", "people")} for the current round.`;
    }),
  );
  reports.push(
    // Every run: deadlines just crossed (overdue notices). The first run each day: the full sweep (lib/jobs/requirements).
    await job("WSUSA requirements", () => runRequirementsJob(now)),
  );
  reports.push(
    // Yearly re-registration with WSUSA (lib/jobs/renewals): Presidents' and advisors' tasks from the day renewal opens.
    await job("Club renewals", () => runClubRenewals(now)),
  );
  reports.push(
    await job("Missed test deadlines", async () => {
      const r = await markMissedAssignments(now);
      return r.missed ? `Marked ${plural(r.missed, "assignment")} missed and ran their automations.` : "No deadlines passed since the last run.";
    }),
  );
  reports.push(
    await job("Elections", async () => {
      const r = await advanceElections(now);
      return r.advanced ? `Moved ${plural(r.advanced, "election")} to its next stage.` : "No elections were due to open or close.";
    }),
  );
  reports.push(
    // Events starting in about an hour, and required tasks due in a week or a day (lib/jobs/reminders).
    // After the requirements job, so requirement tasks and their due dates are current.
    await job("Reminders", async () => {
      const r = await sendReminders(now);
      const parts = [
        r.events ? `Reminded ${plural(r.eventPeople, "person", "people")} about ${plural(r.events, "event")} starting in about an hour` : "No new reminders for events starting in about an hour",
        r.dueTasks ? `sent ${plural(r.dueTasks, "due-date reminder")} for required tasks` : "no new due-date reminders for required tasks",
      ];
      if (r.pruned) parts.push(`cleared ${plural(r.pruned, "reminder record")} older than 30 days`);
      return parts.join("; ") + ".";
    }),
  );
  reports.push(
    // Requests past the deciding office's review time and invoices past due: one in-app reminder to that office's staff each (lib/jobs/funding).
    await job("Funding follow-ups", () => runFundingFollowUps(now)),
  );
  reports.push(
    // Catches what the write paths' reindexClubSoon didn't (constitutions, seats, files, renames):
    // clubs whose content is newer than their search document, plus any document a day old.
    await job("Club search", async () => {
      const r = await reindexStale();
      const pruned = await pruneSearchLog(undefined, now);
      const parts = [r.indexed ? `Re-indexed ${plural(r.indexed, "club")} whose pages changed` : "Every club's search page was up to date"];
      if (r.removed) parts.push(`dropped ${plural(r.removed, "club")} no longer listed`);
      if (pruned) parts.push(`cleared ${plural(pruned, "search")} older than ${SEARCH_LOG_DAYS} days`);
      return parts.join("; ") + ".";
    }),
  );
  reports.push(
    // Join requests nobody can approve (one WSUSA task per club), and a re-check of clubs missing a leader (lib/jobs/staffing).
    await job("Club staffing", () => runClubStaffing(now)),
  );
  reports.push(
    // Last, so whatever the jobs above queued goes out in the same run: big sends' emails and pushes,
    // about 200 a run, oldest first, and WSUSA's daily digest (lib/jobs/notifications).
    await job("Send queued messages", () => runNotificationJobs(now)),
  );
  return reports;
}

/** The cron entry point: runs every job and records the run (System → Scheduled jobs reads "system.jobs_run"). */
export async function runScheduledJobs(now: Date = new Date()): Promise<JobReport[]> {
  let reports: JobReport[];
  try {
    reports = await runAllJobs(now);
  } catch (e) {
    reports = [{ name: "Scheduled jobs", ok: false, detail: e instanceof Error ? e.message : String(e) }];
  }
  await logActivity({
    actorId: null,
    action: "system.jobs_run",
    entityType: "system",
    entityId: "jobs",
    data: { manual: false, reports: reports.map((r) => ({ name: r.name, ok: r.ok, detail: r.detail.slice(0, 500) })) },
  });
  return reports;
}
