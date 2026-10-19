"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FundingSource, FundingStatus } from "@prisma/client";
import { CalendarDays, ChevronDown, Loader2, Lock, Send, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";
import { fmtMoney } from "@/lib/time";
import { FUNDING_SOURCES } from "@/lib/events/labels";
import { plural } from "@/lib/funding/labels";
import { MAX_REQUEST_CENTS } from "@/lib/funding/math";
import { discardDraftAction, saveRequestAction } from "@/app/clubs/[slug]/manage/budget/actions";

export type BuilderLine = {
  id: string;
  eventId: string | null;
  eventTitle: string | null;
  description: string;
  category: string;
  fundingSource: FundingSource;
  perOccurrence: boolean;
  quantity: number;
  unitCostCents: number;
  setCents: number;
  occurrences: number;
  totalCents: number;
  /** The request holding it locked: in WSUSA review, or funded in full (lib/funding/locks). */
  lockedBy: { title: string; status: FundingStatus } | null;
  /** WSUSA's decisions on it in approved requests this semester. */
  decisions: { title: string; askedCents: number; approvedCents: number }[];
  fundedCents: number;
  /** What this request would ask for: its cost less what's funded. */
  openCents: number;
  requestable: boolean;
};

export type RequestBuilderProps = {
  slug: string;
  clubId: string;
  term: { id: string; name: string };
  lines: BuilderLine[];
  sourceNames: Record<FundingSource, string>;
  defaultSource: FundingSource;
  /** Set when editing a draft. */
  initial?: { requestId: string; title: string; justification: string; fundingSource: FundingSource; itemIds: string[] } | null;
  /** ?event=<id>: start with that event's lines picked. */
  preselectEventId?: string | null;
  /** ?from=<request>: start with these lines picked (what that request didn't fund), and this title. */
  preselect?: { lineIds: string[]; title: string } | null;
  reviewDays: number;
  minJustification: number;
};

type Group = { key: string; title: string; eventId: string | null; lines: BuilderLine[] };

function groupLines(lines: BuilderLine[]): Group[] {
  const map = new Map<string, Group>();
  for (const l of lines) {
    const key = l.eventId ?? "general";
    if (!map.has(key)) map.set(key, { key, title: l.eventTitle ?? "Other costs", eventId: l.eventId, lines: [] });
    map.get(key)!.lines.push(l);
  }
  // Event groups first (as the budget page lists them), general costs last.
  return [...map.values()].sort((a, b) => Number(!a.eventId) - Number(!b.eventId));
}

function mostCommonSource(lines: BuilderLine[], fallback: FundingSource): FundingSource {
  const counts = new Map<FundingSource, number>();
  for (const l of lines) counts.set(l.fundingSource, (counts.get(l.fundingSource) ?? 0) + l.totalCents + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

/**
 * Build or edit a funding request: one semester, the source the club expects,
 * the cost lines it covers, and why. WSUSA reviews every request and may fund
 * it from another source. Lines a request holds (in review, or funded in
 * full) can't be picked; a line funded in part asks only for the rest.
 * Saving keeps a draft; submitting sends it to WSUSA.
 */
export function RequestBuilder(p: RequestBuilderProps) {
  const router = useRouter();
  const formId = useId();
  const available = useMemo(() => new Set(p.lines.filter((l) => l.requestable).map((l) => l.id)), [p.lines]);
  const preselected = useMemo(() => {
    if (p.preselect) {
      const ids = new Set(p.preselect.lineIds);
      return p.lines.filter((l) => ids.has(l.id) && l.requestable);
    }
    return p.preselectEventId ? p.lines.filter((l) => l.eventId === p.preselectEventId && l.requestable) : [];
  }, [p.lines, p.preselectEventId, p.preselect]);

  const [title, setTitle] = useState(p.initial?.title ?? p.preselect?.title ?? preselected[0]?.eventTitle ?? "");
  const [justification, setJustification] = useState(p.initial?.justification ?? "");
  const [source, setSource] = useState<FundingSource>(p.initial?.fundingSource ?? (preselected.length ? mostCommonSource(preselected, p.defaultSource) : p.defaultSource));
  const [selected, setSelected] = useState<Set<string>>(() => new Set((p.initial?.itemIds ?? preselected.map((l) => l.id)).filter((id) => available.has(id))));
  const [showOthers, setShowOthers] = useState(() => p.lines.some((l) => l.fundingSource !== source && selected.has(l.id)));
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [pending, start] = useTransition();
  const [pendingKind, setPendingKind] = useState<"save" | "submit" | "discard" | null>(null);

  const matching = p.lines.filter((l) => l.fundingSource === source);
  const others = p.lines.filter((l) => l.fundingSource !== source);
  const chosen = p.lines.filter((l) => selected.has(l.id));
  const total = chosen.reduce((s, l) => s + l.openCents, 0);
  const othersChosen = others.filter((l) => selected.has(l.id)).length;
  const base = `/clubs/${p.slug}/manage/budget`;

  function toggle(id: string, on: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleGroup(g: Group, on: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const l of g.lines) {
        if (!available.has(l.id)) continue;
        if (on) next.add(l.id);
        else next.delete(l.id);
      }
      return next;
    });
  }

  function problem(submit: boolean): string | null {
    if (title.trim().length < 3) return "Give the request a short title (at least 3 characters).";
    if (total > MAX_REQUEST_CENTS) return `One request can ask for up to ${fmtMoney(MAX_REQUEST_CENTS)}. Split it into separate requests.`;
    if (!submit) return null;
    if (!chosen.length) return "Pick at least one cost line to request.";
    if (total <= 0) return "The lines you picked add up to $0.00. Add the costs before asking for money.";
    if (justification.trim().length < p.minJustification) return "Add a sentence or two about what this money is for and who it helps — WSUSA reads that first.";
    return null;
  }

  function save(submit: boolean) {
    const msg = problem(submit);
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    setPendingKind(submit ? "submit" : "save");
    start(async () => {
      try {
        const r = await saveRequestAction({
          requestId: p.initial?.requestId ?? null,
          clubId: p.clubId,
          termId: p.term.id,
          submit,
          title: title.trim(),
          justification: justification.trim() || null,
          fundingSource: source,
          // Only lines on screen: a pick can't outlive the semester it was made in.
          budgetItemIds: chosen.map((l) => l.id),
        });
        if (r.ok) {
          toast.success(r.data.submitted ? "Request submitted. WSUSA will take it from here." : "Draft saved.");
          if (r.data.submitted || !p.initial) router.push(`${base}/requests/${r.data.id}`);
          return;
        }
        setError(r.error);
        // A brand-new draft was saved even though submitting failed: move to its page so nothing is lost.
        if (!p.initial && r.savedId) {
          toast.error(r.error);
          router.push(`${base}/requests/${r.savedId}`);
        }
      } catch {
        setError("We couldn't reach the server. Check your connection and try again.");
      } finally {
        setPendingKind(null);
      }
    });
  }

  function discard() {
    if (!p.initial) return;
    setPendingKind("discard");
    start(async () => {
      try {
        const r = await discardDraftAction(p.initial!.requestId);
        if (!r.ok) return setError(r.error);
        toast.success("Draft discarded.");
        router.push(`${base}?term=${p.term.id}`);
      } catch {
        setError("We couldn't reach the server. Check your connection and try again.");
      } finally {
        setPendingKind(null);
      }
    });
  }

  const renderGroups = (lines: BuilderLine[], showSource: boolean) =>
    groupLines(lines).map((g) => {
      const pickable = g.lines.filter((l) => available.has(l.id));
      const allOn = pickable.length > 0 && pickable.every((l) => selected.has(l.id));
      return (
        <fieldset key={g.key} className="rounded-xl border border-line bg-surface">
          <legend className="sr-only">{g.title}</legend>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink" aria-hidden>
              {g.eventId ? <CalendarDays className="h-4 w-4 shrink-0 text-ink-3" /> : <Wallet className="h-4 w-4 shrink-0 text-ink-3" />}
              <span className="truncate">{g.title}</span>
            </p>
            {pickable.length > 1 ? (
              <Button variant="link" size="sm" className="text-xs" onClick={() => toggleGroup(g, !allOn)}>
                {allOn ? "Clear" : "Select all"}
                <span className="sr-only"> in {g.title}</span>
              </Button>
            ) : null}
          </div>
          <ul className="divide-y divide-line">
            {g.lines.map((l) => {
              const locked = !l.requestable;
              const inputId = `${formId}-${l.id}`;
              const lastDecision = l.decisions.at(-1);
              return (
                <li key={l.id} className={cn("flex items-start gap-3 px-3 py-2.5", locked && "bg-muted/40")}>
                  <input
                    id={inputId}
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 rounded border-line-2 accent-[var(--color-brand)] disabled:opacity-50"
                    checked={selected.has(l.id)}
                    disabled={locked || pending}
                    onChange={(e) => toggle(l.id, e.target.checked)}
                    aria-describedby={`${inputId}-math`}
                  />
                  <label htmlFor={inputId} className={cn("min-w-0 flex-1 text-sm", locked ? "cursor-not-allowed" : "cursor-pointer")}>
                    <span className="block font-medium text-ink">{l.description}</span>
                    <span id={`${inputId}-math`} className="block text-xs tabular-nums text-ink-3">
                      {l.perOccurrence
                        ? `${fmtMoney(l.setCents)} each meeting × ${plural(l.occurrences, "meeting")}`
                        : `${l.quantity.toLocaleString("en-US")} × ${fmtMoney(l.unitCostCents)}${l.eventId ? " · once" : ""}`}
                      {` · ${l.category}`}
                      {showSource ? ` · planned for ${p.sourceNames[l.fundingSource]}` : ""}
                    </span>
                    {l.lockedBy ? (
                      <span className="mt-1 flex items-center gap-1 text-xs text-ink-2">
                        <Lock className="h-3 w-3" aria-hidden />
                        {l.lockedBy.status === "SUBMITTED" ? `Already in “${l.lockedBy.title}” (in WSUSA review)` : `Funded in full by “${l.lockedBy.title}”`}
                      </span>
                    ) : !l.requestable ? (
                      <span className="mt-1 flex items-center gap-1 text-xs text-ink-2">
                        <Lock className="h-3 w-3" aria-hidden /> Already funded: {fmtMoney(l.fundedCents)}
                      </span>
                    ) : lastDecision ? (
                      <span className="mt-1 block text-xs text-warning">
                        {l.fundedCents
                          ? `${fmtMoney(l.fundedCents)} of ${fmtMoney(l.totalCents)} funded in “${lastDecision.title}”; this asks for the other ${fmtMoney(l.openCents)}`
                          : `Not funded in “${lastDecision.title}”, so you can ask another source`}
                      </span>
                    ) : null}
                  </label>
                  <span className={cn("shrink-0 text-right text-sm font-semibold tabular-nums", locked ? "text-ink-3" : "text-ink")}>
                    {fmtMoney(locked ? l.totalCents : l.openCents)}
                    {!locked && l.openCents < l.totalCents ? <span className="block text-xs font-normal text-ink-3">of {fmtMoney(l.totalCents)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </fieldset>
      );
    });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      aria-busy={pending}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required hint="Short and specific, like “Fall speaker series”.">
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="What's this request for?" required />}
        </Field>
        <Field label="Expected source" required hint="Where you expect the money to come from. WSUSA reviews every request and may fund it from another source.">
          {(id) => (
            <Select id={id} value={source} onChange={(e) => setSource(e.target.value as FundingSource)}>
              {FUNDING_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {p.sourceNames[s]}
                  {s === p.defaultSource ? " (your club's usual source)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field label="Why the club needs it" hint={`What it's for, who it helps and how many people you expect. ${justification.trim().length}/4000 · needed before you submit.`}>
        {(id) => (
          <Textarea
            id={id}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="e.g. Three evening talks with Wasatch Front finance professionals. We expect 35–50 students at each, based on last year's attendance."
          />
        )}
      </Field>

      <section aria-labelledby={`${formId}-lines`} className="space-y-3">
        <div>
          <h2 id={`${formId}-lines`} className="text-base font-semibold text-ink">
            Cost lines · {p.term.name}
          </h2>
          <p className="text-sm text-ink-3">Per-meeting costs count every meeting scheduled this semester. Totals are locked in when you submit.</p>
        </div>
        {matching.length ? (
          <div className="space-y-3">{renderGroups(matching, false)}</div>
        ) : (
          <p className="rounded-xl border border-dashed border-line-2 px-4 py-5 text-center text-sm text-ink-3">
            No costs this semester are planned for {p.sourceNames[source]}. Pick from the other lines below, or choose a different source.
          </p>
        )}
        {others.length ? (
          <div className="space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-sm font-medium text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
              aria-expanded={showOthers}
              onClick={() => setShowOthers((v) => !v)}
            >
              <span>
                {showOthers ? "Hide" : "Show"} {plural(others.length, "line")} planned for other sources
                {othersChosen ? ` (${othersChosen} picked)` : ""}
              </span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", showOthers && "rotate-180")} aria-hidden />
            </button>
            {showOthers ? (
              <>
                <p className="text-xs text-ink-3">Picking one of these puts it in a request you expect {p.sourceNames[source]} to cover. The line&apos;s own planned source doesn&apos;t change.</p>
                {renderGroups(others, true)}
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      {error ? <Callout tone="danger">{error}</Callout> : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-[var(--shadow-pop)] backdrop-blur">
        <div aria-live="polite">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{plural(chosen.length, "line")} picked</p>
          <p className="text-xl font-bold tabular-nums text-ink">{fmtMoney(total)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.initial ? (
            <Button variant="ghost" onClick={() => setDiscarding(true)} disabled={pending}>
              {pendingKind === "discard" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />} Discard
            </Button>
          ) : null}
          <Button type="submit" variant="outline" disabled={pending}>
            {pendingKind === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save draft
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              const msg = problem(true);
              if (msg) return setError(msg);
              setError(null);
              setConfirming(true);
            }}
          >
            {pendingKind === "submit" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Submit for review
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Send ${fmtMoney(total)} to WSUSA for review?`}
        description={`You expect it from ${p.sourceNames[source]}. WSUSA reviews every request, usually within about ${p.reviewDays} business days, and may fund it from another source. Until they decide you can withdraw it, and ${chosen.length === 1 ? "its line stays" : `its ${chosen.length} lines stay`} locked so the budget matches what you asked for.`}
        confirmLabel="Submit request"
        onConfirm={() => save(true)}
      >
        {othersChosen ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-ink-2">
            <Badge tone="warning">Heads up</Badge> {plural(othersChosen, "line")} {othersChosen === 1 ? "was" : "were"} planned for another source.
          </p>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard this draft?"
        description="The draft is deleted. Your cost lines stay in the budget."
        confirmLabel="Discard draft"
        danger
        onConfirm={discard}
      />
    </form>
  );
}
