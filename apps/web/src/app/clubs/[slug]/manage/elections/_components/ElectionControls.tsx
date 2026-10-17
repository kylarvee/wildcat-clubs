"use client";

import { useState } from "react";
import { Ban, Loader2, Lock, Play, Trophy, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/layout";
import { PermissionChecklist, type CapabilityOption } from "@/components/roles/PermissionChecklist";
import { PersonPicker, type PickerPerson } from "@/components/roles/PersonPicker";
import { useRunAction } from "@/components/roles/useRunAction";
import { applyResult, cancel, closeVotingNow, nominateMember, openVotingNow, removeCandidate } from "../actions";

export function OpenVotingButton({ slug, electionId, disabled }: { slug: string; electionId: string; disabled?: boolean }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button disabled={disabled || pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          Open voting now
        </Button>
      }
      title="Close nominations and open voting?"
      description="The ballot locks and every eligible voter gets a notification. This can't be undone."
      confirmLabel="Open voting"
      onConfirm={() => {
        void run(() => openVotingNow(slug, electionId), { success: "Voting is open.", toastError: true });
      }}
    />
  );
}

export function CloseVotingButton({ slug, electionId }: { slug: string; electionId: string }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
          Close voting now
        </Button>
      }
      title="Close voting early?"
      description="No more ballots will be accepted, and candidates get the results."
      confirmLabel="Close voting"
      onConfirm={() => {
        void run(() => closeVotingNow(slug, electionId), { success: "Voting closed. Results are in.", toastError: true });
      }}
    />
  );
}

export function CancelElectionButton({ slug, electionId }: { slug: string; electionId: string }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" className="text-danger hover:bg-danger-50" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Ban className="h-4 w-4" aria-hidden />}
          Cancel election
        </Button>
      }
      title="Cancel this election?"
      description="No result will be applied and candidates are told. Any ballots already cast stay secret and are never counted."
      confirmLabel="Cancel election"
      cancelLabel="Keep it"
      danger
      onConfirm={() => {
        void run(() => cancel(slug, electionId), { success: "Election cancelled.", toastError: true });
      }}
    />
  );
}

/** Organizers nominate an eligible member (they're notified and can withdraw). */
export function NominateDialog({ slug, electionId, people }: { slug: string; electionId: string; people: PickerPerson[] }) {
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);
  const { pending, error, setError, run } = useRunAction();
  const person = people.find((p) => p.id === personId);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPersonId(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <UserPlus className="h-4 w-4" aria-hidden /> Nominate someone
        </Button>
      </DialogTrigger>
      <DialogContent title="Nominate a member" description="They'll get a notification to add a statement, or withdraw if they'd rather not run.">
        <PersonPicker people={people} value={personId} onChange={setPersonId} label="Who are you nominating?" emptyText="No one else is eligible to run." />
        {error ? (
          <Callout tone="danger" className="mt-4">
            {error}
          </Callout>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!personId || pending}
            onClick={async () => {
              if (!personId) return;
              const r = await run(() => nominateMember(slug, electionId, personId), { success: `${person?.name ?? "They"} is on the ballot.` });
              if (r.ok) {
                setOpen(false);
                setPersonId(null);
              }
            }}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Nominate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveCandidateButton({ slug, candidateId, name }: { slug: string; candidateId: string; name: string }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" className="h-8 w-8 text-ink-3 hover:text-danger" aria-label={`Remove ${name} from the ballot`} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        </Button>
      }
      title={`Remove ${name} from the ballot?`}
      description="They'll be notified. They can run again while nominations are open."
      confirmLabel="Remove"
      danger
      onConfirm={() => {
        void run(() => removeCandidate(slug, candidateId), { success: `${name} is off the ballot.`, toastError: true });
      }}
    />
  );
}

export type TiedCandidate = { id: string; name: string; avatarUrl: string | null; avatarColor: string; votes: number };

/**
 * Apply the result through the org chart. A clear winner applies in one
 * click; a tie asks the applier to choose, and that choice is recorded.
 * Officer and ambassador seats first ask what the winner may do (pre-filled
 * from the seat's defaults), like assigning the seat in the org chart does;
 * a re-elected holder (`sittingIds`) keeps the permissions they have.
 */
export function ApplyResultPanel({
  slug,
  electionId,
  seatName,
  winner,
  tied,
  replacing,
  setup,
  sittingIds,
}: {
  slug: string;
  electionId: string;
  seatName: string;
  winner: TiedCandidate | null;
  tied: TiedCandidate[];
  replacing: string[];
  /** Officer / ambassador seats only. */
  setup: { options: CapabilityOption[]; defaults: string[] } | null;
  sittingIds: string[];
}) {
  const [choice, setChoice] = useState<string | null>(winner?.id ?? null);
  const [confirming, setConfirming] = useState(false);
  const [perms, setPerms] = useState<string[]>(setup?.defaults ?? []);
  const { pending, error, run } = useRunAction();
  const chosen = winner ?? tied.find((t) => t.id === choice) ?? null;
  const askPerms = Boolean(setup && chosen && !sittingIds.includes(chosen.id));
  return (
    <div className="space-y-4">
      {winner ? (
        <p className="flex items-center gap-2 text-sm text-ink">
          <Trophy className="h-4 w-4 text-success" aria-hidden />
          <strong>{winner.name}</strong> won with {winner.votes} vote{winner.votes === 1 ? "" : "s"}.
        </p>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">
            It&apos;s a tie at {tied[0]?.votes ?? 0} vote{tied[0]?.votes === 1 ? "" : "s"}. Per your bylaws, choose who takes the seat — your choice is recorded.
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {tied.map((t) => (
              <label
                key={t.id}
                className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3 focus-within:ring-2 focus-within:ring-brand-100", choice === t.id ? "border-brand bg-brand-50" : "border-line-2 hover:bg-muted/50")}
              >
                <input type="radio" name="tiebreak" checked={choice === t.id} onChange={() => setChoice(t.id)} className="accent-[var(--color-brand)]" />
                <Avatar name={t.name} src={t.avatarUrl} color={t.avatarColor} size="sm" />
                <span className="text-sm font-medium text-ink">{t.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {askPerms && setup && chosen ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-2">
            What can <strong>{chosen.name.split(" ")[0]}</strong> do as {seatName}? These start from the seat&apos;s defaults; you can change them any time in the org chart.
          </p>
          <PermissionChecklist options={setup.options} value={perms} onChange={setPerms} legend="Tool permissions" />
        </div>
      ) : null}
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Button onClick={() => setConfirming(true)} disabled={!chosen || pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trophy className="h-4 w-4" aria-hidden />}
        Apply result to the org chart
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Make ${chosen?.name ?? "the winner"} ${seatName}?`}
        description={
          replacing.length
            ? `${chosen?.name} takes the seat now, and ${replacing.join(" and ")}'s term${replacing.length > 1 ? "s" : ""} end${replacing.length > 1 ? "" : "s"}. Everything stays in the role history.`
            : `${chosen?.name} takes the seat now. It's recorded in the role history.`
        }
        confirmLabel="Apply result"
        onConfirm={() => {
          if (chosen) void run(() => applyResult(slug, electionId, chosen.id, askPerms ? perms : undefined), { success: `${chosen.name} is now ${seatName}.` });
        }}
      />
    </div>
  );
}
