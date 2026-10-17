"use client";

import { useId, useState } from "react";
import { CheckCircle2, CircleSlash, Loader2, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { ConfirmDialog } from "@/components/ui/dialog";
import { cn } from "@/components/ui/cn";
import { useRunAction } from "@/components/roles/useRunAction";
import { fmtMoney } from "@/lib/time";
import { dollarsToCents, partialAmountProblem } from "@/lib/funding/math";
import { decideFundingAction } from "@/app/admin/funding/actions";

type Decision = "APPROVE" | "PARTIAL" | "DENY";

const OPTIONS: { value: Decision; label: string; hint: (requested: string) => string; icon: typeof CheckCircle2 }[] = [
  { value: "APPROVE", label: "Approve", hint: (r) => `Grant the full ${r}.`, icon: CheckCircle2 },
  { value: "PARTIAL", label: "Partly approve", hint: () => "Grant a smaller amount and explain what it covers.", icon: Scale },
  { value: "DENY", label: "Deny", hint: () => "Grant nothing and tell the club why.", icon: CircleSlash },
];

/**
 * WSUSA's decision on a submitted request: approve in full, approve part of
 * it (amount + note), or deny (note). The club's budget holders hear right
 * away; the approval task closes for every admin.
 */
export function DecisionPanel({ requestId, clubName, title, requestedCents, sourceLabel }: { requestId: string; clubName: string; title: string; requestedCents: number; sourceLabel: string }) {
  const uid = useId();
  const [decision, setDecision] = useState<Decision>("APPROVE");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { pending, error, setError, run } = useRunAction();

  const requested = fmtMoney(requestedCents);
  const amountCents = amount.trim() === "" ? Number.NaN : dollarsToCents(Number(amount));
  const noteNeeded = decision !== "APPROVE";

  function problem(): string | null {
    if (decision === "PARTIAL") {
      const p = partialAmountProblem(requestedCents, amountCents);
      if (p) return p;
    }
    if (noteNeeded && note.trim().length < 3)
      return decision === "DENY" ? "Tell the club why, so they know what to change or where else to look." : "Tell the club what's covered and why the rest isn't.";
    return null;
  }

  const confirmTitle =
    decision === "APPROVE"
      ? `Approve ${requested} for ${clubName}?`
      : decision === "PARTIAL"
        ? `Approve ${Number.isFinite(amountCents) ? fmtMoney(amountCents) : "part"} of ${requested}?`
        : `Deny “${title}”?`;
  const submitLabel =
    decision === "APPROVE" ? `Approve ${requested}` : decision === "PARTIAL" ? `Approve ${Number.isFinite(amountCents) && amountCents > 0 ? fmtMoney(amountCents) : "part"}` : "Deny request";

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const p = problem();
        if (p) return setError(p);
        setError(null);
        setConfirming(true);
      }}
      aria-busy={pending}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Your decision</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {OPTIONS.map((o) => {
            const id = `${uid}-${o.value}`;
            const on = decision === o.value;
            const Icon = o.icon;
            return (
              <label
                key={o.value}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand",
                  on ? (o.value === "DENY" ? "border-danger bg-danger-50" : "border-brand bg-brand-50") : "border-line bg-surface hover:bg-muted/50",
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name={`${uid}-decision`}
                  value={o.value}
                  checked={on}
                  onChange={() => {
                    setDecision(o.value);
                    setError(null);
                  }}
                  className="sr-only"
                />
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", on ? (o.value === "DENY" ? "text-danger" : "text-brand") : "text-ink-3")} aria-hidden />
                <span>
                  <span className="block font-medium text-ink">{o.label}</span>
                  <span className="block text-xs text-ink-3">{o.hint(requested)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {decision === "PARTIAL" ? (
        <Field label="Amount to approve ($)" required hint={`Less than the ${requested} requested.`}>
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              min={0.01}
              step="0.01"
              max={(requestedCents - 1) / 100}
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="max-w-48"
              required
            />
          )}
        </Field>
      ) : null}

      <Field
        label={noteNeeded ? "Note to the club" : "Note to the club (optional)"}
        required={noteNeeded}
        hint={
          decision === "DENY"
            ? "Explain why, and what would change the answer or where else they could look."
            : decision === "PARTIAL"
              ? "Say which costs are covered and why the rest isn't."
              : "Anything they should know: receipts, deadlines, who to contact."
        }
      >
        {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000} required={noteNeeded} />}
      </Field>

      {error ? <Callout tone="danger">{error}</Callout> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-3">The club&apos;s budget holders are notified as soon as you decide.</p>
        <Button type="submit" variant={decision === "DENY" ? "danger" : "primary"} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {submitLabel}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={confirmTitle}
        description={
          decision === "DENY"
            ? `${clubName} will see your note. Their cost lines unlock so they can change them and ask again.`
            : `From ${sourceLabel}. ${clubName} is notified right away; next, create the invoice so the money moves through the university finance system.`
        }
        confirmLabel={decision === "DENY" ? "Deny request" : "Approve"}
        danger={decision === "DENY"}
        onConfirm={() => {
          void run(
            () =>
              decideFundingAction({
                requestId,
                decision,
                amount: decision === "PARTIAL" ? Number(amount) : null,
                note: note.trim() || null,
              }),
            { success: decision === "DENY" ? "Request denied. The club has been told." : "Decision saved. The club has been told." },
          );
        }}
      />
    </form>
  );
}
