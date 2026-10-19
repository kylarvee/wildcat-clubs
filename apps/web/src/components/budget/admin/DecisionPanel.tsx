"use client";

import { useId, useMemo, useState } from "react";
import type { FundingSource } from "@prisma/client";
import { CheckCircle2, CircleSlash, Loader2, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";
import { useRunAction } from "@/components/roles/useRunAction";
import { fmtMoney } from "@/lib/time";
import { SOURCE_ORDER, plural } from "@/lib/funding/labels";
import { decideLines, dollarsToCents } from "@/lib/funding/math";
import { INVOICE_DUE_DAYS } from "@/lib/funding/review";
import { decideFundingAction } from "@/app/admin/funding/actions";

type Choice = "APPROVE" | "PART" | "DENY";

/** One request line as the decision needs it (math: "1 × $25.00 = $25.00 × 12 meetings"). */
export type DecisionLineRow = { id: string; description: string; eventTitle: string | null; totalCents: number; math: string };

const OPTIONS: { value: Choice; label: string; hint: (requested: string) => string; icon: typeof CheckCircle2 }[] = [
  { value: "APPROVE", label: "Approve", hint: (r) => `Fund every line: ${r}.`, icon: CheckCircle2 },
  { value: "PART", label: "Approve part", hint: () => "Set what each line gets. Lines that get less unlock for another source.", icon: Scale },
  { value: "DENY", label: "Don't approve", hint: () => "Fund nothing and tell the club why.", icon: CircleSlash },
];

const dollars = (cents: number) => (cents / 100).toFixed(2);

/**
 * WSUSA's decision on a submitted request: approve every line, approve part
 * of it (an amount for each line, prefilled with the line's total), or don't
 * approve it. Approvals record the source that funds it ("Funded by",
 * prefilled with the club's expected source) and create the invoice and its
 * task in the same step. The club's budget holders hear right away; the
 * approval task closes for every admin.
 */
export function DecisionPanel({
  requestId,
  clubName,
  title,
  requestedCents,
  lines,
  expectedSource,
  sourceNames,
}: {
  requestId: string;
  clubName: string;
  title: string;
  requestedCents: number;
  lines: DecisionLineRow[];
  /** The source the club expects; "Funded by" starts there. */
  expectedSource: FundingSource;
  /** Every source's name for this club ("Department · Nursing"). */
  sourceNames: Record<FundingSource, string>;
}) {
  const uid = useId();
  const [choice, setChoice] = useState<Choice>("APPROVE");
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, dollars(l.totalCents)])));
  const [funded, setFunded] = useState<FundingSource>(expectedSource);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { pending, error, setError, run } = useRunAction();

  const requested = fmtMoney(requestedCents);
  const cents = useMemo(
    () => Object.fromEntries(lines.map((l) => [l.id, (amounts[l.id] ?? "").trim() === "" ? Number.NaN : dollarsToCents(Number(amounts[l.id]))])),
    [lines, amounts],
  );
  const outcome = choice === "DENY" ? null : decideLines(lines, choice === "PART" ? cents : {});
  const decided = outcome?.ok ? outcome : null;
  // While an amount is half-typed, the running total counts what parses.
  const runningCents = choice === "PART" ? lines.reduce((s, l) => s + (Number.isFinite(cents[l.id]) ? Math.max(0, Math.min(cents[l.id], l.totalCents)) : 0), 0) : requestedCents;
  const reduced = decided ? lines.filter((l, i) => decided.lines[i].approvedCents < l.totalCents) : [];
  const partial = decided?.status === "PARTIALLY_APPROVED";
  const noteNeeded = choice === "DENY" || partial;

  function setAmount(id: string, value: string) {
    setAmounts((cur) => ({ ...cur, [id]: value }));
    setError(null);
  }

  function problem(): string | null {
    if (outcome && !outcome.ok) return outcome.problem;
    if (noteNeeded && note.trim().length < 3)
      return choice === "DENY" ? "Tell the club why, so they know what to change or where else to look." : "Tell the club what's covered and why the rest isn't.";
    return null;
  }

  const approvedLabel = fmtMoney(decided?.approvedCents ?? runningCents);
  const confirmTitle = choice === "DENY" ? `Don't approve “${title}”?` : partial ? `Approve ${approvedLabel} of ${requested}?` : `Approve ${requested} for ${clubName}?`;
  const confirmDescription =
    choice === "DENY"
      ? `${clubName} will see your note. Their cost lines unlock so they can change them and ask again.`
      : `Funded by ${sourceNames[funded]}. The ${approvedLabel} invoice is created now, with a task to get it through the university finance system within ${INVOICE_DUE_DAYS} days, and ${clubName} is told right away.${
          partial ? ` ${plural(reduced.length, "line")} ${reduced.length === 1 ? "gets" : "get"} less than asked and ${reduced.length === 1 ? "unlocks" : "unlock"}, so ${clubName} can ask another source for the rest.` : ""
        }`;

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
            const on = choice === o.value;
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
                    setChoice(o.value);
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

      {choice === "PART" ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-ink">What each line gets</legend>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {lines.map((l) => {
              const inputId = `${uid}-amount-${l.id}`;
              const c = cents[l.id];
              const valid = Number.isFinite(c);
              const fundedLine = valid && c > 0;
              return (
                <li key={l.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                  <input
                    type="checkbox"
                    checked={fundedLine}
                    onChange={(e) => setAmount(l.id, e.target.checked ? dollars(l.totalCents) : "0.00")}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-line-2 accent-[var(--color-brand)] sm:mt-0"
                    aria-label={`Fund “${l.description}”`}
                  />
                  <label htmlFor={inputId} className="min-w-0 text-sm">
                    <span className="block font-medium text-ink">{l.description}</span>
                    <span className="block text-xs text-ink-3">
                      {l.eventTitle ? `Event: ${l.eventTitle} · ` : ""}
                      {l.math}
                    </span>
                    {valid && c === 0 ? <span className="block text-xs font-medium text-danger">Not funded · unlocks for another source</span> : null}
                    {valid && c > 0 && c < l.totalCents ? <span className="block text-xs font-medium text-warning">Less than asked · unlocks for the rest</span> : null}
                  </label>
                  <div className="col-start-2 flex items-center gap-2 sm:col-start-auto">
                    <span className="text-sm text-ink-3" aria-hidden>
                      $
                    </span>
                    <Input
                      id={inputId}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={l.totalCents / 100}
                      step="0.01"
                      value={amounts[l.id] ?? ""}
                      onChange={(e) => setAmount(l.id, e.target.value)}
                      aria-describedby={`${inputId}-of`}
                      className="h-9 w-28 px-2.5 text-right tabular-nums"
                    />
                    {/* A fixed width keeps every row's input in the same column. */}
                    <span id={`${inputId}-of`} className="min-w-[6.5rem] whitespace-nowrap text-xs text-ink-3">
                      of {fmtMoney(l.totalCents)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-ink-2" aria-live="polite">
            <span>
              {decided && !partial ? "Every line gets its full amount, so this approves the whole request." : reduced.length ? `${plural(reduced.length, "line")} ${reduced.length === 1 ? "gets" : "get"} less than asked.` : null}
            </span>
            <span>
              Approving <strong className="tabular-nums text-ink">{fmtMoney(runningCents)}</strong> of {requested}
            </span>
          </p>
        </fieldset>
      ) : null}

      {choice !== "DENY" ? (
        <Field
          label="Funded by"
          required
          hint={funded === expectedSource ? `The source ${clubName} expects. Change it if another source pays.` : `${clubName} expected ${sourceNames[expectedSource]}; the club and the invoice will show ${sourceNames[funded]}.`}
        >
          {(id) => (
            <Select id={id} value={funded} onChange={(e) => setFunded(e.target.value as FundingSource)} className="max-w-md">
              {SOURCE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {sourceNames[s]}
                  {s === expectedSource ? " (expected)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      <Field
        label={noteNeeded ? "Note to the club" : "Note to the club (optional)"}
        required={noteNeeded}
        hint={
          choice === "DENY"
            ? "Explain why, and what would change the answer or where else they could look."
            : partial
              ? "Say what's covered and why the rest isn't. The club can ask another source for the lines that get less."
              : "Anything they should know: receipts, deadlines, who to contact."
        }
      >
        {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000} required={noteNeeded} />}
      </Field>

      {error ? <Callout tone="danger">{error}</Callout> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-3">{choice === "DENY" ? "The club's budget holders are notified as soon as you decide." : "Approving creates the invoice and notifies the club's budget holders."}</p>
        <Button type="submit" variant={choice === "DENY" ? "danger" : "primary"} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {choice === "DENY" ? "Don't approve" : `Approve ${approvedLabel}`}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={choice === "DENY" ? "Don't approve" : "Approve"}
        danger={choice === "DENY"}
        onConfirm={() => {
          void run(
            () =>
              decideFundingAction({
                requestId,
                decision: choice === "DENY" ? "DENY" : "APPROVE",
                lines: choice === "PART" ? Object.fromEntries(lines.map((l) => [l.id, Number(amounts[l.id])])) : null,
                fundedSource: choice === "DENY" ? null : funded,
                note: note.trim() || null,
              }),
            {
              onSuccess: (d) =>
                toast.success(d.invoice ? `Approved. Invoice ${d.invoice.number} is ready, its task is in Tasks, and the club has been told.` : "Marked not approved. The club has been told."),
            },
          );
        }}
      >
        {partial && reduced.length ? (
          <ul className="mt-3 space-y-1 rounded-xl bg-muted/60 px-3 py-2 text-sm text-ink-2">
            {reduced.map((l) => {
              const c = decided!.lines.find((x) => x.id === l.id)!.approvedCents;
              return (
                <li key={l.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{l.description}</span>
                  <span className="shrink-0 tabular-nums">{c === 0 ? "Not funded" : `${fmtMoney(c)} of ${fmtMoney(l.totalCents)}`}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </ConfirmDialog>
    </form>
  );
}
