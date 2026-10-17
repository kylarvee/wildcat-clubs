"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { QuestionType } from "@prisma/client";
import { AlertCircle, Check, CheckCircle2, Loader2, MinusCircle, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input, Textarea } from "@/components/ui/form";
import { toast } from "@/components/ui/misc";
import { finalizeGradingAction, suggestGradeAction } from "@/components/tests/actions";
import { clampPoints, passes, percentOf } from "@/lib/tests/scoring";
import { fmtPoints, isChoice, type QuestionOption } from "@/lib/tests/types";

export type GradingItem = {
  questionId: string;
  answerId: string | null;
  n: number;
  type: QuestionType;
  points: number;
  prompt: ReactNode;
  /** Rendered written answer (null when blank or a choice question). */
  answer: ReactNode | null;
  blank: boolean;
  modelAnswer: string | null;
  options: (QuestionOption & { correct: boolean; picked: boolean })[];
  /** Points already settled (choice questions and blank answers); null = a reviewer must score it. */
  settled: number | null;
  ai: { points: number; feedback: string; model: string } | null;
  comment: string | null;
};

/**
 * Grade one attempt: each written answer sits next to its question and the
 * builder's model answer. When grading assist is on, Claude's suggestion is
 * shown as advice ("Suggestion — you decide"); the reviewer always sets the
 * points and finalizes. readOnly shows a graded attempt the same way.
 */
export function GradingForm({
  attemptId,
  items,
  passingPercent,
  aiOn,
  readOnly,
  ownAttempt,
  nextHref,
}: {
  attemptId: string;
  items: GradingItem[];
  passingPercent: number;
  aiOn: boolean;
  readOnly: boolean;
  ownAttempt: boolean;
  nextHref: string;
}) {
  const router = useRouter();
  const pendingItems = items.filter((i) => i.settled === null);
  const [points, setPoints] = useState<Record<string, string>>(() => Object.fromEntries(pendingItems.map((i) => [i.questionId, ""])));
  const [comments, setComments] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.questionId, i.comment ?? ""])));
  const [ai, setAi] = useState<Record<string, GradingItem["ai"]>>(() => Object.fromEntries(items.map((i) => [i.questionId, i.ai])));
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const parsed = (qid: string, max: number): number | null => {
    const raw = points[qid];
    if (raw === undefined || raw.trim() === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > max) return null;
    return clampPoints(n, max);
  };

  const totals = useMemo(() => {
    let earned = 0;
    let possible = 0;
    let missing = 0;
    for (const i of items) {
      possible += i.points;
      if (i.settled !== null) earned += i.settled;
      else {
        const p = parsed(i.questionId, i.points);
        if (p === null) missing++;
        else earned += p;
      }
    }
    const percent = percentOf(earned, possible);
    return { earned, possible, missing, percent, pass: passes(percent, passingPercent) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, items, passingPercent]);

  const askClaude = async (item: GradingItem) => {
    if (!item.answerId) return;
    setAsking(item.questionId);
    const r = await suggestGradeAction(item.answerId).catch(() => null);
    setAsking(null);
    if (!r) return toast.error("We couldn't reach the server. Try again.");
    if (!r.ok) return toast.error(r.error);
    setAi((s) => ({ ...s, [item.questionId]: { points: r.data.points, feedback: r.data.feedback, model: `${r.data.model} · ${r.data.confidence}` } }));
  };

  const finalize = () => {
    setError(null);
    const grades: { questionId: string; points: number; comment?: string }[] = [];
    for (const i of pendingItems) {
      const p = parsed(i.questionId, i.points);
      if (p === null) {
        setError(`Give question ${i.n} between 0 and ${i.points} points before finishing.`);
        document.getElementById(`points-${i.questionId}`)?.focus();
        return;
      }
      grades.push({ questionId: i.questionId, points: p, comment: comments[i.questionId]?.trim() || undefined });
    }
    start(async () => {
      const r = await finalizeGradingAction(attemptId, grades).catch(() => null);
      if (!r) return setError("We couldn't reach the server. Your points are still here — try again.");
      if (!r.ok) return setError(r.error);
      toast.success(`Graded: ${fmtPoints(r.data.scorePercent)}% — ${r.data.passed ? "passed" : "not passed"}. They've been notified.`);
      router.push(nextHref);
    });
  };

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {items.map((i) => (
          <li key={i.questionId}>
            <article aria-labelledby={`grade-q-${i.questionId}`} className={cn("rounded-[var(--radius-card)] border bg-surface shadow-[var(--shadow-card)]", i.settled === null && !readOnly ? "border-brand-200" : "border-line")}>
              <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                <h3 id={`grade-q-${i.questionId}`} className="text-sm font-semibold text-ink">
                  Question {i.n}
                </h3>
                <span className="text-xs text-ink-3">
                  {isChoice(i.type) ? "Multiple choice · scored automatically" : i.type === "SHORT_ANSWER" ? "Short answer" : "Long answer"}
                </span>
                <span className="ml-auto text-sm font-medium tabular-nums text-ink">
                  {i.settled !== null ? fmtPoints(i.settled) : (parsed(i.questionId, i.points) ?? "—")} / {i.points}
                </span>
              </header>
              <div className="space-y-3 px-4 py-3">
                <div className="text-ink">{i.prompt}</div>

                {isChoice(i.type) ? (
                  <ul className="space-y-1.5">
                    {i.options.map((o) => (
                      <li key={o.id} className={cn("flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-sm", o.picked ? "bg-muted" : "")}>
                        {o.correct ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Correct answer" /> : <span className="inline-block h-4 w-4 shrink-0" aria-hidden />}
                        <span className={cn("flex-1", o.picked ? "font-medium text-ink" : "text-ink-2")}>{o.text}</span>
                        {o.picked ? <Badge tone={o.correct ? "success" : "danger"}>{o.correct ? "Picked" : "Picked (wrong)"}</Badge> : null}
                      </li>
                    ))}
                    {!i.options.some((o) => o.picked) ? (
                      <li className="flex items-center gap-1.5 px-2.5 text-sm text-ink-3">
                        <MinusCircle className="h-4 w-4" aria-hidden /> No answer
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-xl border border-line px-3 py-2.5">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">Their answer</p>
                      {i.blank ? (
                        <p className="flex items-center gap-1.5 text-sm text-ink-3">
                          <MinusCircle className="h-4 w-4" aria-hidden /> No answer — 0 points
                        </p>
                      ) : (
                        <div className="text-sm">{i.answer}</div>
                      )}
                    </div>
                    <div className="rounded-xl bg-muted/60 px-3 py-2.5">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">What a correct answer looks like</p>
                      <p className="whitespace-pre-line text-sm text-ink-2">{i.modelAnswer?.trim() || "The builder didn't describe one."}</p>
                    </div>
                  </div>
                )}

                {aiOn && !isChoice(i.type) && !i.blank ? (
                  <AiSuggestion
                    item={i}
                    suggestion={ai[i.questionId]}
                    asking={asking === i.questionId}
                    canAsk={!readOnly && i.settled === null}
                    onAsk={() => void askClaude(i)}
                    onUse={(p) => setPoints((s) => ({ ...s, [i.questionId]: String(p) }))}
                  />
                ) : null}

                {i.settled === null && !readOnly ? (
                  <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                    <div>
                      <label htmlFor={`points-${i.questionId}`} className="block text-sm font-medium text-ink">
                        Points (0–{i.points})
                      </label>
                      <Input
                        id={`points-${i.questionId}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={i.points}
                        step={0.5}
                        value={points[i.questionId] ?? ""}
                        onChange={(e) => setPoints((s) => ({ ...s, [i.questionId]: e.target.value }))}
                        className="mt-1.5"
                        aria-describedby={`points-hint-${i.questionId}`}
                      />
                      <p id={`points-hint-${i.questionId}`} className="mt-1 text-xs text-ink-3">
                        Half points allowed.
                      </p>
                    </div>
                    <div>
                      <label htmlFor={`comment-${i.questionId}`} className="block text-sm font-medium text-ink">
                        Note to them <span className="font-normal text-ink-3">(optional)</span>
                      </label>
                      <Textarea
                        id={`comment-${i.questionId}`}
                        rows={2}
                        maxLength={2000}
                        value={comments[i.questionId] ?? ""}
                        onChange={(e) => setComments((s) => ({ ...s, [i.questionId]: e.target.value }))}
                        className="mt-1.5"
                        placeholder="What they got right, or what was missing"
                      />
                    </div>
                  </div>
                ) : i.comment ? (
                  <div className="rounded-xl border border-line px-3 py-2">
                    <p className="text-xs font-medium text-ink-3">Note to them</p>
                    <p className="whitespace-pre-line text-sm text-ink">{i.comment}</p>
                  </div>
                ) : null}
              </div>
            </article>
          </li>
        ))}
      </ol>

      {!readOnly ? (
        <div className="sticky bottom-0 z-20 rounded-t-2xl border border-line bg-surface/95 px-4 py-3 shadow-[var(--shadow-pop)] backdrop-blur">
          {error ? (
            <p role="alert" className="mb-2 flex items-start gap-2 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
            </p>
          ) : null}
          {ownAttempt ? (
            <p className="mb-2 text-sm text-warning">This is your own attempt, so someone else has to grade it.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-sm text-ink-2" aria-live="polite">
              {totals.missing ? (
                <>
                  {totals.missing} {totals.missing === 1 ? "answer" : "answers"} left to score
                </>
              ) : (
                <span className="flex items-center gap-1.5">
                  {totals.pass ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : <XCircle className="h-4 w-4 text-danger" aria-hidden />}
                  {fmtPoints(totals.earned)} of {totals.possible} points · {fmtPoints(totals.percent)}% · {totals.pass ? "passes" : "doesn't pass"} ({passingPercent}% needed)
                </span>
              )}
            </p>
            <Button onClick={finalize} disabled={saving || ownAttempt}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Finish grading
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** "claude-haiku-5-5 · high" → "Claude Haiku · high confidence". */
function modelLabel(stored: string): string {
  const [model, confidence] = stored.split(" · ");
  const name = /haiku/i.test(model) ? "Claude Haiku" : /sonnet/i.test(model) ? "Claude Sonnet" : "Claude";
  return confidence ? `${name} · ${confidence} confidence` : name;
}

function AiSuggestion({
  item,
  suggestion,
  asking,
  canAsk,
  onAsk,
  onUse,
}: {
  item: GradingItem;
  suggestion: GradingItem["ai"];
  asking: boolean;
  canAsk: boolean;
  onAsk: () => void;
  onUse: (points: number) => void;
}) {
  if (!suggestion) {
    if (!canAsk) return null;
    return (
      <Button variant="secondary" size="sm" onClick={onAsk} disabled={asking}>
        {asking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />} {asking ? "Asking Claude…" : "Ask Claude for a suggestion"}
      </Button>
    );
  }
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand" aria-hidden />
        <p className="text-sm font-semibold text-brand-700">Suggestion — you decide</p>
        <span className="text-xs text-ink-3">{modelLabel(suggestion.model)}</span>
        <span className="ml-auto text-sm font-medium tabular-nums text-ink">
          {fmtPoints(suggestion.points)} / {item.points}
        </span>
      </div>
      {suggestion.feedback ? <p className="mt-1 text-sm text-ink-2">{suggestion.feedback}</p> : null}
      {canAsk ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onUse(suggestion.points)}>
            Use {fmtPoints(suggestion.points)} {suggestion.points === 1 ? "point" : "points"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onAsk} disabled={asking}>
            {asking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Ask again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
