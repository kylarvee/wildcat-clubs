import "server-only";
import type { TaskKind } from "@prisma/client";
import { differenceInCalendarDays } from "date-fns";
import { CAPABILITIES, type Capability } from "@/lib/authz";
import { AWAITING_GRADE_LABEL } from "@/lib/authz/requirement-rules";
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
  /** "Due tomorrow", "Overdue · Oct 14" … (null while it waits for grading). */
  due: { label: string; overdue: boolean; soon: boolean; iso: string; dateInput: string } | null;
  /** Handed in on time and waiting for a grader: "Submitted — waiting for grading", shown instead of the due date. */
  waiting: string | null;
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
  /** WSUSA requires it: listed first and marked "Required by WSUSA". */
  required: boolean;
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
  const waiting = t.status === "OPEN" && t.awaitingGrade ? AWAITING_GRADE_LABEL : null;
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    description: t.description,
    // A link back to the task list itself isn't worth an "Open" button.
    href: t.href && !/^\/tasks(\?|$)/.test(t.href) ? t.href : null,
    status: t.status,
    club: t.club,
    due: t.status === "OPEN" && !waiting ? dueInfo(t.dueAt, now) : null,
    waiting,
    from: t.kind === "CLUB" && t.createdBy && t.createdById !== viewerId ? t.createdBy.name : null,
    forGroup: t.assigneeType === "CLUB" && t.kind === "CLUB" && cap ? `Everyone with ${cap}` : null,
    assigneeName: t.assigneeType === "USER" && t.assigneeId !== viewerId ? (t.assignee?.name ?? null) : t.assigneeType === "CLUB" && cap ? `Everyone with ${cap}` : null,
    completedLabel: done ? `Done ${fmtLongDate(t.completedAt!)}${t.completedBy && t.completedById !== viewerId ? ` by ${t.completedBy.name}` : ""}` : null,
    personal: t.kind === "PERSONAL" && t.assigneeId === viewerId,
    checkable: !SELF_CLOSING.includes(t.kind),
    required: t.required,
  };
}

/**
 * For short lists (the dashboard): join requests waiting in the same club
 * collapse into one row ("5 people asked to join Wildcat Robotics") that
 * opens the club's roster. Everything else, and the order, stays as is.
 */
export function groupJoinRequests(rows: TaskRow[], viewerId: string, now: Date): TaskItem[] {
  const isJoin = (t: TaskRow) => t.kind === "APPROVAL" && t.sourceType === "membership" && t.clubId && t.club;
  const perClub = new Map<string, number>();
  for (const t of rows) if (isJoin(t)) perClub.set(t.clubId!, (perClub.get(t.clubId!) ?? 0) + 1);
  const out: TaskItem[] = [];
  const done = new Set<string>();
  for (const t of rows) {
    const n = isJoin(t) ? perClub.get(t.clubId!)! : 0;
    if (n < 2) {
      out.push(toTaskItem(t, viewerId, now));
      continue;
    }
    if (done.has(t.clubId!)) continue;
    done.add(t.clubId!);
    out.push({ ...toTaskItem(t, viewerId, now), id: `join-requests:${t.clubId}`, title: `${n} people asked to join ${t.club!.name}`, description: null, href: `/clubs/${t.club!.slug}/manage/members` });
  }
  return out;
}
