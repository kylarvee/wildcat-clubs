import "server-only";
import { recheckOpenStaffingTasks, syncOrphanedRequests } from "@/lib/domain/staffing";

/**
 * The "Club staffing" scheduled job (lib/jobs/tick). Join requests nobody can
 * approve get one WSUSA task per club (and lose it once they're decided or
 * someone can approve them), and clubs with an open staffing task are
 * re-checked, so a gap filled outside a role change closes too. Opening a
 * staffing task is left to role changes (lib/domain/staffing). Idempotent:
 * running it early, late or twice changes nothing more.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Runs the job and returns its line for System → Scheduled jobs. */
export async function runClubStaffing(now: Date = new Date()): Promise<string> {
  const requests = await syncOrphanedRequests(now);
  const staffing = await recheckOpenStaffingTasks();
  const parts: string[] = [];
  if (requests.flagged) parts.push(`Flagged ${plural(requests.flagged, "club")} with join requests nobody can approve`);
  if (requests.cleared) parts.push(`closed ${plural(requests.cleared, "waiting-requests task")}`);
  if (requests.waiting) parts.push(`${plural(requests.waiting, "club")} still ${requests.waiting === 1 ? "has" : "have"} requests nobody can approve`);
  if (!parts.length) parts.push("No join requests are stuck");
  parts.push(
    staffing.clubs
      ? `re-checked ${plural(staffing.clubs, "club")} missing a leader${staffing.closed ? ` and closed ${plural(staffing.closed, "task")} whose seat is filled` : ""}`
      : "no club is waiting on a new leader",
  );
  return parts.join("; ") + ".";
}
