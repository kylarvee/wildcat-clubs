"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Hourglass, Loader2, MoreHorizontal, Pencil, ShieldAlert, Trash2, Undo2, UserRound, Users, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClubLogo } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/misc";
import { PersonalTaskDialog } from "@/components/tasks/PersonalTaskDialog";
import { KIND_LABEL, KIND_TONE, REQUIRED_LABEL, SELF_CLOSING_NOTE } from "@/components/tasks/labels";
import { cancelClubTaskAction, deletePersonalTaskAction, setTaskDoneAction } from "@/app/tasks/actions";
import type { TaskItem } from "@/components/tasks/items";

/**
 * A list of tasks. "inbox" rows can be checked off (personal and club tasks)
 * or opened; "assigned" rows are club tasks you handed out, which you can
 * withdraw while they're open. Compact rows are for the dashboard widget.
 */
export function TaskList({
  items,
  mode = "inbox",
  compact = false,
  showClub = true,
  className,
}: {
  items: TaskItem[];
  mode?: "inbox" | "assigned";
  compact?: boolean;
  showClub?: boolean;
  className?: string;
}) {
  // Rows checked off here disappear right away; the server list catches up on refresh.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = items.filter((t) => !hidden.has(t.id));
  const hide = (id: string, on: boolean) =>
    setHidden((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <ul className={cn("divide-y divide-line", className)}>
      {visible.map((t) => (
        <TaskRowView key={t.id} task={t} mode={mode} compact={compact} showClub={showClub} onHide={(on) => hide(t.id, on)} />
      ))}
    </ul>
  );
}

function TaskRowView({ task, mode, compact, showClub, onHide }: { task: TaskItem; mode: "inbox" | "assigned"; compact: boolean; showClub: boolean; onHide: (on: boolean) => void }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "withdraw">(null);
  const done = task.status === "DONE";
  const note = SELF_CLOSING_NOTE[task.kind];

  function toggle(next: boolean) {
    // Leaving the current tab (open → done or back) hides the row at once.
    onHide(true);
    start(async () => {
      const r = await setTaskDoneAction(task.id, next);
      if (!r.ok) {
        onHide(false);
        toast.error(r.error);
        return;
      }
      toast.success(next ? `Done: ${task.title}` : `Moved back to open: ${task.title}`, {
        action: {
          label: "Undo",
          onClick: () =>
            void setTaskDoneAction(task.id, !next).then((u) => {
              if (u.ok) onHide(false);
              else toast.error(u.error);
            }),
        },
      });
    });
  }

  function remove() {
    onHide(true);
    start(async () => {
      const r = mode === "assigned" ? await cancelClubTaskAction(task.id) : await deletePersonalTaskAction(task.id);
      if (r.ok) toast.success(mode === "assigned" ? "Task withdrawn." : "Task deleted.");
      else {
        onHide(false);
        toast.error(r.error);
      }
    });
  }

  const titleId = `task-${task.id}-title`;
  const canCheck = mode === "inbox" && task.checkable;

  return (
    <li className={cn("flex gap-3", compact ? "py-3" : "py-4", "first:pt-0 last:pb-0")} aria-labelledby={titleId}>
      <div className="pt-0.5">
        {canCheck ? (
          <input
            type="checkbox"
            className="h-5 w-5 cursor-pointer rounded border-line-2 accent-[var(--color-brand)] disabled:cursor-wait"
            checked={done}
            disabled={pending}
            onChange={(e) => toggle(e.target.checked)}
            aria-label={done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” done`}
          />
        ) : mode === "assigned" ? (
          <span className="flex h-5 w-5 items-center justify-center text-ink-3" aria-hidden>
            {task.assigneeName?.startsWith("Everyone") ? <Users className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
          </span>
        ) : done ? (
          <span className="flex h-5 w-5 items-center justify-center text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            <span className="sr-only">Done</span>
          </span>
        ) : (
          <span className={cn("flex h-5 w-5 items-center justify-center", task.required ? "text-danger" : "text-ink-3")} title={note}>
            {task.required ? <ShieldAlert className="h-4 w-4" aria-hidden /> : <Hourglass className="h-4 w-4" aria-hidden />}
            {/* The full rows spell the note out below; compact rows only have this. */}
            {compact ? <span className="sr-only">{note}</span> : null}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p id={titleId} className={cn("min-w-0 font-medium text-ink [overflow-wrap:anywhere]", done && "text-ink-3 line-through decoration-ink-3/60", compact && "text-sm")}>
            {task.href && !compact ? (
              <Link href={task.href} className="hover:text-brand-600 hover:underline">
                {task.title}
              </Link>
            ) : (
              task.title
            )}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {task.href ? (
              compact ? (
                <Link href={task.href} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand">
                  Open<span className="sr-only"> {task.title}</span> <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              ) : (
                <Link href={task.href} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-brand-600 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand">
                  Open<span className="sr-only"> {task.title}</span> <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )
            ) : null}
            {pending ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-label="Saving" /> : null}
            {mode === "inbox" && task.personal && !compact ? (
              // Non-modal, so opening the edit or delete dialog from it doesn't leave the page unclickable.
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More for “${task.title}”`} disabled={pending}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil className="h-4 w-4" aria-hidden /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem danger onSelect={() => setConfirm("delete")}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {mode === "assigned" && task.status === "OPEN" ? (
              <Button variant="ghost" size="sm" className="text-ink-2" onClick={() => setConfirm("withdraw")} disabled={pending}>
                <XCircle className="h-4 w-4" aria-hidden /> Withdraw
              </Button>
            ) : null}
            {mode === "inbox" && done && task.checkable && !compact ? (
              <Button variant="ghost" size="sm" className="text-ink-2" onClick={() => toggle(false)} disabled={pending}>
                <Undo2 className="h-4 w-4" aria-hidden /> Reopen
              </Button>
            ) : null}
          </div>
        </div>

        {task.description && !compact ? <p className="mt-1 whitespace-pre-line text-sm text-ink-2 [overflow-wrap:anywhere]">{task.description}</p> : null}

        <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-3", compact ? "mt-1" : "mt-2")}>
          {task.required ? (
            <Badge tone="danger" className="font-semibold">
              {compact ? "Required" : REQUIRED_LABEL}
            </Badge>
          ) : (
            <Badge tone={KIND_TONE[task.kind]}>{KIND_LABEL[task.kind]}</Badge>
          )}
          {showClub && task.club ? (
            <Link href={`/clubs/${task.club.slug}`} className="inline-flex min-w-0 items-center gap-1.5 hover:text-brand-600 hover:underline">
              <ClubLogo name={task.club.name} src={task.club.logoUrl} color={task.club.logoColor} size="sm" className="h-4 w-4 rounded text-[8px]" />
              <span className="truncate">{task.club.name}</span>
            </Link>
          ) : null}
          {task.due ? (
            <span className={cn("inline-flex items-center gap-1", task.due.overdue ? "font-medium text-danger" : task.due.soon ? "font-medium text-warning" : "")}>
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              <time dateTime={task.due.iso}>{task.due.label}</time>
            </span>
          ) : null}
          {task.from ? <span>From {task.from}</span> : null}
          {task.forGroup && mode === "inbox" ? <span>{task.forGroup}</span> : null}
          {mode === "assigned" && task.assigneeName ? <span>For {task.assigneeName}</span> : null}
          {task.completedLabel ? <span>{task.completedLabel}</span> : null}
        </div>

        {note && mode === "inbox" && !compact && task.status === "OPEN" ? <p className="mt-1.5 text-xs text-ink-3">{note}</p> : null}
      </div>

      {editing ? <PersonalTaskDialog task={task} onClose={() => setEditing(false)} /> : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => (!o ? setConfirm(null) : null)}
        title={confirm === "withdraw" ? `Withdraw “${task.title}”?` : `Delete “${task.title}”?`}
        description={confirm === "withdraw" ? "It comes off their task list right away. They won't get a notification about it." : "It's gone for good — there's no undo."}
        confirmLabel={confirm === "withdraw" ? "Withdraw task" : "Delete"}
        danger
        onConfirm={() => {
          setConfirm(null);
          remove();
        }}
      />
    </li>
  );
}
