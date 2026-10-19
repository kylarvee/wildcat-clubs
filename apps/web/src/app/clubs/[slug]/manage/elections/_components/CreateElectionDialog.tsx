"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SuccessionMethod } from "@prisma/client";
import { format } from "date-fns";
import { Gavel, Loader2, Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { useRunAction } from "@/components/roles/useRunAction";
import { SUCCESSION_METHODS, usesBallots, type TieBreak } from "@/lib/roles/pipeline";
import { SUCCESSION_NAME, SUCCESSION_STEPS } from "@/lib/roles/labels";
import { quorumRuleText, tieRuleText, voterRuleText } from "@/lib/constitution/rules";
import { createElection, startOver } from "../actions";

export type ElectableSeat = { id: string; name: string; roleLabel: string; busy: boolean; /** Names of the people next in line, in order. */ nextInLine: string[] };

/**
 * Campus-time datetime-local defaults for each kind of date. A member vote
 * has its own: it can't open before the bylaws' notice is up (`earliest`),
 * and the form explains the bylaw rules it runs under (lib/roles/selection-setup).
 */
export type SelectionDefaults = {
  opens: string;
  closes: string;
  respondBy: string;
  decideBy: string;
  runoffCloses?: string;
  memberVote?: { opens: string; closes: string; earliest: string | null; noticeDays: number | null; votingDays: number | null; minEvents: number | null; quorumPercent: number | null; tieBreak: TieBreak | null };
};

/** "2026-10-27T10:45" (campus wall time) → "Tue, Oct 27 at 10:45 AM", whatever the browser's time zone. */
function campusLabel(local: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return local;
  // Built from the wall-clock parts and formatted back the same way, so the browser's own zone never shifts it.
  return format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])), "EEE, MMM d 'at' h:mm a");
}

/**
 * Fill a seat: which seat, which of the four modes (the club's primary mode
 * first, the others at the organizer's discretion), a title and the mode's
 * dates — voting opens/closes for ballots, one "respond by" or "decide by"
 * date otherwise. Times are campus time.
 *
 * With `restartElectionId` it starts over for that selection's seat ("Start
 * again" / "Use another mode"), cancelling the old one.
 */
export function CreateElectionDialog({
  slug,
  clubId,
  seats,
  primary,
  defaults,
  termLabel,
  fixedSeatId,
  initialMethod,
  restartElectionId,
  triggerLabel,
  triggerVariant = "primary",
  triggerSize,
  triggerClassName,
}: {
  slug: string;
  clubId: string;
  seats: ElectableSeat[];
  /** The club's primary mode (from its constitution). */
  primary: SuccessionMethod;
  defaults: SelectionDefaults;
  termLabel: string | null;
  /** Fill this one seat (the org chart's "Fill this seat", or starting over). */
  fixedSeatId?: string;
  initialMethod?: SuccessionMethod;
  restartElectionId?: string;
  triggerLabel?: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const firstFree = fixedSeatId ? seats.find((s) => s.id === fixedSeatId) : seats.find((s) => !s.busy);
  const [seatId, setSeatId] = useState(firstFree?.id ?? "");
  const seat = seats.find((s) => s.id === seatId);
  const nobodyNext = (seat?.nextInLine.length ?? 0) === 0;
  const startMethod = (m: SuccessionMethod) => (m === "NEXT_IN_LINE" && nobodyNext ? "ADVISOR_PRESIDENT" : m);
  const [method, setMethod] = useState<SuccessionMethod>(startMethod(initialMethod ?? primary));
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const mv = defaults.memberVote;
  const [opens, setOpens] = useState(method === "MEMBER_VOTE" && mv ? mv.opens : defaults.opens);
  const [closes, setCloses] = useState(method === "MEMBER_VOTE" && mv ? mv.closes : defaults.closes);
  const [due, setDue] = useState(method === "NEXT_IN_LINE" ? defaults.respondBy : defaults.decideBy);
  const { pending, error, setError, run } = useRunAction();
  const suggested = seat ? `${seat.name}${termLabel ? ` — ${termLabel}` : " seat"}` : "";
  const ballots = usesBallots(method);
  // Member votes: the bylaws' notice sets the earliest opening (campus-local strings compare in time order).
  const earliest = method === "MEMBER_VOTE" ? (mv?.earliest ?? null) : null;
  const tooSoon = Boolean(earliest && opens && opens < earliest);
  const bylawRules = Boolean(mv && (mv.minEvents || mv.quorumPercent || mv.tieBreak || mv.noticeDays));
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
      setTouched(false);
      setTitle("");
    }
  }

  function pickMethod(m: SuccessionMethod) {
    setMethod(m);
    if (!usesBallots(m)) setDue(m === "NEXT_IN_LINE" ? defaults.respondBy : defaults.decideBy);
    // A member vote can't open before the bylaws' notice is up: move a too-early window to its own default.
    if (m === "MEMBER_VOTE" && mv?.earliest && opens < mv.earliest) {
      setOpens(mv.opens);
      setCloses(mv.closes);
    }
  }

  async function submit() {
    if (!seatId) return setError("Choose the seat to fill.");
    if (tooSoon && earliest) return setError(`Your bylaws give members ${mv?.noticeDays} days' notice before a vote, so voting can open ${campusLabel(earliest)} at the earliest.`);
    const form = { title: (touched ? title : suggested).trim(), method, votingOpensAt: ballots ? opens : null, votingClosesAt: ballots ? closes : due };
    const r = await run(() => (restartElectionId ? startOver(slug, restartElectionId, form) : createElection(slug, { ...form, clubId, positionId: seatId })), {
      success:
        method === "NEXT_IN_LINE"
          ? "Started. The people next in line have been asked."
          : method === "ADVISOR_PRESIDENT"
            ? "Started. The President or an advisor can propose someone now."
            : method === "SELF_SELECT"
              ? "Started. Add any other candidates before voting opens."
              : "Started. Nominations are open.",
    });
    if (r.ok) {
      reset(false);
      router.push(`/clubs/${slug}/manage/elections/${r.data.id}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize} className={triggerClassName} disabled={!firstFree}>
          {restartElectionId ? null : <Plus className="h-4 w-4" aria-hidden />} {triggerLabel ?? "Fill a seat"}
        </Button>
      </DialogTrigger>
      <DialogContent
        wide
        title={restartElectionId ? `Start over for ${seat?.name ?? "this seat"}` : fixedSeatId ? `Fill ${seat?.name ?? "this seat"}` : "Fill a seat"}
        description={restartElectionId ? "This one is cancelled and a new one starts for the same seat." : "Everyone on the org chart below the seat becomes a candidate automatically. Times are Ogden (campus) time."}
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {fixedSeatId ? null : (
            <Field label="Seat" required hint="Seats that are already being filled aren't available.">
              {(id) => (
                <Select
                  id={id}
                  value={seatId}
                  onChange={(e) => {
                    setSeatId(e.target.value);
                    const next = seats.find((s) => s.id === e.target.value);
                    if (method === "NEXT_IN_LINE" && !next?.nextInLine.length) pickMethod("ADVISOR_PRESIDENT");
                  }}
                  required
                >
                  <option value="" disabled>
                    Choose a seat
                  </option>
                  {seats.map((s) => (
                    <option key={s.id} value={s.id} disabled={s.busy}>
                      {s.name} ({s.roleLabel}){s.busy ? " — already being filled" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-ink">How should this seat be filled?</legend>
            <p className="mb-2 text-xs text-ink-3">Your constitution names {SUCCESSION_NAME[primary]} as the primary way. You can use any of them for a particular seat.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SUCCESSION_METHODS.map((m) => {
                const disabled = m === "NEXT_IN_LINE" && nobodyNext;
                return (
                  <label
                    key={m}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-xl border p-3 text-sm focus-within:ring-2 focus-within:ring-brand-100",
                      method === m ? "border-brand bg-brand-50" : "border-line-2 hover:bg-muted/50",
                      disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
                    )}
                  >
                    <input
                      type="radio"
                      name="method"
                      value={m}
                      checked={method === m}
                      disabled={disabled}
                      onChange={() => pickMethod(m)}
                      aria-label={`${SUCCESSION_NAME[m]}${m === primary ? " (primary)" : ""}`}
                      aria-describedby={`method-${m}-how`}
                      className="mt-1 accent-[var(--color-brand)]"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                        {SUCCESSION_NAME[m]}
                        {m === primary ? <Badge tone="brand">Primary</Badge> : null}
                      </span>
                      <span id={`method-${m}-how`} className="block text-ink-3">
                        {disabled ? `Nobody is next in line for ${seat?.name ?? "this seat"}: the seats below it are empty.` : SUCCESSION_STEPS[m]}
                      </span>
                      {m === "NEXT_IN_LINE" && !disabled && method === m && seat ? <span className="mt-1 block text-ink-2">Next in line: {seat.nextInLine.join(", ")}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

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

          {method === "MEMBER_VOTE" && mv ? (
            <div className="flex gap-2.5 rounded-xl border border-line bg-muted/40 p-3 text-sm text-ink-2">
              <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              <div className="space-y-0.5">
                <p className="font-medium text-ink">{bylawRules ? "Your bylaws' voting rules apply" : "How this vote runs"}</p>
                <p>Who votes: {lower(voterRuleText(mv.minEvents))}.</p>
                <p>{quorumRuleText(mv.quorumPercent)}.</p>
                <p>Ties: {lower(tieRuleText(mv.tieBreak))}.</p>
              </div>
            </div>
          ) : null}

          {ballots ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Voting opens"
                required
                hint={
                  earliest
                    ? `Your bylaws give members ${mv?.noticeDays} days' notice: voting can open ${campusLabel(earliest)} or later. Members can run until then.`
                    : method === "MEMBER_VOTE"
                      ? "Members can run until then."
                      : "Organizers can add candidates until then."
                }
                error={tooSoon && earliest ? `That's before your bylaws' notice is up: voting can open ${campusLabel(earliest)} or later.` : undefined}
              >
                {(id) => <Input id={id} type="datetime-local" value={opens} min={earliest ?? undefined} onChange={(e) => setOpens(e.target.value)} aria-invalid={tooSoon || undefined} required />}
              </Field>
              <Field label="Voting closes" required hint={mv?.votingDays ? `Your bylaws keep a vote open ${mv.votingDays} day${mv.votingDays === 1 ? "" : "s"}.` : undefined}>
                {(id) => <Input id={id} type="datetime-local" value={closes} min={opens} onChange={(e) => setCloses(e.target.value)} required />}
              </Field>
            </div>
          ) : (
            <Field
              label={method === "NEXT_IN_LINE" ? "Answers due by" : "Decide by"}
              required
              hint={method === "NEXT_IN_LINE" ? "Each person next in line says yes or no by then; the first in line who says yes moves up." : "A target date for the proposal and its confirmation. Nothing closes on its own."}
            >
              {(id) => <Input id={id} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required />}
            </Field>
          )}

          {error ? <Callout tone="danger">{error}</Callout> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => reset(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !seatId}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {restartElectionId ? "Cancel this one and start over" : "Start"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
