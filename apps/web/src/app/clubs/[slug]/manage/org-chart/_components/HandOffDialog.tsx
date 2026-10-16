"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Crown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { PersonPicker } from "@/components/roles/PersonPicker";
import { useRunAction } from "@/components/roles/useRunAction";
import { handOff } from "../actions";
import type { PickerPerson, SeatHolderInfo, ToolContext } from "./types";

/**
 * Presidential hand-off: choose the successor → (optionally) step down to
 * alumni → a confirm screen that spells out what saving does → the successor
 * takes the seat in the same step the outgoing President's role ends.
 */
export function HandOffDialog({
  ctx,
  presidents,
  people,
  actorId,
}: {
  ctx: ToolContext;
  presidents: SeatHolderInfo[];
  people: PickerPerson[];
  actorId: string;
}) {
  const router = useRouter();
  const mine = presidents.find((p) => p.userId === actorId) ?? null;
  const defaultOutgoing = mine?.assignmentId ?? (presidents.length === 1 ? presidents[0].assignmentId : null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [outgoingId, setOutgoingId] = useState<string | null>(defaultOutgoing);
  const [successorId, setSuccessorId] = useState<string | null>(null);
  const [becomeAlumni, setBecomeAlumni] = useState(false);
  const { pending, error, setError, run } = useRunAction();

  const outgoing = presidents.find((p) => p.assignmentId === outgoingId) ?? null;
  const self = outgoing?.userId === actorId;
  const successor = people.find((p) => p.id === successorId) ?? null;
  const presidentIds = new Set(presidents.map((p) => p.userId));
  const pickable = people.map((p) => (presidentIds.has(p.id) ? { ...p, disabledReason: "Already President" } : p));

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setStep("choose");
      setOutgoingId(defaultOutgoing);
      setSuccessorId(null);
      setBecomeAlumni(false);
      setError(null);
    }
  }

  async function confirm() {
    if (!successorId || !outgoingId) return;
    const r = await run(() => handOff(ctx.slug, ctx.clubId, { successorId, becomeAlumni, outgoingAssignmentId: outgoingId }));
    if (r.ok) {
      toast.success(`${successor?.name ?? "Your successor"} is now President of ${ctx.clubName}.`);
      setOpen(false);
      // Stepping out of every leadership role closes the workspace for you.
      if (!r.data.actorStillLeads) router.push(`/clubs/${ctx.slug}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button>
          <Crown className="h-4 w-4" aria-hidden />
          {mine ? "Hand off the presidency" : "Hand off a presidency"}
        </Button>
      </DialogTrigger>
      <DialogContent title="Hand off the presidency" description={step === "choose" ? "Step 1 of 2 · Choose the next President" : "Step 2 of 2 · Confirm"}>
        {step === "choose" ? (
          <div className="space-y-5">
            {!mine && presidents.length > 1 ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-ink">Which President is handing off?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {presidents.map((p) => (
                    <label
                      key={p.assignmentId}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-brand-100",
                        outgoingId === p.assignmentId ? "border-brand bg-brand-50" : "border-line-2",
                      )}
                    >
                      <input type="radio" name="outgoing" className="accent-[var(--color-brand)]" checked={outgoingId === p.assignmentId} onChange={() => setOutgoingId(p.assignmentId)} />
                      {p.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <PersonPicker
              people={pickable}
              value={successorId}
              onChange={setSuccessorId}
              label="Who's the next President?"
              emptyText="There are no other active student members to hand off to yet."
            />

            <Checkbox
              label={self ? "I'm leaving this role and becoming an alumni member of the club" : `Move ${outgoing?.name ?? "the outgoing President"} to alumni membership`}
              description={self ? "Choose this if you're graduating or stepping away. Any other roles you hold here end too." : "Ends any other roles they hold in the club and marks them as alumni."}
              checked={becomeAlumni}
              onChange={(e) => setBecomeAlumni(e.target.checked)}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <Callout tone="warning" title="Here's what saving does">
              <ul className="list-disc space-y-1 pl-4">
                <li>
                  <strong>{successor?.name}</strong> becomes President of {ctx.clubName} right away, with every permission.
                </li>
                <li>
                  {self ? "You lose your President permissions" : `${outgoing?.name} loses their President permissions`} as soon as you save.
                  {self ? " You can't undo this yourself." : ""}
                </li>
                {becomeAlumni ? (
                  <li>{self ? "Your" : `${outgoing?.name}'s`} membership becomes Alumni, and any other roles {self ? "you" : "they"} hold here end.</li>
                ) : (
                  <li>{self ? "You stay" : `${outgoing?.name} stays`} an active member of the club.</li>
                )}
                <li>{self ? "Your" : "Their"} time as President stays in the club&apos;s role history and on {self ? "your" : "their"} profile.</li>
              </ul>
            </Callout>
            {self ? <p className="text-sm text-ink-2">Thank you for leading {ctx.clubName}. Consider adding your projects to the role history so the next team can build on them.</p> : null}
          </div>
        )}

        {error ? (
          <Callout tone="danger" className="mt-4">
            {error}
          </Callout>
        ) : null}

        <DialogFooter>
          {step === "confirm" ? (
            <Button variant="ghost" className="mr-auto" onClick={() => setStep("choose")} disabled={pending}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => reset(false)} disabled={pending}>
            Cancel
          </Button>
          {step === "choose" ? (
            <Button onClick={() => setStep("confirm")} disabled={!successorId || !outgoingId}>
              Review <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button variant="danger" onClick={confirm} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save and hand off
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
