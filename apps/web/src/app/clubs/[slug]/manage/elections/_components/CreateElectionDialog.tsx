"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { useRunAction } from "@/components/roles/useRunAction";
import { createElection } from "../actions";

export type ElectableSeat = { id: string; name: string; roleLabel: string; busy: boolean };

/** Start an election: which seat, a title, and when voting opens and closes (campus time). */
export function CreateElectionDialog({ slug, clubId, seats, defaultOpens, defaultCloses, termLabel }: { slug: string; clubId: string; seats: ElectableSeat[]; defaultOpens: string; defaultCloses: string; termLabel: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const firstFree = seats.find((s) => !s.busy);
  const [seatId, setSeatId] = useState(firstFree?.id ?? "");
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const [opens, setOpens] = useState(defaultOpens);
  const [closes, setCloses] = useState(defaultCloses);
  const { pending, error, setError, run } = useRunAction();
  const seat = seats.find((s) => s.id === seatId);
  const suggested = seat ? `${seat.name} election${termLabel ? ` — ${termLabel}` : ""}` : "";

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
      setTouched(false);
      setTitle("");
    }
  }

  async function submit() {
    if (!seatId) return setError("Choose the seat this election fills.");
    const r = await run(() => createElection(slug, { clubId, positionId: seatId, title: (touched ? title : suggested).trim(), votingOpensAt: opens, votingClosesAt: closes }), {
      success: "Election created. Nominations are open.",
    });
    if (r.ok) {
      reset(false);
      router.push(`/clubs/${slug}/manage/elections/${r.data.id}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button disabled={!firstFree}>
          <Plus className="h-4 w-4" aria-hidden /> New election
        </Button>
      </DialogTrigger>
      <DialogContent title="New election" description="Nominations open as soon as you create it and close when voting opens. Times are Ogden (campus) time.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Seat" required hint="Seats with an election already underway aren't available.">
            {(id) => (
              <Select id={id} value={seatId} onChange={(e) => setSeatId(e.target.value)} required>
                <option value="" disabled>
                  Choose a seat
                </option>
                {seats.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.busy}>
                    {s.name} ({s.roleLabel}){s.busy ? " — election underway" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Title" required>
            {(id) => (
              <Input
                id={id}
                value={touched ? title : suggested}
                onChange={(e) => {
                  setTouched(true);
                  setTitle(e.target.value);
                }}
                maxLength={120}
                required
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Voting opens" required>
              {(id) => <Input id={id} type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} required />}
            </Field>
            <Field label="Voting closes" required>
              {(id) => <Input id={id} type="datetime-local" value={closes} min={opens} onChange={(e) => setCloses(e.target.value)} required />}
            </Field>
          </div>
          <p className="text-xs text-ink-3">Members who can run get a heads-up now; voters are notified when voting opens. You can open or close voting early from the election page.</p>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => reset(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Create election
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
