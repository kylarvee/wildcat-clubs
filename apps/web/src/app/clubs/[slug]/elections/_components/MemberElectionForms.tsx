"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Vote } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { useRunAction } from "@/components/roles/useRunAction";
import { runForSeat, saveStatement, vote, withdraw } from "../actions";

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

/** A candidate's own controls while nominations are open. */
export function CandidacyControls({ slug, candidateId, statement: initial }: { slug: string; candidateId: string; statement: string | null }) {
  const [statement, setStatement] = useState(initial ?? "");
  const save = useRunAction();
  const leave = useRunAction();
  const dirty = statement.trim() !== (initial ?? "").trim();
  return (
    <div className="space-y-3">
      <Field label="Your statement" hint="You can edit this until voting opens.">
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
          title="Withdraw from this election?"
          description="You'll come off the ballot. You can run again while nominations are still open."
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
                  {disabled ? <span className="block text-xs text-ink-3">You can&apos;t vote for yourself in a leadership vote</span> : null}
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

export function VotedNotice() {
  return (
    <Callout tone="success" icon={<CheckCircle2 />} title="Your ballot is in">
      Thanks for voting. Ballots are secret — no one, including club leaders, can see who you chose. Results appear here when voting closes.
    </Callout>
  );
}
