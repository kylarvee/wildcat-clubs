"use client";

import { useEffect, useState } from "react";
import { Loader2, Send, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { PersonPicker, type PickerPerson } from "@/components/roles/PersonPicker";
import { useRunAction } from "@/components/roles/useRunAction";
import { assignClubTaskAction, assignableMembersAction } from "@/app/tasks/actions";

export type AssignClubOption = { id: string; name: string; roleLabel: string };
export type CapabilityOption = { value: string; label: string; description: string };

/**
 * Leaders hand a club to-do to one member, or to everyone in the club who
 * holds a permission (say, every budget officer). The person hears about it
 * and checks it off from their Task Manager.
 */
export function AssignTaskDialog({ clubs, capabilities, defaultClubId }: { clubs: AssignClubOption[]; capabilities: CapabilityOption[]; defaultClubId?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" aria-hidden /> Assign a club task
      </Button>
      {open ? <AssignForm clubs={clubs} capabilities={capabilities} defaultClubId={defaultClubId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AssignForm({ clubs, capabilities, defaultClubId, onClose }: { clubs: AssignClubOption[]; capabilities: CapabilityOption[]; defaultClubId?: string | null; onClose: () => void }) {
  const [clubId, setClubId] = useState(defaultClubId && clubs.some((c) => c.id === defaultClubId) ? defaultClubId : clubs.length === 1 ? clubs[0].id : "");
  const [who, setWho] = useState<"person" | "group">("person");
  const [people, setPeople] = useState<PickerPerson[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [capability, setCapability] = useState(capabilities[0]?.value ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const { pending, error, setError, run } = useRunAction();
  const club = clubs.find((c) => c.id === clubId) ?? null;

  // Members load per club, so the list only ever shows people in the club you picked.
  useEffect(() => {
    let live = true;
    setPeople(null);
    setPersonId(null);
    setLoadError(null);
    if (!clubId) return;
    void assignableMembersAction(clubId).then((r) => {
      if (!live) return;
      if (r.ok) setPeople(r.data);
      else setLoadError(r.error);
    });
    return () => {
      live = false;
    };
  }, [clubId]);

  async function save() {
    if (!clubId) return setError("Choose a club.");
    if (who === "person" && !personId) return setError("Choose who should do it.");
    if (!title.trim()) return setError("Give the task a title.");
    const r = await run(() => assignClubTaskAction({ clubId, assignee: who === "person" ? personId! : { capability }, title, description, dueAt }));
    if (r.ok) {
      toast.success(`Assigned to ${r.data.assigneeLabel}. They'll get a notification.`);
      onClose();
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent wide title="Assign a club task" description="The task shows in their Task Manager and they get a notification. You'll hear when it's done.">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {clubs.length > 1 ? (
            <Field label="Club" required>
              {(id) => (
                <Select id={id} value={clubId} onChange={(e) => setClubId(e.target.value)} required>
                  <option value="">Choose a club…</option>
                  {clubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.roleLabel})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : club ? (
            <p className="text-sm text-ink-2">
              Club: <span className="font-medium text-ink">{club.name}</span>
            </p>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink">Who should do it?</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="assign-who" className="h-4 w-4 accent-[var(--color-brand)]" checked={who === "person"} onChange={() => setWho("person")} />
                One member
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="assign-who" className="h-4 w-4 accent-[var(--color-brand)]" checked={who === "group"} onChange={() => setWho("group")} />
                Everyone with a permission
              </label>
            </div>
          </fieldset>

          {who === "person" ? (
            !clubId ? (
              <p className="text-sm text-ink-3">Choose a club to see its members.</p>
            ) : loadError ? (
              <Callout tone="danger">{loadError}</Callout>
            ) : !people ? (
              <p className="flex items-center gap-2 text-sm text-ink-3" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading members…
              </p>
            ) : (
              <PersonPicker people={people} value={personId} onChange={setPersonId} label="Member" emptyText={people.length ? "No one matches." : "This club has no active members yet."} maxHeight={220} />
            )
          ) : (
            <Field label="Permission" hint="Everyone who holds it right now gets the task; the first person to check it off closes it for all of them.">
              {(id) => (
                <Select id={id} value={capability} onChange={(e) => setCapability(e.target.value)}>
                  {capabilities.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <Field label="Task" required>
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder="e.g. Reconcile September spending" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label="Notes" hint="Optional. Anything they need to know.">
              {(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} />}
            </Field>
            <Field label="Due date" hint="Optional">
              {(id) => <Input id={id} type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />}
            </Field>
          </div>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              Assign task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
