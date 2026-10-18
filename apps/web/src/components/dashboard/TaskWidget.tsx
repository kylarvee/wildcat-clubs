import { CheckCircle2, ListChecks } from "lucide-react";
import type { TaskRow } from "@/lib/domain/tasks";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/dashboard/Panel";
import { AddTaskForm } from "@/components/tasks/AddTaskForm";
import { TaskList } from "@/components/tasks/TaskList";
import { groupJoinRequests } from "@/components/tasks/items";

const SHOW = 6;

/**
 * The Task Manager, small: what WSUSA requires first (listTasks sorts it
 * there), then your soonest open tasks, with join requests grouped per club,
 * a quick add for personal to-dos, and a link to the full list.
 */
export function TaskWidget({ tasks, viewerId, now, title = "Tasks", note }: { tasks: TaskRow[]; viewerId: string; now: Date; title?: string; note?: string }) {
  const items = groupJoinRequests(tasks, viewerId, now);
  const shown = items.slice(0, SHOW);
  const overdue = tasks.filter((t) => t.dueAt && t.dueAt < now).length;
  return (
    <Panel
      id="dash-tasks"
      title={
        <>
          {title}
          {overdue ? <Badge tone="danger">{overdue} overdue</Badge> : null}
        </>
      }
      icon={<ListChecks />}
      link={{ href: "/tasks", label: items.length > SHOW ? `See all ${tasks.length}` : "See all" }}
    >
      <AddTaskForm compact className="mb-4" />
      {shown.length ? (
        <TaskList items={shown} compact />
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden /> You&apos;re all caught up. Approvals, WSUSA requirements and tasks from your clubs land here.
        </p>
      )}
      {note ? <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">{note}</p> : null}
    </Panel>
  );
}
