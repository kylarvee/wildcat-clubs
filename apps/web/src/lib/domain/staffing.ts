import "server-only";
import type { ClubStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { clubCapabilityHolders } from "@/lib/authz/people";
import { logActivity } from "@/lib/lake/activity";
import { notify } from "@/lib/domain/notify";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { notifyOffice, officeForClub } from "@/lib/offices";
import { clubRules } from "@/lib/constitution/club-rules";
import { staffingDueAt } from "@/lib/constitution/rules";
import {
  filledGap,
  gapNotice,
  gapsOpenedBy,
  gapTask,
  hasOrphanedRequests,
  ORPHAN_REQUEST_DAYS,
  ORPHAN_REQUESTS_SOURCE,
  orphanRequestsTask,
  parseStaffingSourceId,
  STAFFING_GAPS,
  STAFFING_SOURCE,
  staffingGaps,
  staffingSourceId,
  staffingTaskPlan,
  type HeldRole,
  type StaffingGap,
} from "@/lib/staffing/rules";

/**
 * Keeping every approved club staffed (the rules: lib/staffing/rules).
 *
 * After every role change (lib/domain/roles, and the membership exits in
 * lib/domain/memberships), the write path calls staffingAfterRoleChange()
 * with the clubs it touched and the moment the change began. For each club,
 * checkClubStaffing():
 *   - opens one WSUSA task (ADMINS, APPROVAL, sourceType "clubStaffing",
 *     sourceId "<clubId>:president|advisor|approver") for each gap the change
 *     opened, and tells the club's remaining leaders and advisors and WSUSA's
 *     admins (staffing.gap, an "always" kind: in-app, email and push);
 *   - closes the task of every gap that's filled;
 *   - runs under a per-club lock, so there's never a second open task for a gap.
 * A gap that was there before the change gets no task. The scheduled "Club
 * staffing" job (lib/jobs/staffing) re-checks the clubs with an open task,
 * so a gap filled some other way (the club retired, its join policy changed,
 * a paused officer caught up) closes too, and it flags join requests nobody
 * can approve.
 */

const DAY_MS = 86_400_000;

export type StaffingResult = { opened: StaffingGap[]; closed: StaffingGap[] };

export type StaffingCheck = {
  /** When the role change began. Roles that ended since then can open gaps; with neither this nor `dropped`, the check only closes tasks. */
  since?: Date | null;
  /** Who made the change: credited with closing a task, and not told about their own change. */
  actorId?: string | null;
  /** Seats the change took a permission from without ending them (Members taken off an officer's seat). */
  dropped?: HeldRole[];
};

const lockKey = (source: string, clubId: string) => `${source}:${clubId}`;

/** Opens and closes one club's WSUSA staffing tasks (see the module comment). Throws on a database error; write paths use staffingAfterRoleChange. */
export async function checkClubStaffing(clubId: string, opts: StaffingCheck = {}): Promise<StaffingResult> {
  const now = new Date();
  const gate = await db.club.findUnique({ where: { id: clubId }, select: { status: true, joinPolicy: true } });
  if (!gate) return { opened: [], closed: [] };
  // Approving takes the Members permission right now (lib/authz), so a paused officer doesn't count.
  const approvers = gate.status === "APPROVED" && gate.joinPolicy === "APPROVAL" ? (await clubCapabilityHolders(clubId, "roster")).length : 0;
  const done = await db.$transaction(
    async (tx) => {
      // One check per club at a time, and the facts are read inside it: two changes at once can't open two tasks for a gap or leave a filled one open.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${lockKey(STAFFING_SOURCE, clubId)}))`;
      const club = await tx.club.findUnique({ where: { id: clubId }, select: { id: true, name: true, slug: true, type: true, status: true, joinPolicy: true } });
      if (!club) return null;
      const [current, ended, open] = await Promise.all([
        tx.roleAssignment.findMany({ where: { clubId, endedAt: null }, select: { userId: true, role: true, permissions: true, user: { select: { status: true } } } }),
        opts.since
          ? tx.roleAssignment.findMany({ where: { clubId, endedAt: { gte: opts.since } }, orderBy: { endedAt: "desc" }, select: { role: true, permissions: true, user: { select: { name: true } } } })
          : Promise.resolve([]),
        tx.task.findMany({ where: { sourceType: STAFFING_SOURCE, sourceId: { in: STAFFING_GAPS.map((g) => staffingSourceId(clubId, g)) }, status: "OPEN" }, select: { sourceId: true } }),
      ]);
      const gaps = staffingGaps({ status: club.status, joinPolicy: club.joinPolicy, current, approvers });
      const opened = gapsOpenedBy(gaps, [...ended, ...(opts.dropped ?? [])]);
      const plan = staffingTaskPlan(gaps, opened, open.map((t) => parseStaffingSourceId(t.sourceId)?.gap).filter((g): g is StaffingGap => Boolean(g)));

      if (plan.close.length) {
        await tx.task.updateMany({
          where: { sourceType: STAFFING_SOURCE, sourceId: { in: plan.close.map((g) => staffingSourceId(clubId, g)) }, status: "OPEN" },
          data: { status: "DONE", completedAt: now, completedById: opts.actorId ?? null },
        });
      }
      const hasAdvisor = current.some((r) => r.role === "ADVISOR");
      const stories = plan.open.map((gap) => ({ club, gap, leftName: ended.find((r) => filledGap(r, gap))?.user.name ?? null, hasAdvisor }));
      // Due when the club's bylaws say the seat should be filled (vacancyDays) or a new advisor found (advisorReplaceDays); undated when they don't say.
      const rules = stories.length ? await clubRules(clubId) : null;
      for (const s of stories) {
        const t = gapTask(s);
        await createTask(
          { kind: "APPROVAL", title: t.title, description: t.description, href: t.href, assignee: { type: "ADMINS" }, clubId, source: { type: STAFFING_SOURCE, id: staffingSourceId(clubId, s.gap) }, createdById: opts.actorId ?? null, dueAt: rules ? staffingDueAt(s.gap, rules, now) : null },
          tx,
        );
      }
      // Everyone still leading the club hears about it: officers, Vice Presidents, Presidents and advisors.
      const leaders = [...new Set(current.filter((r) => r.role !== "MEMBER" && r.user.status === "ACTIVE").map((r) => r.userId))];
      return { plan, stories, leaders };
    },
    { timeout: 15_000 },
  );
  if (!done) return { opened: [], closed: [] };

  // The gap's task went to the club's office (lib/domain/tasks createTask), and so do these notices.
  const office = done.stories.length ? await officeForClub(clubId) : null;
  for (const s of done.stories) {
    await logActivity({ actorId: null, action: "staffing.gap_flagged", entityType: "club", entityId: clubId, clubId, data: { gap: s.gap } });
    const n = gapNotice({ ...s, office: office?.name });
    await notify({ userIds: done.leaders, exceptUserId: opts.actorId, kind: "staffing.gap", title: n.title, body: n.body, href: n.href });
    // The office hears right away too, with its task's wording (a staffing gap is never held for the daily digest).
    const t = gapTask(s);
    await notifyOffice({ clubId }, { exceptUserId: opts.actorId, kind: "staffing.gap", title: t.title, body: t.description, href: t.href });
  }
  return { opened: done.plan.open, closed: done.plan.close };
}

/**
 * For write paths, right after a role change: checks each club it touched.
 * Never throws: the change has already happened, so a failed check is logged
 * and the scheduled job's re-check closes whatever it missed.
 */
export async function staffingAfterRoleChange(clubIds: Iterable<string>, opts: StaffingCheck): Promise<Map<string, StaffingResult>> {
  const out = new Map<string, StaffingResult>();
  for (const clubId of new Set(clubIds)) {
    try {
      out.set(clubId, await checkClubStaffing(clubId, opts));
    } catch (e) {
      console.error(`[staffing] couldn't check club ${clubId} after a role change`, e);
    }
  }
  return out;
}

// ─── Scheduled (lib/jobs/staffing) ───────────────────────────────────────────

/** Re-checks every club with an open staffing task and closes the ones whose gap is filled. Opens nothing: only role changes do. */
export async function recheckOpenStaffingTasks(): Promise<{ clubs: number; closed: number }> {
  const open = await db.task.findMany({ where: { sourceType: STAFFING_SOURCE, status: "OPEN" }, select: { sourceId: true } });
  const clubIds = [...new Set(open.map((t) => parseStaffingSourceId(t.sourceId)?.clubId).filter((id): id is string => Boolean(id)))];
  let closed = 0;
  for (const clubId of clubIds) closed += (await checkClubStaffing(clubId)).closed.length;
  return { clubs: clubIds.length, closed };
}

/**
 * Join requests nobody can approve: one WSUSA task per club, "Join requests
 * waiting at {club}" (sourceType "orphanRequests", sourceId the club), while
 * a request has waited more than ORPHAN_REQUEST_DAYS and nobody in the club
 * holds the Members permission. It closes once the requests are decided or
 * someone can approve them.
 */
export async function syncOrphanedRequests(now: Date = new Date()): Promise<{ flagged: number; cleared: number; waiting: number }> {
  const cutoff = new Date(now.getTime() - ORPHAN_REQUEST_DAYS * DAY_MS);
  const [old, open] = await Promise.all([
    db.membership.groupBy({ by: ["clubId"], where: { status: "PENDING", requestedAt: { lt: cutoff }, club: { status: "APPROVED" } }, _min: { requestedAt: true } }),
    db.task.findMany({ where: { sourceType: ORPHAN_REQUESTS_SOURCE, status: "OPEN" }, select: { sourceId: true } }),
  ]);
  const oldest = new Map(old.map((g) => [g.clubId, g._min.requestedAt]));
  const clubIds = [...new Set([...oldest.keys(), ...open.map((t) => t.sourceId).filter((id): id is string => Boolean(id))])];
  const out = { flagged: 0, cleared: 0, waiting: 0 };
  for (const clubId of clubIds) {
    const oldestPendingAt = oldest.get(clubId) ?? null;
    const approvers = oldestPendingAt ? (await clubCapabilityHolders(clubId, "roster")).length : 0;
    const orphaned = hasOrphanedRequests({ oldestPendingAt, approvers, now });
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${lockKey(ORPHAN_REQUESTS_SOURCE, clubId)}))`;
      const task = await tx.task.findFirst({ where: { sourceType: ORPHAN_REQUESTS_SOURCE, sourceId: clubId, status: "OPEN" }, select: { id: true } });
      if (!orphaned) {
        if (!task) return null;
        await resolveTasks(ORPHAN_REQUESTS_SOURCE, clubId, null, tx);
        return "cleared" as const;
      }
      if (task) return "waiting" as const;
      const club = await tx.club.findUnique({ where: { id: clubId }, select: { name: true, slug: true } });
      if (!club) return null;
      const t = orphanRequestsTask(club);
      await createTask({ kind: "APPROVAL", title: t.title, description: t.description, href: t.href, assignee: { type: "ADMINS" }, clubId, source: { type: ORPHAN_REQUESTS_SOURCE, id: clubId } }, tx);
      await logActivity({ actorId: null, action: "staffing.requests_flagged", entityType: "club", entityId: clubId, clubId, data: { waitingSince: oldestPendingAt!.toISOString() } }, tx);
      return "flagged" as const;
    });
    if (result) out[result]++;
  }
  return out;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export type LastSeat = { clubId: string; clubName: string; clubSlug: string; clubStatus: ClubStatus; role: "PRESIDENT" | "ADVISOR" };

/**
 * The clubs where this person is the only current President or the only
 * current advisor: what their graduation or deactivation would leave empty.
 * Retired and rejected clubs aren't listed. Sorted by club name.
 */
export async function lastLeaderSeats(userId: string): Promise<LastSeat[]> {
  const mine = await db.roleAssignment.findMany({
    where: { userId, endedAt: null, role: { in: ["PRESIDENT", "ADVISOR"] }, club: { status: { notIn: ["RETIRED", "REJECTED"] } } },
    select: { role: true, clubId: true, club: { select: { name: true, slug: true, status: true } } },
  });
  if (!mine.length) return [];
  const others = await db.roleAssignment.groupBy({
    by: ["clubId", "role"],
    where: { clubId: { in: mine.map((m) => m.clubId) }, role: { in: ["PRESIDENT", "ADVISOR"] }, endedAt: null, userId: { not: userId } },
    _count: { _all: true },
  });
  const seen = new Set<string>();
  const out: LastSeat[] = [];
  for (const m of mine) {
    const key = `${m.clubId}:${m.role}`;
    if (seen.has(key) || others.some((o) => o.clubId === m.clubId && o.role === m.role)) continue;
    seen.add(key);
    out.push({ clubId: m.clubId, clubName: m.club.name, clubSlug: m.club.slug, clubStatus: m.club.status, role: m.role as LastSeat["role"] });
  }
  return out.sort((a, b) => a.clubName.localeCompare(b.clubName) || a.role.localeCompare(b.role));
}
