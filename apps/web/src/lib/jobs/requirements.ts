import "server-only";
import { db } from "@/lib/db";
import { fullSweepKey, notifyOverdueRequirements, syncAllRequirementHolders } from "@/lib/domain/requirements";
import { fmtTime } from "@/lib/time";

/**
 * The "WSUSA requirements" scheduled job (lib/jobs/tick), every 15 minutes.
 *
 * Every run does the time-sensitive part: tasks that crossed their deadline
 * since the last run get their one notice (overdue, or permissions paused
 * for leaders). Pauses themselves need no write: getClubAccess reads the
 * evidence live.
 *
 * Once a day, on the first run, it also does the full sweep
 * (requirements.syncAllRequirementHolders): everyone's requirement tasks
 * are brought in line in one batch. That catches what no event announces,
 * like a new renewal period, calendar edits or drift. An admin saving a
 * requirement runs the same sweep right after the response. Either one
 * marks the campus day as swept in ReminderLog
 * ("job:requirements:full:<YYYY-MM-DD>").
 *
 * Joining, role changes, passes, check-ins and details saves sync that
 * person right away (requirements.syncUserRequirements), so nothing waits on
 * this job.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Runs the job and returns its line for System → Scheduled jobs. */
export async function runRequirementsJob(now: Date = new Date()): Promise<string> {
  const key = fullSweepKey(now);
  // Claiming the day first keeps two servers from sweeping at once; a failed sweep gives the claim back.
  const claimed = (await db.reminderLog.createMany({ data: [{ key, sentAt: now }], skipDuplicates: true })).count === 1;
  let sweep: Awaited<ReturnType<typeof syncAllRequirementHolders>> | null = null;
  if (claimed) {
    try {
      sweep = await syncAllRequirementHolders({ notify: "due", now });
    } catch (e) {
      await db.reminderLog.deleteMany({ where: { key } });
      throw e;
    }
  }
  const overdue = (await notifyOverdueRequirements(now)).notified;
  if (sweep) {
    const changed = [`opened ${sweep.opened}`, `closed ${sweep.closed}`, ...(sweep.updated ? [`updated ${sweep.updated}`] : [])].join(", ");
    return `Full sweep: ${plural(sweep.people, "person", "people")}, ${changed}; ${overdue} now overdue.`;
  }
  const last = await db.reminderLog.findUnique({ where: { key }, select: { sentAt: true } });
  return `Deadlines only: ${overdue} now overdue${last ? ` (today's full sweep ran at ${fmtTime(last.sentAt)})` : ""}.`;
}
