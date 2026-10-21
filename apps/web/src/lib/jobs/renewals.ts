import "server-only";
import { db } from "@/lib/db";
import { currentRenewalWindow, RENEWAL_TASK_SELECT, syncClubRenewal } from "@/lib/domain/renewals";
import { loadRenewalStates, type ClubRenewalState } from "@/lib/renewals/facts";
import { isEmptyPlan, RENEWAL_SOURCE, renewalSourceClub, renewalTaskPlan, type RenewalTaskRow } from "@/lib/renewals/rules";
import { fmtLongDate } from "@/lib/time";

export type RenewalJobResult = {
  year: string | null;
  opensAt: Date | null;
  /** Clubs asked to renew this window, and how many already did. */
  expected: number;
  renewed: number;
  opened: number;
  /** Clubs whose leaders got a new task this run. */
  clubs: number;
  closed: number;
  cancelled: number;
};

/**
 * The "Club renewals" job (lib/jobs/tick): the daily sweep behind the
 * per-club sync (lib/domain/renewals syncClubRenewal), which every role
 * change also runs for its club. From the day renewal opens, every approved
 * club that hasn't renewed has one required REQUIREMENT task per current
 * President and advisor ("Renew RC Wrecker Bots Club for 2026–27", due on
 * the due date). Idempotent and self-healing, like the requirements job:
 *   club renewed                        → its open tasks close (DONE)
 *   someone left the President's or advisor's seat → their task is cancelled
 *   a new President or advisor          → they get a task, and a notification
 *   last year's tasks, retired clubs, clubs approved after the window opened → cancelled
 *   the due date changed (System settings), the club moved office or was renamed → open tasks follow
 * It reads every club's facts in a few queries, works out each club's plan
 * (lib/renewals/rules renewalTaskPlan) and syncs only the clubs that are out
 * of line, each under its lock from fresh facts. It never pauses, retires or
 * changes a club: WSUSA decides about late ones.
 */
export async function syncRenewalTasks(now: Date = new Date()): Promise<RenewalJobResult> {
  const at = await currentRenewalWindow(now);
  const { window } = at;
  const result: RenewalJobResult = { year: window?.year ?? null, opensAt: window?.opensAt ?? null, expected: 0, renewed: 0, opened: 0, clubs: 0, closed: 0, cancelled: 0 };
  const open = await db.task.findMany({ where: { sourceType: RENEWAL_SOURCE, status: "OPEN" }, select: RENEWAL_TASK_SELECT });
  const states = window && now >= window.opensAt ? await loadRenewalStates(db, { window, term: at.term, now }) : [];
  for (const s of states) {
    if (s.exemption && !s.renewal) continue;
    result.expected++;
    if (s.renewal) result.renewed++;
  }

  // Each open task under the club it's about; one that names no club can't be synced, so it's cancelled here.
  const tasksOf = new Map<string, RenewalTaskRow[]>();
  const orphans: string[] = [];
  for (const t of open) {
    const clubId = renewalSourceClub(t.sourceId);
    if (!clubId) orphans.push(t.id);
    else tasksOf.set(clubId, [...(tasksOf.get(clubId) ?? []), t]);
  }
  if (orphans.length) result.cancelled += (await db.task.updateMany({ where: { id: { in: orphans }, status: "OPEN" }, data: { status: "CANCELLED", completedAt: now } })).count;

  // Clubs that aren't on the list (retired, still founding, gone) only have tasks to cancel; syncClubRenewal reads their own state.
  const stateOf = new Map<string, ClubRenewalState>(states.map((s) => [s.club.id, s]));
  for (const clubId of new Set([...tasksOf.keys(), ...stateOf.keys()])) {
    if (isEmptyPlan(renewalTaskPlan(stateOf.get(clubId) ?? null, tasksOf.get(clubId) ?? [], window, now))) continue;
    const r = await syncClubRenewal(clubId, { now, at });
    result.opened += r.opened;
    if (r.opened) result.clubs++;
    result.closed += r.done;
    result.cancelled += r.cancelled;
  }
  return result;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** syncRenewalTasks as one line for System → Scheduled jobs. */
export async function runClubRenewals(now: Date = new Date()): Promise<string> {
  const r = await syncRenewalTasks(now);
  if (!r.year || !r.opensAt) return "There's no academic year on the calendar yet, so renewal isn't open.";
  if (now < r.opensAt) return `Renewal for ${r.year} opens ${fmtLongDate(r.opensAt)}.`;
  const parts = [`${r.renewed} of ${plural(r.expected, "club")} re-registered for ${r.year}`];
  if (r.opened) parts.push(`opened ${plural(r.opened, "renewal task")} for ${plural(r.clubs, "club")}`);
  if (r.closed) parts.push(`closed ${plural(r.closed, "task")} for clubs that renewed`);
  if (r.cancelled) parts.push(`cancelled ${plural(r.cancelled, "task")} that no longer applied`);
  return parts.join("; ") + ".";
}
