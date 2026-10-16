"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import type { CohostStatus } from "@prisma/client";
import { CalendarPlus, Check, Handshake, Lightbulb, Loader2, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/misc";
import { fmtDate, fmtRange } from "@/lib/time";
import { addIdeaAction, decideCohostAction, deleteEventAction, updateIdeaAction } from "@/app/events/actions";

export type IdeaRow = { id: string; title: string; notes: string; createdByName: string; createdAt: string };

export type IncomingCohost = {
  id: string;
  status: CohostStatus;
  eventId: string;
  eventTitle: string;
  hostClubName: string;
  hostClubColor: string;
  next: { startsAt: string; endsAt: string; allDay: boolean } | null;
  scheduleLabel: string;
  requestedByName: string;
};

export type OutgoingCohost = {
  eventId: string;
  eventTitle: string;
  nextStartsAt: string | null;
  all: boolean;
  cohosts: { id: string; clubName: string; status: CohostStatus }[];
};

const COHOST_TONE: Record<CohostStatus, "warning" | "success" | "danger"> = { PENDING: "warning", APPROVED: "success", DECLINED: "danger" };
const COHOST_LABEL: Record<CohostStatus, string> = { PENDING: "Waiting", APPROVED: "Accepted", DECLINED: "Declined" };

// ─── Ideas ───────────────────────────────────────────────────────────────────

export function IdeasPanel({
  clubId,
  ideas,
  basePath,
  onSchedule,
}: {
  clubId: string | null;
  ideas: IdeaRow[];
  basePath: string;
  onSchedule: (idea: IdeaRow) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [adding, startAdding] = useTransition();
  const [editing, setEditing] = useState<IdeaRow | null>(null);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    startAdding(async () => {
      const res = await addIdeaAction({ clubId, title: title.trim(), notes });
      if (!res.ok) return void toast.error(res.error);
      setTitle("");
      setNotes("");
      setShowNotes(false);
      toast.success("Idea saved");
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="space-y-2" aria-label="Add an idea">
        <Label htmlFor={`${id}-t`} className="sr-only">
          New idea
        </Label>
        <div className="flex gap-2">
          <Input id={`${id}-t`} value={title} maxLength={140} placeholder="Jot down an idea…" onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" disabled={adding || !title.trim()} aria-label="Add idea">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        {showNotes ? (
          <Textarea aria-label="Notes" rows={3} maxLength={5000} value={notes} placeholder="Notes: who to ask, rough budget, links…" onChange={(e) => setNotes(e.target.value)} />
        ) : (
          <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setShowNotes(true)}>
            + Add notes
          </button>
        )}
      </form>

      {ideas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-2 px-4 py-6 text-center">
          <Lightbulb className="mx-auto mb-2 h-6 w-6 text-ink-3" aria-hidden />
          <p className="text-sm font-medium text-ink">No ideas yet</p>
          <p className="mt-1 text-xs text-ink-3">Keep a running list — a guest speaker, a social, a service day — and add it to the calendar when it&apos;s ready.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {ideas.map((idea) => (
            <li key={idea.id} className="rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-card)]">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug text-ink">{idea.title}</p>
                  {idea.notes ? <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-ink-3">{idea.notes}</p> : null}
                  <p className="mt-1 text-[11px] text-ink-3">
                    {idea.createdByName} · {fmtDate(idea.createdAt, "MMM d")}
                  </p>
                </div>
                <IdeaMenu idea={idea} basePath={basePath} onEdit={() => setEditing(idea)} />
              </div>
              <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={() => onSchedule(idea)}>
                <CalendarPlus className="h-4 w-4" /> Add to calendar
              </Button>
            </li>
          ))}
        </ul>
      )}

      <EditIdeaDialog idea={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function IdeaMenu({ idea, basePath, onEdit }: { idea: IdeaRow; basePath: string; onEdit: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More for ${idea.title}`} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="h-4 w-4" /> Edit idea
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`${basePath}/${idea.id}`}>
              <CalendarPlus className="h-4 w-4" /> Open in full editor
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem danger onSelect={() => setConfirm(true)}>
            <Trash2 className="h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this idea?"
        description={`“${idea.title}” will be removed from the list.`}
        confirmLabel="Delete"
        danger
        onConfirm={() =>
          start(async () => {
            const res = await deleteEventAction(idea.id);
            if (res.ok) toast.success("Idea deleted");
            else toast.error(res.error);
          })
        }
      />
    </>
  );
}

function EditIdeaDialog({ idea, onClose }: { idea: IdeaRow | null; onClose: () => void }) {
  const id = useId();
  const [pending, start] = useTransition();
  return (
    <Dialog open={idea !== null} onOpenChange={(o) => !o && onClose()}>
      {idea ? (
        <DialogContent title="Edit idea">
          <form
            key={idea.id}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              start(async () => {
                const res = await updateIdeaAction(idea.id, { title: String(f.get("title") ?? ""), notes: String(f.get("notes") ?? "") });
                if (!res.ok) return void toast.error(res.error);
                toast.success("Idea updated");
                onClose();
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-t`}>Title</Label>
              <Input id={`${id}-t`} name="title" defaultValue={idea.title} required maxLength={140} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-n`}>Notes</Label>
              <Textarea id={`${id}-n`} name="notes" defaultValue={idea.notes} rows={5} maxLength={5000} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

// ─── Co-host requests ────────────────────────────────────────────────────────

export function CohostPanel({ incoming, outgoing, basePath }: { incoming: IncomingCohost[]; outgoing: OutgoingCohost[]; basePath: string }) {
  const pending = incoming.filter((c) => c.status === "PENDING");
  const accepted = incoming.filter((c) => c.status === "APPROVED");
  return (
    <div className="space-y-5">
      <section aria-labelledby="cohost-in">
        <h3 id="cohost-in" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
          Waiting on you {pending.length ? `(${pending.length})` : ""}
        </h3>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-2 px-3 py-4 text-center text-sm text-ink-3">No requests right now. When another club tags yours, it shows up here.</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((c) => (
              <IncomingCard key={c.id} c={c} />
            ))}
          </ul>
        )}
      </section>

      {accepted.length ? (
        <section aria-labelledby="cohost-yes">
          <h3 id="cohost-yes" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
            You&apos;re co-hosting
          </h3>
          <ul className="space-y-2">
            {accepted.map((c) => (
              <IncomingCard key={c.id} c={c} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="cohost-out">
        <h3 id="cohost-out" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
          Your invitations
        </h3>
        {outgoing.length === 0 ? (
          <p className="text-sm text-ink-3">Tag other clubs in an event&apos;s Co-hosts section to plan it together.</p>
        ) : (
          <ul className="space-y-2">
            {outgoing.map((o) => {
              const n = (s: CohostStatus) => o.cohosts.filter((c) => c.status === s).length;
              return (
                <li key={o.eventId} className="rounded-xl border border-line bg-surface p-3">
                  <Link href={`${basePath}/${o.eventId}#cohosts`} className="font-medium text-ink hover:underline">
                    {o.eventTitle}
                  </Link>
                  {o.nextStartsAt ? <p className="text-xs text-ink-3">Next: {fmtDate(o.nextStartsAt, "EEE, MMM d · h:mm a")}</p> : null}
                  {o.all ? (
                    <p className="mt-1.5 text-xs text-ink-2">
                      All clubs invited · {n("APPROVED")} accepted · {n("PENDING")} waiting · {n("DECLINED")} declined
                    </p>
                  ) : (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {o.cohosts.map((c) => (
                        <li key={c.id}>
                          <Badge tone={COHOST_TONE[c.status]}>
                            {c.clubName} · {COHOST_LABEL[c.status]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function IncomingCard({ c }: { c: IncomingCohost }) {
  const [pending, start] = useTransition();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const decide = (approve: boolean) =>
    start(async () => {
      const res = await decideCohostAction(c.id, approve);
      if (!res.ok) return void toast.error(res.error);
      toast.success(approve ? `“${c.eventTitle}” is on your calendar` : c.status === "APPROVED" ? "Removed from your calendar" : "Request declined");
    });
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.hostClubColor }} aria-hidden />
        <div className="min-w-0 flex-1">
          <Link href={`/events/${c.eventId}`} className="font-medium leading-snug text-ink hover:underline">
            {c.eventTitle}
          </Link>
          <p className="text-xs text-ink-3">Hosted by {c.hostClubName}</p>
          <p className="mt-1 text-xs text-ink-2">{c.next ? fmtRange(c.next.startsAt, c.next.endsAt, c.next.allDay) : "No upcoming meetings"}</p>
          {c.scheduleLabel ? <p className="text-xs text-ink-3">{c.scheduleLabel}</p> : null}
        </div>
      </div>
      {c.status === "PENDING" ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => decide(true)} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide(false)} disabled={pending}>
            <X className="h-4 w-4" /> Decline
          </Button>
        </div>
      ) : (
        <>
          <Button size="sm" variant="ghost" className="mt-1 text-ink-3" onClick={() => setConfirmLeave(true)} disabled={pending}>
            <Handshake className="h-4 w-4" /> Stop co-hosting
          </Button>
          <ConfirmDialog
            open={confirmLeave}
            onOpenChange={setConfirmLeave}
            title="Stop co-hosting?"
            description={`“${c.eventTitle}” comes off your club's calendar, and ${c.hostClubName} is told.`}
            confirmLabel="Stop co-hosting"
            danger
            onConfirm={() => decide(false)}
          />
        </>
      )}
    </li>
  );
}
