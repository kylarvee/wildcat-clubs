"use client";

import { useRef, useState } from "react";
import { CalendarPlus, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input, Textarea } from "@/components/ui/form";
import { useRunAction } from "@/components/roles/useRunAction";
import { addPersonalTaskAction } from "@/app/tasks/actions";

/**
 * Add a personal to-do inline. Type a title and press Enter; notes and a due
 * date are one click away. The compact version (dashboard) keeps to one row
 * plus an optional due date.
 */
export function AddTaskForm({ compact = false, className }: { compact?: boolean; className?: string }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [more, setMore] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const { pending, error, run } = useRunAction();
  const base = compact ? "dash-add-task" : "add-task";

  async function add() {
    if (!title.trim()) {
      titleRef.current?.focus();
      return;
    }
    const r = await run(() => addPersonalTaskAction({ title, description, dueAt }), { success: "Task added." });
    if (r.ok) {
      setTitle("");
      setDescription("");
      setDueAt("");
      setMore(false);
      titleRef.current?.focus();
    }
  }

  return (
    <form
      className={cn("space-y-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
      aria-label="Add a personal task"
    >
      <div className="flex gap-2">
        <label htmlFor={`${base}-title`} className="sr-only">
          New task
        </label>
        <Input
          ref={titleRef}
          id={`${base}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={compact ? "Add a to-do…" : "Add a personal to-do — e.g. Email the speaker about parking"}
          maxLength={200}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${base}-error` : undefined}
          className={compact ? "h-9" : undefined}
        />
        {!more ? (
          <Button variant="outline" size={compact ? "sm" : "md"} className={cn("shrink-0", compact ? "h-9 w-9 px-0" : "")} onClick={() => setMore(true)} aria-label="Add a due date or notes">
            <CalendarPlus className="h-4 w-4" aria-hidden />
            {compact ? null : <span className="hidden sm:inline">Due date &amp; notes</span>}
          </Button>
        ) : null}
        <Button type="submit" size={compact ? "sm" : "md"} className={cn("shrink-0", compact ? "h-9" : "")} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          Add
        </Button>
      </div>
      {more ? (
        <div className={cn("grid gap-2", compact ? "" : "sm:grid-cols-[minmax(0,1fr)_12rem]")}>
          {compact ? null : (
            <div>
              <label htmlFor={`${base}-notes`} className="sr-only">
                Notes
              </label>
              <Textarea id={`${base}-notes`} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} placeholder="Notes (optional)" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor={`${base}-due`} className="shrink-0 text-sm text-ink-2">
              Due
            </label>
            <Input id={`${base}-due`} type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={compact ? "h-9" : undefined} />
          </div>
        </div>
      ) : null}
      {error ? (
        <p id={`${base}-error`} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
