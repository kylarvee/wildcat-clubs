import "server-only";
import type { ClubRole } from "@prisma/client";
import { db } from "@/lib/db";
import { requirementStatus } from "@/lib/authz/requirements";
import { createTask } from "@/lib/domain/tasks";
import { notify } from "@/lib/domain/notify";

/**
 * Opens REQUIREMENT tasks when someone takes a role that requires tests or
 * trainings. Task source id is `${requirementId}:${userId}` — the Test Tool
 * (on a passing attempt) and the Attendance Tool (on a training check-in)
 * resolve it with resolveTasks("requirement", `${requirementId}:${userId}`).
 */
export function requirementSourceId(requirementId: string, userId: string) {
  return `${requirementId}:${userId}`;
}

export async function openRequirementTasks(userId: string, role: ClubRole, ctx: { clubId: string; assignmentStartedAt: Date; clubApprovedAt: Date | null }) {
  const status = await requirementStatus(userId, role, { assignmentStartedAt: ctx.assignmentStartedAt, clubApprovedAt: ctx.clubApprovedAt });
  const opened: string[] = [];
  for (const item of status.items) {
    if (item.met) continue;
    const sourceId = requirementSourceId(item.requirement.id, userId);
    const existing = await db.task.findFirst({ where: { sourceType: "requirement", sourceId, status: "OPEN" } });
    if (existing) continue;
    const href =
      item.requirement.kind === "TEST" && item.requirement.testId
        ? `/tests/${item.requirement.testId}`
        : item.requirement.trainingEventId
          ? `/events/${item.requirement.trainingEventId}`
          : "/tasks";
    await createTask({
      kind: "REQUIREMENT",
      title: item.requirement.kind === "TEST" ? `Pass: ${item.requirement.name}` : `Attend: ${item.requirement.name}`,
      description: item.requirement.description ?? undefined,
      assignee: { type: "USER", userId },
      clubId: ctx.clubId,
      dueAt: item.dueAt,
      href,
      source: { type: "requirement", id: sourceId },
    });
    opened.push(item.requirement.name);
  }
  if (opened.length) {
    await notify({
      userIds: [userId],
      kind: "requirement.assigned",
      title: "Your new role has required training",
      body: `Finish ${opened.join(", ")} to keep your leadership permissions active.`,
      href: "/tasks",
    });
  }
}
