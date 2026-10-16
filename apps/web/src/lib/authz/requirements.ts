import "server-only";
import { cache } from "react";
import type { ClubRole, RenewalPeriod, RoleRequirement } from "@prisma/client";
import { db } from "@/lib/db";
import { getTerms, currentOrLastTerm, academicYearAt } from "@/lib/terms";
import { TZ } from "@/lib/time";
import { TZDate } from "@date-fns/tz";

/**
 * Officer requirements (tests and trainings set by admins).
 * Fulfillment is computed from the Test Tool (passed attempts) and the
 * Attendance Tool (training check-ins) — never stored separately, so the gate
 * can't disagree with the records it's based on.
 *
 * Each requirement must be met within `graceDays` of the later of: taking the
 * role, the club's approval, or the start of the renewal period. Past that the
 * role's capabilities pause until it's done (graceDays = 0 makes it a hard gate).
 */

export type RequirementItem = {
  requirement: Pick<RoleRequirement, "id" | "name" | "description" | "kind" | "testId" | "trainingEventId" | "renewal" | "graceDays">;
  met: boolean;
  periodStart: Date;
  dueAt: Date;
  overdue: boolean;
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
    let met = false;
    if (r.kind === "TEST" && r.testId) {
      met = (await db.testAttempt.count({ where: { testId: r.testId, userId, passed: true, submittedAt: { gte: periodStart } } })) > 0;
    } else if (r.kind === "TRAINING" && r.trainingEventId) {
      met =
        (await db.attendance.count({
          where: { userId, checkedInAt: { gte: periodStart }, occurrence: { eventId: r.trainingEventId } },
        })) > 0;
    }
    const clock = Math.max(ctx.assignmentStartedAt.getTime(), ctx.clubApprovedAt?.getTime() ?? 0, periodStart.getTime());
    const dueAt = new Date(clock + r.graceDays * 86_400_000);
    items.push({ requirement: r, met, periodStart, dueAt, overdue: !met && at > dueAt });
  }
  return { items, overdue: items.some((i) => i.overdue), allMet: items.every((i) => i.met) };
}
