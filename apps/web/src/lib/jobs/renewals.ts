import "server-only";
import { db } from "@/lib/db";
import { currentRenewalWindow } from "@/lib/domain/renewals";
import { notify } from "@/lib/domain/notify";
import { createTask } from "@/lib/domain/tasks";
import { loadRenewalStates } from "@/lib/renewals/facts";
import { RENEWAL_SOURCE, RENEWAL_TASK_DESCRIPTION, renewalDueNotice, renewalHref, renewalSourceId, renewalTaskTitle } from "@/lib/renewals/rules";
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
 * The "Club renewals" job (lib/jobs/tick). From the day renewal opens, every
 * approved club that hasn't renewed has one required REQUIREMENT task per
 * current President and advisor ("Renew RC Wrecker Bots Club for 2026–27",
 * due on the due date). Idempotent and self-healing, like the requirements
 * job:
 *   club renewed                        → its open tasks close (DONE)
 *   someone left the President's or advisor's seat → their task is cancelled
 *   a new President or advisor          → they get a task, and a notification
 *   last year's tasks, retired clubs, clubs approved after the window opened → cancelled
 *   the due date changed (System settings) → open tasks move with it
 * It never pauses, retires or changes a club: WSUSA decides about late ones.
 */
export async function syncRenewalTasks(now: Date = new Date()): Promise<RenewalJobResult> {
  const { window, term } = await currentRenewalWindow(now);
  const open = await db.task.findMany({ where: { sourceType: RENEWAL_SOURCE, status: "OPEN" }, select: { id: true, sourceId: true, assigneeId: true, dueAt: true } });
  const result: RenewalJobResult = { year: window?.year ?? null, opensAt: window?.opensAt ?? null, expected: 0, renewed: 0, opened: 0, clubs: 0, closed: 0, cancelled: 0 };
  const cancel = async (ids: string[]) => {
    if (!ids.length) return;
    result.cancelled += (await db.task.updateMany({ where: { id: { in: ids }, status: "OPEN" }, data: { status: "CANCELLED", completedAt: now } })).count;
  };
  if (!window || now < window.opensAt) {
    await cancel(open.map((t) => t.id));
    return result;
  }

  const states = await loadRenewalStates(db, { window, term, now });
  const byClub = new Map(states.map((s) => [s.club.id, s]));
  const stale: string[] = [];
  const redate: string[] = [];
  const kept = new Set<string>();
  for (const t of open) {
    const at = (t.sourceId ?? "").indexOf(":");
    const clubId = (t.sourceId ?? "").slice(0, at);
    const s = at > 0 && t.sourceId!.slice(at + 1) === window.year ? byClub.get(clubId) : undefined;
    if (!s || s.exemption) {
      stale.push(t.id);
      continue;
    }
    if (s.renewal) {
      // Renewed somewhere that didn't close it (normally renewClub already has).
      result.closed += (await db.task.updateMany({ where: { id: t.id, status: "OPEN" }, data: { status: "DONE", completedAt: s.renewal.submittedAt, completedById: s.renewal.submittedBy?.id ?? null } })).count;
      continue;
    }
    const holders = new Set([...s.presidents, ...s.advisors].map((p) => p.id));
    if (!t.assigneeId || !holders.has(t.assigneeId) || kept.has(`${clubId}:${t.assigneeId}`)) {
      stale.push(t.id);
      continue;
    }
    kept.add(`${clubId}:${t.assigneeId}`);
    if (t.dueAt?.getTime() !== window.dueAt.getTime()) redate.push(t.id);
  }
  await cancel(stale);
  if (redate.length) await db.task.updateMany({ where: { id: { in: redate } }, data: { dueAt: window.dueAt } });

  const late = now > window.dueAt;
  for (const s of states) {
    if (s.exemption && !s.renewal) continue;
    result.expected++;
    if (s.renewal) {
      result.renewed++;
      continue;
    }
    const people = [...s.presidents, ...s.advisors].filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i && !kept.has(`${s.club.id}:${p.id}`));
    if (!people.length) continue;
    const href = renewalHref(s.club.slug);
    for (const p of people) {
      await createTask({
        kind: "REQUIREMENT",
        title: renewalTaskTitle(s.club.name, window.year),
        description: RENEWAL_TASK_DESCRIPTION,
        assignee: { type: "USER", userId: p.id },
        clubId: s.club.id,
        href,
        dueAt: window.dueAt,
        source: { type: RENEWAL_SOURCE, id: renewalSourceId(s.club.id, window.year) },
        required: true,
      });
    }
    result.opened += people.length;
    result.clubs++;
    await notify({ userIds: people.map((p) => p.id), kind: "club.renewal_due", ...renewalDueNotice(s.club.name, window, late), href });
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
