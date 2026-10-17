"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createGroupAction } from "@/app/messages/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { LeaderPicker, type PickedLeader } from "@/components/messages/LeaderPicker";
import { GROUP_MAX_MEMBERS, GROUP_TITLE_MAX_LENGTH } from "@/components/messages/format";

/** Start a named group chat with leaders of other clubs (leaders, advisors and admins only). */
export function NewGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New leader group" description="A group chat for leaders across clubs, like presidents planning a joint event. Only current club leaders and advisors can be added.">
        {open ? <GroupForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function GroupForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState<PickedLeader[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setTitleError("Name the group so everyone knows what it's for.");
      return;
    }
    if (!people.length) {
      setError("Add at least one other leader.");
      return;
    }
    setPending(true);
    try {
      const r = await createGroupAction({ title: title.trim(), memberIds: people.map((p) => p.id) });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(`“${title.trim()}” is ready.`);
      router.push(`/messages/${r.data.id}`);
      onDone();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Group name" required error={titleError} hint="For example: Engineering club presidents">
        {(id) => (
          <Input
            id={id}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleError(null);
            }}
            maxLength={GROUP_TITLE_MAX_LENGTH}
            autoFocus
            aria-invalid={titleError ? true : undefined}
          />
        )}
      </Field>
      <LeaderPicker value={people} onChange={setPeople} label="Who's in it" max={GROUP_MAX_MEMBERS - 1} />
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Creating…" : people.length ? `Create group (${people.length + 1} people)` : "Create group"}
        </Button>
      </DialogFooter>
    </form>
  );
}
