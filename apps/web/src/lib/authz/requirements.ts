import "server-only";
import { cache } from "react";
import type { ClubRole, RenewalPeriod, RoleRequirement } from "@prisma/client";
import { db } from "@/lib/db";
import { getTerms, currentOrLastTerm, academicYearAt } from "@/lib/terms";
import { TZ } from "@/lib/time";
import { detailsCurrent } from "@/lib/details/rules";
import { awaitingGrade, requirementState, type RequirementState } from "@/lib/authz/requirement-rules";
import { TZDate } from "@date-fns/tz";

/**
 * Requirements (tests, forms and trainings WSUSA sets for members and
 * student leaders). Fulfillment is computed from the Test Tool (passed
 * attempts; a submitted form counts as passed) and the Attendance Tool
 * (training check-ins) — never stored separately, so the gate can't disagree
 * with the records it's based on.
 *
 * Each requirement must be met within `graceDays` of the latest of: taking
 * the role (or joining, for MEMBER), the club's approval, the start of the
 * renewal period, and the day the requirement was added (so a new one never
 * starts out overdue). Past that a leader role's capabilities pause until
 * it's done (graceDays = 0 makes it a hard gate); members have nothing to pause.
 * A test handed in by the deadline that's waiting for a grader isn't overdue
 * (lib/authz/requirement-rules): nobody is paused over a grader's delay.
 */

export type RequirementItem = {
  requirement: Pick<RoleRequirement, "id" | "name" | "description" | "kind" | "testId" | "trainingEventId" | "renewal" | "graceDays">;
  met: boolean;
  /** Handed in by the deadline and waiting for a grader: not met yet, but not overdue either. */
  awaitingGrade: boolean;
  /** An attempt this period is waiting for a grader, on time or not. */
  gradingPending: boolean;
  periodStart: Date;
  dueAt: Date;
  overdue: boolean;
  state: RequirementState;
};

const activeRequirements = cache(async () => db.roleRequirement.findMany({ where: { active: true } }));

export async function periodStartFor(renewal: RenewalPeriod, at: Date): Promise<Date> {
  if (renewal === "NONE") return new Date(0);
  if (renewal === "ANNUAL") return new TZDate(new TZDate(at, TZ).getFullYear(), 0, 1, TZ);
  const terms = await getTerms();
  if (renewal === "SEMESTER") return currentOrLastTerm(terms, at)?.startsOn ?? new Date(0);
  return academicYearAt(terms, at)?.start ?? new Date(0);
}

export async function requirementStatus(
  userId: string,
  role: ClubRole,
  ctx: { assignmentStartedAt: Date; clubApprovedAt: Date | null; at?: Date },
): Promise<{ items: RequirementItem[]; overdue: boolean; allMet: boolean }> {
  const at = ctx.at ?? new Date();
  const reqs = (await activeRequirements()).filter((r) => r.appliesTo.includes(role));
  const items: RequirementItem[] = [];
  for (const r of reqs) {
    const periodStart = await periodStartFor(r.renewal, at);
    const clock = Math.max(ctx.assignmentStartedAt.getTime(), ctx.clubApprovedAt?.getTime() ?? 0, periodStart.getTime(), r.createdAt.getTime());
    const dueAt = new Date(clock + r.graceDays * 86_400_000);
    let met = false;
    let waiting = false;
    let gradingPending = false;
    if (r.kind === "TEST" && r.testId) {
      // Passed this period, or handed in and waiting for a grader.
      const attempts = await db.testAttempt.findMany({
        where: { testId: r.testId, userId, submittedAt: { gte: periodStart }, OR: [{ passed: true }, { status: "NEEDS_REVIEW" }] },
        select: { status: true, passed: true, submittedAt: true },
      });
      met = attempts.some((a) => a.passed);
      gradingPending = !met && attempts.some((a) => a.status === "NEEDS_REVIEW");
      waiting = !met && awaitingGrade(attempts, dueAt);
    } else if (r.kind === "TRAINING" && r.trainingEventId) {
      met =
        (await db.attendance.count({
          where: { userId, checkedInAt: { gte: periodStart }, occurrence: { eventId: r.trainingEventId } },
        })) > 0;
    } else if (r.kind === "PROFILE") {
      // Member details: complete and confirmed this period (Settings → Member details).
      const u = await db.user.findUnique({ where: { id: userId }, select: { kind: true, details: true } });
      met = Boolean(u && detailsCurrent(u.details, u.kind, periodStart));
    }
    const state = requirementState({ met, awaitingGrade: waiting, dueAt, at });
    items.push({ requirement: r, met, awaitingGrade: waiting, gradingPending, periodStart, dueAt, overdue: state === "overdue", state });
  }
  return { items, overdue: items.some((i) => i.overdue), allMet: items.every((i) => i.met) };
}

type TaskLike = { id: string; status: string; sourceType: string | null; sourceId: string | null; assigneeId: string | null; dueAt: Date | null };

/**
 * Open requirement and test tasks whose attempt was handed in by the task's
 * deadline and is waiting for a grader (the rule above, and
 * tests.markMissedAssignments for test assignments). They aren't overdue:
 * every list shows them as "Submitted — waiting for grading". Returns their ids.
 */
export async function tasksAwaitingGrade(tasks: readonly TaskLike[], at: Date = new Date()): Promise<Set<string>> {
  const out = new Set<string>();
  const open = tasks.filter((t) => t.status === "OPEN" && t.assigneeId && t.sourceId && (t.sourceType === "requirement" || t.sourceType === "testAssignment"));
  if (!open.length) return out;
  const attempts = await db.testAttempt.findMany({
    where: { status: "NEEDS_REVIEW", userId: { in: [...new Set(open.map((t) => t.assigneeId!))] } },
    select: { testId: true, userId: true, cycleKey: true, status: true, submittedAt: true },
  });
  if (!attempts.length) return out;
  const waitingUsers = new Set(attempts.map((a) => a.userId));
  const candidates = open.filter((t) => waitingUsers.has(t.assigneeId!));
  const reqIds = [...new Set(candidates.filter((t) => t.sourceType === "requirement").map((t) => t.sourceId!.split(":")[0]))];
  const assignmentIds = candidates.filter((t) => t.sourceType === "testAssignment").map((t) => t.sourceId!);
  const [reqs, assignments] = await Promise.all([
    reqIds.length ? db.roleRequirement.findMany({ where: { id: { in: reqIds }, kind: "TEST", testId: { not: null } }, select: { id: true, testId: true, renewal: true } }) : [],
    assignmentIds.length ? db.testAssignment.findMany({ where: { id: { in: assignmentIds } }, select: { id: true, testId: true, cycleKey: true, dueAt: true } }) : [],
  ]);
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const starts = new Map<RenewalPeriod, Date>();
  for (const t of candidates) {
    if (t.sourceType === "requirement") {
      const r = reqById.get(t.sourceId!.split(":")[0]);
      if (!r) continue;
      if (!starts.has(r.renewal)) starts.set(r.renewal, await periodStartFor(r.renewal, at));
      const since = starts.get(r.renewal)!;
      const mine = attempts.filter((a) => a.userId === t.assigneeId && a.testId === r.testId && a.submittedAt && a.submittedAt >= since);
      if (awaitingGrade(mine, t.dueAt)) out.add(t.id);
    } else {
      const a = assignmentById.get(t.sourceId!);
      if (!a) continue;
      const mine = attempts.filter((x) => x.userId === t.assigneeId && x.testId === a.testId && x.cycleKey === a.cycleKey);
      if (awaitingGrade(mine, a.dueAt)) out.add(t.id);
    }
  }
  return out;
}
