"use client";

import { useState } from "react";
import { Ban, CheckCircle2, Loader2, Lock, Play, Send, Trophy, Undo2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/layout";
import { PermissionChecklist, type CapabilityOption } from "@/components/roles/PermissionChecklist";
import { PersonPicker, type PickerPerson } from "@/components/roles/PersonPicker";
import { useRunAction } from "@/components/roles/useRunAction";
import { applyResult, cancel, closeVotingNow, confirmProposal, nominateMember, openVotingNow, propose, removeCandidate, withdrawProposal } from "../actions";

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

/** Ends voting early — or, next in line, stops taking answers. */
export function CloseVotingButton({ slug, electionId, answers }: { slug: string; electionId: string; answers?: boolean }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
          {answers ? "Close answers now" : "Close voting now"}
        </Button>
      }
      title={answers ? "Stop taking answers now?" : "Close voting early?"}
      description={answers ? "Anyone who hasn't answered can't anymore. The first in line who said yes is the result." : "No more ballots will be accepted, and candidates get the results."}
      confirmLabel={answers ? "Close answers" : "Close voting"}
      onConfirm={() => {
        void run(() => closeVotingNow(slug, electionId), { success: answers ? "Answers are closed." : "Voting closed. Results are in.", toastError: true });
      }}
    />
  );
}

export function CancelElectionButton({ slug, electionId, label = "Cancel" }: { slug: string; electionId: string; label?: string }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" className="text-danger hover:bg-danger-50" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Ban className="h-4 w-4" aria-hidden />}
          {label}
        </Button>
      }
      title="Call this off?"
      description="Nobody takes the seat from it, and candidates are told. Any ballots already cast stay secret and are never counted."
      confirmLabel="Call it off"
      cancelLabel="Keep it"
      danger
      onConfirm={() => {
        void run(() => cancel(slug, electionId), { success: "Cancelled.", toastError: true });
      }}
    />
  );
}

/** Organizers add an active member as a candidate (they're notified and can withdraw). */
export function NominateDialog({ slug, electionId, people, label = "Add a candidate" }: { slug: string; electionId: string; people: PickerPerson[]; label?: string }) {
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
          <UserPlus className="h-4 w-4" aria-hidden /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a candidate" description="Any active member can be added. They'll get a notification, and they can withdraw if they'd rather not.">
        <PersonPicker people={people} value={personId} onChange={setPersonId} label="Who are you adding?" emptyText="No one else can be added." />
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
              const r = await run(() => nominateMember(slug, electionId, personId), { success: `${person?.name ?? "They"} is a candidate now.` });
              if (r.ok) {
                setOpen(false);
                setPersonId(null);
              }
            }}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Add candidate
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
        <Button variant="ghost" size="icon" className="h-8 w-8 text-ink-3 hover:text-danger" aria-label={`Take ${name} off the list`} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        </Button>
      }
      title={`Take ${name} off the list?`}
      description="They'll be notified."
      confirmLabel="Take them off"
      danger
      onConfirm={() => {
        void run(() => removeCandidate(slug, candidateId), { success: `${name} is off the list.`, toastError: true });
      }}
    />
  );
}

export type TiedCandidate = { id: string; name: string; avatarUrl: string | null; avatarColor: string; votes: number };

type Setup = { options: CapabilityOption[]; defaults: string[] } | null;

/** What filling the seat does, spelled out for the confirm step. */
function consequence(name: string, seatName: string, replacing: string[], movingFrom: string | null) {
  const parts = [`${name} takes ${seatName} now.`];
  if (replacing.length) parts.push(`${replacing.join(" and ")}'s term${replacing.length > 1 ? "s" : ""} end${replacing.length > 1 ? "" : "s"}.`);
  if (movingFrom) parts.push(`${name.split(" ")[0]} leaves ${movingFrom}, which opens up to be filled.`);
  parts.push("Everything stays in the role history.");
  return parts.join(" ");
}

/**
 * Fill the seat from a closed selection through the org chart. A member
 * vote's clear winner, a unanimous self-select or the first in line who said
 * yes applies in one step; a tied vote asks the applier to choose, and that's
 * recorded. Officer and ambassador seats first ask what they may do
 * (pre-filled from the seat's defaults); someone chosen again (`sittingIds`)
 * keeps the permissions they have.
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
  movingFrom,
  kind = "vote",
}: {
  slug: string;
  electionId: string;
  seatName: string;
  winner: TiedCandidate | null;
  tied: TiedCandidate[];
  replacing: string[];
  /** Officer / ambassador seats only. */
  setup: Setup;
  sittingIds: string[];
  /** The seat the winner moves up from, by candidate id. */
  movingFrom: Record<string, string>;
  kind?: "vote" | "unanimous" | "nextInLine";
}) {
  const [choice, setChoice] = useState<string | null>(winner?.id ?? null);
  const [confirming, setConfirming] = useState(false);
  const [perms, setPerms] = useState<string[]>(setup?.defaults ?? []);
  const { pending, error, run } = useRunAction();
  const chosen = winner ?? tied.find((t) => t.id === choice) ?? null;
  const askPerms = Boolean(setup && chosen && !sittingIds.includes(chosen.id));
  const from = chosen ? (movingFrom[chosen.id] ?? null) : null;
  return (
    <div className="space-y-4">
      {winner ? (
        <p className="flex items-center gap-2 text-sm text-ink">
          <Trophy className="h-4 w-4 text-success" aria-hidden />
          {kind === "nextInLine" ? (
            <span>
              <strong>{winner.name}</strong> is the first in line who said yes.
            </span>
          ) : kind === "unanimous" ? (
            <span>
              The leaders chose <strong>{winner.name}</strong> unanimously.
            </span>
          ) : (
            <span>
              <strong>{winner.name}</strong> won with {winner.votes} vote{winner.votes === 1 ? "" : "s"}.
            </span>
          )}
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
        {kind === "nextInLine" && chosen ? `Move ${chosen.name.split(" ")[0]} up to ${seatName}` : "Apply result to the org chart"}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Make ${chosen?.name ?? "them"} ${seatName}?`}
        description={chosen ? consequence(chosen.name, seatName, replacing, from) : undefined}
        confirmLabel={kind === "nextInLine" ? "Move them up" : "Apply result"}
        onConfirm={() => {
          if (chosen) void run(() => applyResult(slug, electionId, chosen.id, askPerms ? perms : undefined), { success: `${chosen.name} is now ${seatName}.` });
        }}
      />
    </div>
  );
}

export type ProposableCandidate = { id: string; name: string; avatarUrl: string | null; avatarColor: string; detail: string };

/** Advisor & President: the President or an advisor proposes one candidate. */
export function ProposePanel({ slug, electionId, seatName, candidates, nextStep }: { slug: string; electionId: string; seatName: string; candidates: ProposableCandidate[]; nextStep: string }) {
  const [choice, setChoice] = useState<string | null>(null);
  const { pending, error, run } = useRunAction();
  const chosen = candidates.find((c) => c.id === choice) ?? null;
  if (!candidates.length) return <p className="text-sm text-ink-3">Add a candidate first: anyone on the list can be proposed.</p>;
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Who should be {seatName}?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {candidates.map((c) => (
            <label key={c.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3 focus-within:ring-2 focus-within:ring-brand-100", choice === c.id ? "border-brand bg-brand-50" : "border-line-2 hover:bg-muted/50")}>
              <input type="radio" name="proposal" checked={choice === c.id} onChange={() => setChoice(c.id)} className="accent-[var(--color-brand)]" />
              <Avatar name={c.name} src={c.avatarUrl} color={c.avatarColor} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                <span className="block truncate text-xs text-ink-3">{c.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-ink-3">{nextStep}</p>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Button disabled={!chosen || pending} onClick={() => chosen && run(() => propose(slug, electionId, chosen.id), { success: `You proposed ${chosen.name}.` })}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        {chosen ? `Propose ${chosen.name.split(" ")[0]}` : "Propose"}
      </Button>
    </div>
  );
}

/** Advisor & President: the other side confirms, which fills the seat — or sends the proposal back. */
export function ConfirmProposalPanel({
  slug,
  electionId,
  seatName,
  candidate,
  replacing,
  movingFrom,
  setup,
  sitting,
  canSendBack,
}: {
  slug: string;
  electionId: string;
  seatName: string;
  candidate: { name: string };
  replacing: string[];
  movingFrom: string | null;
  setup: Setup;
  /** Already holds the seat (keeps their permissions). */
  sitting: boolean;
  canSendBack: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [perms, setPerms] = useState<string[]>(setup?.defaults ?? []);
  const confirm = useRunAction();
  const back = useRunAction();
  const askPerms = Boolean(setup && !sitting);
  const first = candidate.name.split(" ")[0];
  return (
    <div className="space-y-4">
      {askPerms && setup ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-2">
            What can <strong>{first}</strong> do as {seatName}? These start from the seat&apos;s defaults; you can change them any time in the org chart.
          </p>
          <PermissionChecklist options={setup.options} value={perms} onChange={setPerms} legend="Tool permissions" />
        </div>
      ) : null}
      {confirm.error ? <Callout tone="danger">{confirm.error}</Callout> : null}
      {back.error ? <Callout tone="danger">{back.error}</Callout> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setConfirming(true)} disabled={confirm.pending || back.pending}>
          {confirm.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
          Confirm {first} as {seatName}
        </Button>
        {canSendBack ? (
          <ConfirmDialog
            trigger={
              <Button variant="outline" disabled={confirm.pending || back.pending}>
                {back.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />}
                Send it back
              </Button>
            }
            title={`Don't confirm ${candidate.name} yet?`}
            description="The proposal comes off and whoever proposed it is told, so you can talk it over. Either of you can then propose someone."
            confirmLabel="Send it back"
            onConfirm={() => {
              void back.run(() => withdrawProposal(slug, electionId), { success: "Sent back.", toastError: true });
            }}
          />
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Confirm ${candidate.name} as ${seatName}?`}
        description={consequence(candidate.name, seatName, replacing, movingFrom)}
        confirmLabel="Confirm and fill the seat"
        onConfirm={() => {
          void confirm.run(() => confirmProposal(slug, electionId, askPerms ? perms : undefined), { success: `${candidate.name} is now ${seatName}.` });
        }}
      />
    </div>
  );
}

/** The proposer (or an admin) takes the proposal back before it's confirmed. */
export function WithdrawProposalButton({ slug, electionId, name }: { slug: string; electionId: string; name: string }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />}
          Withdraw proposal
        </Button>
      }
      title={`Withdraw your proposal of ${name}?`}
      description="Nobody is proposed until someone proposes again. Their name stays on the list of candidates."
      confirmLabel="Withdraw proposal"
      onConfirm={() => {
        void run(() => withdrawProposal(slug, electionId), { success: "Proposal withdrawn.", toastError: true });
      }}
    />
  );
}
