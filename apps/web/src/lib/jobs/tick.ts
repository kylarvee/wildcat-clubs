import "server-only";
import { logActivity } from "@/lib/lake/activity";
import { advanceElections } from "@/lib/domain/elections";
import { notifyOverdueRequirements, syncAllRequirementHolders } from "@/lib/domain/requirements";
import { markMissedAssignments, prefillPendingSuggestions, runTestCycles, submitAbandonedAttempts } from "@/lib/domain/tests";

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
    await job("WSUSA requirements", async () => {
      const synced = await syncAllRequirementHolders({ notify: "due", now });
      const overdue = await notifyOverdueRequirements(now);
      return `Re-checked ${plural(synced.people, "person", "people")}; opened ${plural(synced.opened, "new requirement task")}; told ${plural(overdue.notified, "person", "people")} a requirement is overdue.`;
    }),
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
