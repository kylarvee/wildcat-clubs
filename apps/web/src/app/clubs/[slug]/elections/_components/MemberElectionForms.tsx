"use client";

import { useState } from "react";
import { ArrowUpCircle, CheckCircle2, Loader2, Vote } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { useRunAction } from "@/components/roles/useRunAction";
import { answerMoveUp, runForSeat, saveStatement, vote, withdraw } from "../actions";

/** Self-nomination: a short statement and you're on the ballot. */
export function RunForm({ slug, electionId, seatName }: { slug: string; electionId: string; seatName: string }) {
  const [statement, setStatement] = useState("");
  const { pending, error, run } = useRunAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => runForSeat(slug, electionId, statement), { success: `You're on the ballot for ${seatName}. Good luck!` });
      }}
    >
      <Field label="Your statement" hint={`Why you want to be ${seatName} and what you'd do. Voters read this. ${2000 - statement.length} characters left.`}>
        {(id) => <Textarea id={id} rows={5} maxLength={2000} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="I'd like to serve because…" />}
      </Field>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Run for {seatName}
      </Button>
    </form>
  );
}

/** A candidate's own controls while candidates can still change. */
export function CandidacyControls({ slug, candidateId, statement: initial, selfNominated = true, lockNote = "You can edit this until voting opens." }: { slug: string; candidateId: string; statement: string | null; /** Members run themselves (a member vote), so they can run again after withdrawing. */ selfNominated?: boolean; lockNote?: string }) {
  const [statement, setStatement] = useState(initial ?? "");
  const save = useRunAction();
  const leave = useRunAction();
  const dirty = statement.trim() !== (initial ?? "").trim();
  return (
    <div className="space-y-3">
      <Field label="Your statement" hint={lockNote}>
        {(id) => <Textarea id={id} rows={5} maxLength={2000} value={statement} onChange={(e) => setStatement(e.target.value)} />}
      </Field>
      {save.error ? <Callout tone="danger">{save.error}</Callout> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!dirty || save.pending} onClick={() => save.run(() => saveStatement(slug, candidateId, statement), { success: "Statement saved." })}>
          {save.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save statement
        </Button>
        <ConfirmDialog
          trigger={
            <Button variant="outline" disabled={leave.pending}>
              {leave.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Withdraw
            </Button>
          }
          title="Withdraw?"
          description={selfNominated ? "You'll come off the ballot. You can run again while nominations are still open." : "You'll come off the list of candidates. An organizer can add you back while it's still open."}
          confirmLabel="Withdraw"
          danger
          onConfirm={() => {
            void leave.run(() => withdraw(slug, candidateId), { success: "You've withdrawn.", toastError: true });
          }}
        />
      </div>
    </div>
  );
}

export type BallotCandidate = { id: string; name: string; avatarUrl: string | null; avatarColor: string; self: boolean };

/** The secret ballot: pick one, confirm, done. Can't be changed afterwards. */
export function BallotForm({ slug, electionId, seatName, candidates, selfBlocked }: { slug: string; electionId: string; seatName: string; candidates: BallotCandidate[]; selfBlocked: boolean }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { pending, error, run } = useRunAction();
  const chosen = candidates.find((c) => c.id === choice);
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Choose one candidate for {seatName}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {candidates.map((c) => {
            const disabled = selfBlocked && c.self;
            const selected = choice === c.id;
            return (
              <label
                key={c.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3 focus-within:ring-2 focus-within:ring-brand-100",
                  selected ? "border-brand bg-brand-50" : "border-line-2 hover:bg-muted/50",
                  disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
                )}
              >
                <input type="radio" name="ballot" value={c.id} checked={selected} disabled={disabled || pending} onChange={() => setChoice(c.id)} className="accent-[var(--color-brand)]" />
                <Avatar name={c.name} src={c.avatarUrl} color={c.avatarColor} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                  {disabled ? <span className="block text-xs text-ink-3">Leaders don&apos;t vote for themselves</span> : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Button onClick={() => setConfirming(true)} disabled={!choice || pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Vote className="h-4 w-4" aria-hidden />}
        Cast my vote
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Vote for ${chosen?.name ?? "this candidate"}?`}
        description="Your ballot is secret and final — you can't change it after you submit."
        confirmLabel="Submit my ballot"
        onConfirm={() => {
          if (choice) void run(() => vote(slug, electionId, choice), { success: "Your vote is in. Thanks for voting!" });
        }}
      />
    </div>
  );
}

/**
 * Next in line: "Move up to ⟨seat⟩?" Yes records the answer (it can still be
 * taken back until answers close); No takes them off the list.
 */
export function MoveUpPrompt({ slug, candidateId, seatName, accepted, dueText, aheadSaidYes }: { slug: string; candidateId: string; seatName: string; accepted: boolean; dueText: string; aheadSaidYes: boolean }) {
  const yes = useRunAction();
  const no = useRunAction();
  const busy = yes.pending || no.pending;
  const decline = (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={busy}>
          {no.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {accepted ? "I've changed my mind" : "No, thanks"}
        </Button>
      }
      title={accepted ? "Take back your yes?" : `Stay where you are?`}
      description={`You'll come off the list for ${seatName}, and you won't be asked again for it this time. Your current seat doesn't change.`}
      confirmLabel={accepted ? "Take it back" : "No, thanks"}
      onConfirm={() => {
        void no.run(() => answerMoveUp(slug, candidateId, false), { success: "Got it. You're staying where you are.", toastError: true });
      }}
    />
  );
  if (accepted) {
    return (
      <div className="space-y-3">
        <Callout tone="success" icon={<CheckCircle2 />} title={`You said yes to ${seatName}`}>
          {aheadSaidYes ? "Someone ahead of you in line has also said yes, so they move up first." : `If you're still the first in line who said yes when answers close (${dueText}), you move up.`}
        </Callout>
        <div className="flex flex-wrap gap-2">{decline}</div>
        {no.error ? <Callout tone="danger">{no.error}</Callout> : null}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">
        You&apos;re next in line. Answer by {dueText}: the first person in line who says yes moves up to {seatName}, and the seat they leave opens up.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => yes.run(() => answerMoveUp(slug, candidateId, true), { success: `You said yes to ${seatName}.` })}>
          {yes.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowUpCircle className="h-4 w-4" aria-hidden />}
          Yes, move me up
        </Button>
        {decline}
      </div>
      {yes.error ? <Callout tone="danger">{yes.error}</Callout> : null}
      {no.error ? <Callout tone="danger">{no.error}</Callout> : null}
    </div>
  );
}

export function VotedNotice() {
  return (
    <Callout tone="success" icon={<CheckCircle2 />} title="Your ballot is in">
      Thanks for voting. Ballots are secret — no one, including club leaders, can see who you chose. Results appear here when voting closes.
    </Callout>
  );
}
