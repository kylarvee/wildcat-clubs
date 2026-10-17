import "server-only";
import type { TaskKind } from "@prisma/client";
import { differenceInCalendarDays } from "date-fns";
import { CAPABILITIES, type Capability } from "@/lib/authz";
import type { TaskRow } from "@/lib/domain/tasks";
import { fmtDate, fmtLongDate, inCampusTime } from "@/lib/time";
import { SELF_CLOSING } from "@/components/tasks/labels";

/**
 * Task rows as plain props for the client list (/tasks and the dashboard).
 * Due-date wording is worked out here, on the server, in campus time — so
 * "Due today" means today in Ogden and never flips during hydration.
 */

export type TaskItem = {
  id: string;
  kind: TaskKind;
  title: string;
  description: string | null;
  href: string | null;
  status: "OPEN" | "DONE" | "CANCELLED";
  club: { name: string; slug: string; logoColor: string; logoUrl: string | null } | null;
  /** "Due tomorrow", "Overdue · Oct 14" … */
  due: { label: string; overdue: boolean; soon: boolean; iso: string; dateInput: string } | null;
  /** Who handed you a club task ("From Priya Patel"). */
  from: string | null;
  /** Club tasks for a whole capability: "Everyone with Budget & funding". */
  forGroup: string | null;
  /** On tasks you assigned: who has it. */
  assigneeName: string | null;
  completedLabel: string | null;
  /** Your own to-do: edit and delete. */
  personal: boolean;
  /** PERSONAL and CLUB tasks are checked off by hand; the rest close themselves. */
  checkable: boolean;
};

export function dueInfo(dueAt: Date | null, now: Date): TaskItem["due"] {
  if (!dueAt) return null;
  const days = differenceInCalendarDays(inCampusTime(dueAt), inCampusTime(now));
  const overdue = dueAt.getTime() < now.getTime();
  const sameYear = inCampusTime(dueAt).getFullYear() === inCampusTime(now).getFullYear();
  const date = sameYear ? fmtDate(dueAt, "MMM d") : fmtLongDate(dueAt);
  let label: string;
  if (overdue) label = days === 0 ? "Overdue · was due today" : `Overdue · was due ${date}`;
  else if (days === 0) label = "Due today";
  else if (days === 1) label = "Due tomorrow";
  else if (days < 7) label = `Due ${fmtDate(dueAt, "EEEE")}`;
  else label = `Due ${date}`;
  return { label, overdue, soon: !overdue && days <= 2, iso: dueAt.toISOString(), dateInput: fmtDate(dueAt, "yyyy-MM-dd") };
}

export function toTaskItem(t: TaskRow, viewerId: string, now: Date): TaskItem {
  const cap = t.capability && t.capability in CAPABILITIES ? CAPABILITIES[t.capability as Capability].label : null;
  const done = t.status === "DONE" && t.completedAt;
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    description: t.description,
    // A link back to the task list itself isn't worth an "Open" button.
    href: t.href && !/^\/tasks(\?|$)/.test(t.href) ? t.href : null,
    status: t.status,
    club: t.club,
    due: t.status === "OPEN" ? dueInfo(t.dueAt, now) : null,
    from: t.kind === "CLUB" && t.createdBy && t.createdById !== viewerId ? t.createdBy.name : null,
    forGroup: t.assigneeType === "CLUB" && t.kind === "CLUB" && cap ? `Everyone with ${cap}` : null,
    assigneeName: t.assigneeType === "USER" && t.assigneeId !== viewerId ? (t.assignee?.name ?? null) : t.assigneeType === "CLUB" && cap ? `Everyone with ${cap}` : null,
    completedLabel: done ? `Done ${fmtLongDate(t.completedAt!)}${t.completedBy && t.completedById !== viewerId ? ` by ${t.completedBy.name}` : ""}` : null,
    personal: t.kind === "PERSONAL" && t.assigneeId === viewerId,
    checkable: !SELF_CLOSING.includes(t.kind),
  };
}
