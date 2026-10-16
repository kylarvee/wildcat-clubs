import "server-only";

/**
 * CONTRACT (owner: tests & policy builder). Scheduled jobs, run by
 * GET/POST /api/cron/tick (with CRON_SECRET) and the "Run now" button in
 * System → Scheduled jobs. Each job is idempotent.
 * STUB.
 */
export type JobReport = { name: string; ok: boolean; detail: string };

export async function runAllJobs(now: Date = new Date()): Promise<JobReport[]> {
  void now;
  return [];
}
