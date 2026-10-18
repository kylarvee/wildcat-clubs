"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { PersonPicker } from "@/components/roles/PersonPicker";
import { PermissionChecklist } from "@/components/roles/PermissionChecklist";
import { RequirementList } from "@/components/roles/RequirementList";
import { useRunAction } from "@/components/roles/useRunAction";
import { assignToSeat } from "../actions";
import type { PickerPerson, RequirementLike, SeatInfo, ToolContext } from "./types";

type Step = "person" | "permissions" | "review";

/**
 * Put someone in a seat: pick an active member → set their permissions
 * (officers and ambassadors; pre-filled from the seat's defaults) → see the
 * WSUSA requirements that come with it → choose who they replace if the
 * seat is full → confirm.
 */
export function AssignDialog({ ctx, seat, people, requirements }: { ctx: ToolContext; seat: SeatInfo; people: PickerPerson[]; requirements: RequirementLike[] }) {
  const customizable = seat.role === "OFFICER" || seat.role === "AMBASSADOR";
  const steps: Step[] = customizable ? ["person", "permissions", "review"] : ["person", "review"];
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("person");
  const [personId, setPersonId] = useState<string | null>(null);
  const [perms, setPerms] = useState<string[]>(seat.defaultPermissions);
  const [replace, setReplace] = useState<string[]>([]);
  const { pending, error, setError, run } = useRunAction();

  const holderIds = new Set(seat.holders.map((h) => h.userId));
  const pickable = people.map((p) => (holderIds.has(p.id) ? { ...p, disabledReason: `Already ${seat.name}` } : p));
  const person = people.find((p) => p.id === personId) ?? null;
  const first = person?.name.split(" ")[0] ?? "They";
  const needToReplace = Math.max(0, seat.holders.length - seat.maxHolders + 1);
  const index = steps.indexOf(step);
  const permLabels = ctx.capabilities.filter((c) => perms.includes(c.key)).map((c) => c.label);

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setStep("person");
      setPersonId(null);
      setPerms(seat.defaultPermissions);
      setReplace([]);
      setError(null);
    }
  }

  async function confirm() {
    if (!personId) return;
    const r = await run(
      () => assignToSeat(ctx.slug, { clubId: ctx.clubId, userId: personId, positionId: seat.id, permissions: customizable ? perms : undefined, replaceAssignmentIds: replace }),
      { success: `${person?.name ?? "They"} is now ${seat.name}.` },
    );
    if (r.ok) reset(false);
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="w-full">
          <UserPlus className="h-4 w-4" aria-hidden />
          {seat.holders.length === 0 ? `Assign ${seat.name}` : seat.holders.length >= seat.maxHolders ? "Replace or assign" : "Add someone"}
        </Button>
      </DialogTrigger>
      <DialogContent title={`Assign ${seat.name}`} description={`Step ${index + 1} of ${steps.length} · ${ctx.clubName}`}>
        <ol className="mb-5 flex gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <li key={s} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-brand" : "bg-muted"}`} />
          ))}
        </ol>

        {step === "person" ? (
          <PersonPicker
            people={pickable}
            value={personId}
            onChange={setPersonId}
            label="Who's taking this seat?"
            emptyText="No active student members yet. People join from the club page, or by checking in at an event."
          />
        ) : null}

        {step === "permissions" ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              What can <strong>{first}</strong> do as {seat.name}? These start from the seat&apos;s defaults. Presidents and vice presidents always have everything; you can change these any time.
            </p>
            <PermissionChecklist options={ctx.capabilities} value={perms} onChange={setPerms} legend="Tool permissions" />
          </div>
        ) : null}

        {step === "review" && person ? (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-xl border border-line bg-muted/40 p-3">
              <Avatar name={person.name} src={person.avatarUrl} color={person.avatarColor} />
              <div className="min-w-0">
                <p className="font-medium text-ink">{person.name}</p>
                <p className="text-sm text-ink-2">becomes {seat.name}</p>
              </div>
            </div>

            {customizable ? (
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink">Permissions</p>
                {permLabels.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {permLabels.map((l) => (
                      <Badge key={l} tone="brand">
                        {l}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-ink-3">No tool permissions — {first} keeps member features and the title.</p>
                )}
              </div>
            ) : null}

            {needToReplace > 0 ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-ink">
                  {seat.name} is full ({seat.holders.length} of {seat.maxHolders}). Who does {first} replace?
                </legend>
                <div className="space-y-2 rounded-xl border border-line p-3">
                  {seat.holders.map((h) => (
                    <Checkbox
                      key={h.assignmentId}
                      label={h.name}
                      checked={replace.includes(h.assignmentId)}
                      onChange={(e) => setReplace((cur) => (e.target.checked ? [...cur, h.assignmentId] : cur.filter((x) => x !== h.assignmentId)))}
                    />
                  ))}
                </div>
                <p className="text-xs text-ink-3">Their role ends today (recorded as a hand-off) and stays in the club&apos;s role history.</p>
              </fieldset>
            ) : null}

            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">WSUSA requirements that come with this role</p>
              <RequirementList requirements={requirements} roleLabel={seat.roleLabel} />
              {requirements.length ? <p className="mt-2 text-xs text-ink-3">Anything {first} has already completed counts automatically. They&apos;ll get a task for the rest.</p> : null}
            </div>
          </div>
        ) : null}

        {error ? (
          <Callout tone="danger" className="mt-4">
            {error}
          </Callout>
        ) : null}

        <DialogFooter>
          {index > 0 ? (
            <Button variant="ghost" onClick={() => setStep(steps[index - 1])} disabled={pending} className="mr-auto">
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => reset(false)} disabled={pending}>
            Cancel
          </Button>
          {step !== "review" ? (
            <Button onClick={() => setStep(steps[index + 1])} disabled={!personId}>
              Next <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button onClick={confirm} disabled={pending || replace.length < needToReplace}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Assign {first}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
