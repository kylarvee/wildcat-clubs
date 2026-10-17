import { CheckCircle2, ListChecks } from "lucide-react";
import type { TaskRow } from "@/lib/domain/tasks";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/dashboard/Panel";
import { AddTaskForm } from "@/components/tasks/AddTaskForm";
import { TaskList } from "@/components/tasks/TaskList";
import { toTaskItem } from "@/components/tasks/items";

const SHOW = 6;

/**
 * The Task Manager, small: your soonest open tasks with their kind and due
 * date, a quick add for personal to-dos, and a link to the full list.
 */
export function TaskWidget({ tasks, viewerId, now }: { tasks: TaskRow[]; viewerId: string; now: Date }) {
  const items = tasks.map((t) => toTaskItem(t, viewerId, now));
  const shown = items.slice(0, SHOW);
  const overdue = items.filter((t) => t.due?.overdue).length;
  return (
    <Panel
      id="dash-tasks"
      title={
        <>
          Tasks
          {items.length ? <Badge tone="brand">{items.length} open</Badge> : null}
          {overdue ? <Badge tone="danger">{overdue} overdue</Badge> : null}
        </>
      }
      icon={<ListChecks />}
      link={{ href: "/tasks", label: items.length > SHOW ? `See all ${items.length}` : "See all" }}
    >
      <AddTaskForm compact className="mb-4" />
      {shown.length ? (
        <TaskList items={shown} compact />
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden /> You&apos;re all caught up. Approvals, officer requirements and tasks from your clubs land here.
        </p>
      )}
    </Panel>
  );
}
