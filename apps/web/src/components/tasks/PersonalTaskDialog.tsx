"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { useRunAction } from "@/components/roles/useRunAction";
import { updatePersonalTaskAction } from "@/app/tasks/actions";
import type { TaskItem } from "@/components/tasks/items";

/** Edit one of your own to-dos: title, notes and due date. */
export function PersonalTaskDialog({ task, onClose }: { task: TaskItem; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [dueAt, setDueAt] = useState(task.due?.dateInput ?? "");
  const { pending, error, run } = useRunAction();

  async function save() {
    const r = await run(() => updatePersonalTaskAction(task.id, { title, description, dueAt }), { success: "Task saved." });
    if (r.ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent title="Edit task" description="Only you see your personal tasks.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Task" required>
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />}
          </Field>
          <Field label="Notes" hint="Optional">
            {(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} />}
          </Field>
          <Field label="Due date" hint="Optional. Due by the end of that day.">
            {(id) => <Input id={id} type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="max-w-[12rem]" />}
          </Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
