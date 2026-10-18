"use client";

import { useId } from "react";
import type { QuestionType } from "@prisma/client";
import { ArrowDown, ArrowUp, Check, Copy, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input, Select, Textarea } from "@/components/ui/form";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import { NumberInput } from "@/components/tests/NumberInput";
import { changeQuestionType, LIMITS, nextOptionId, type EditorQuestion, type Problem } from "@/lib/tests/editor";
import { isChoice, QUESTION_TYPE_LABEL } from "@/lib/tests/types";

export type BuilderQuestion = EditorQuestion & { key: string };

const TYPES: QuestionType[] = ["SINGLE_CHOICE", "MULTI_CHOICE", "SHORT_ANSWER", "LONG_ANSWER"];

/**
 * One question in the builder: type, prompt, answer choices (with the correct ones marked) or a model answer, and points.
 * For a form it's only the type, the prompt and the choices: nothing is graded, and one choice ("I agree") is enough.
 */
export function QuestionCard({
  question: q,
  index,
  total,
  clubId,
  aiOn,
  isForm,
  problems,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  question: BuilderQuestion;
  index: number;
  total: number;
  clubId: string | null;
  aiOn: boolean;
  isForm: boolean;
  problems: Problem[];
  onChange: (q: BuilderQuestion) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const n = index + 1;
  const headingId = useId();
  const typeId = useId();
  const pointsId = useId();
  const modelId = useId();
  const answered = q.answerCount > 0;
  const choice = isChoice(q.type);
  const graded = !isForm;
  const fewestChoices = isForm ? 1 : 2;
  const set = (patch: Partial<BuilderQuestion>) => onChange({ ...q, ...patch });

  const toggleCorrect = (optId: string) => {
    if (q.type === "SINGLE_CHOICE") return set({ correctOptionIds: [optId] });
    set({ correctOptionIds: q.correctOptionIds.includes(optId) ? q.correctOptionIds.filter((x) => x !== optId) : [...q.correctOptionIds, optId] });
  };
  const fieldProblem = (f: string) => problems.filter((p) => p.field === f);

  return (
    <article aria-labelledby={headingId} className={cn("rounded-[var(--radius-card)] border bg-surface shadow-[var(--shadow-card)]", problems.length ? "border-amber-300" : "border-line")}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h3 id={headingId} className="mr-auto text-sm font-semibold text-ink">
          Question {n}
          {answered ? <span className="ml-2 font-normal text-ink-3">· answered {q.answerCount} {q.answerCount === 1 ? "time" : "times"}</span> : null}
        </h3>
        <Button variant="ghost" size="icon" aria-label={`Move question ${n} up`} onClick={() => onMove(-1)} disabled={index === 0}>
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={`Move question ${n} down`} onClick={() => onMove(1)} disabled={index === total - 1}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={`Duplicate question ${n}`} onClick={onDuplicate} disabled={total >= LIMITS.questions}>
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={answered ? `Question ${n} has answers and can't be deleted` : `Delete question ${n}`}
          title={answered ? `People have answered this question, so it can't be deleted. Reword it, or copy the ${isForm ? "form" : "test"}.` : undefined}
          onClick={onDelete}
          disabled={answered}
          className="text-danger hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </header>

      <div className="space-y-4 px-4 py-4">
        <div className={cn("grid gap-3", graded && "sm:grid-cols-[minmax(0,1fr)_8rem]")}>
          <div className="space-y-1.5">
            <label htmlFor={typeId} className="block text-sm font-medium text-ink">
              Type
            </label>
            <Select id={typeId} value={q.type} onChange={(e) => onChange({ ...changeQuestionType(q, e.target.value as QuestionType), key: q.key })}>
              {TYPES.map((t) => (
                <option key={t} value={t} disabled={answered && isChoice(t) !== choice}>
                  {QUESTION_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          {graded ? (
            <div className="space-y-1.5">
              <label htmlFor={pointsId} className="block text-sm font-medium text-ink">
                Points
              </label>
              <NumberInput id={pointsId} value={q.points} onValue={(v) => set({ points: v })} min={1} max={LIMITS.points} />
            </div>
          ) : null}
        </div>
        {graded ? <Messages problems={fieldProblem("points")} /> : null}

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink">Question</p>
          <RichTextEditor
            defaultValue={q.promptHtml}
            onChange={(html) => set({ promptHtml: html })}
            clubId={clubId}
            variant="basic"
            minHeight={72}
            ariaLabel={`Question ${n} text`}
            placeholder="Write the question…"
          />
          <Messages problems={fieldProblem("prompt")} />
        </div>

        {choice ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">Answer choices</legend>
            <p className="text-xs text-ink-3">
              {isForm
                ? q.type === "SINGLE_CHOICE"
                  ? "People pick one. A single choice like “I agree” makes an acknowledgement."
                  : "People pick at least one."
                : q.type === "SINGLE_CHOICE"
                  ? "Mark the one correct answer."
                  : "Mark every correct answer. People get the points only when they pick exactly these."}
            </p>
            <ul className="space-y-2">
              {q.options.map((o, i) => {
                const correct = q.correctOptionIds.includes(o.id);
                const letter = String.fromCharCode(65 + (i % 26));
                return (
                  <li key={o.id} className="flex items-center gap-2">
                    {graded ? (
                      <button
                        type="button"
                        role={q.type === "SINGLE_CHOICE" ? "radio" : "checkbox"}
                        aria-checked={correct}
                        aria-label={`Choice ${letter} is ${correct ? "" : "not "}a correct answer`}
                        onClick={() => toggleCorrect(o.id)}
                        className={cn(
                          "inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                          correct ? "border-success bg-success-50 text-success" : "border-line-2 text-ink-3 hover:bg-muted",
                        )}
                      >
                        {correct ? <Check className="h-4 w-4" aria-hidden /> : <span className="inline-block h-4 w-4 rounded-full border border-current" aria-hidden />}
                        <span className="hidden sm:inline">{correct ? "Correct" : "Mark correct"}</span>
                      </button>
                    ) : null}
                    <Input
                      value={o.text}
                      maxLength={LIMITS.optionText}
                      onChange={(e) => set({ options: q.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })}
                      placeholder={`Choice ${letter}`}
                      aria-label={`Question ${n}, choice ${letter}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove choice ${letter}`}
                      disabled={q.options.length <= fewestChoices}
                      onClick={() => set({ options: q.options.filter((x) => x.id !== o.id), correctOptionIds: q.correctOptionIds.filter((x) => x !== o.id) })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set({ options: [...q.options, { id: nextOptionId(q.options.map((o) => o.id)), text: "" }] })}
              disabled={q.options.length >= LIMITS.options}
            >
              <Plus className="h-4 w-4" aria-hidden /> Add a choice
            </Button>
            <Messages problems={[...fieldProblem("options"), ...(graded ? fieldProblem("correct") : [])]} />
          </fieldset>
        ) : isForm ? (
          <p className="text-xs text-ink-3">People write their answer{q.type === "LONG_ANSWER" ? " — as long as they need" : " in a sentence or two"}. It&apos;s required, like every question on a form.</p>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor={modelId} className="block text-sm font-medium text-ink">
              What a correct answer looks like
            </label>
            <Textarea
              id={modelId}
              rows={q.type === "LONG_ANSWER" ? 5 : 3}
              maxLength={LIMITS.modelAnswer}
              value={q.modelAnswer}
              onChange={(e) => set({ modelAnswer: e.target.value })}
              placeholder={q.type === "LONG_ANSWER" ? "The points a full answer covers, and what earns partial credit…" : "The answer you're looking for, and any acceptable variations…"}
            />
            <p className="text-xs text-ink-3">
              Only reviewers see this, next to each person&apos;s answer.{aiOn ? " Claude also compares answers against it to suggest points." : ""} People taking the test never see it.
            </p>
            <Messages problems={fieldProblem("model")} />
          </div>
        )}
      </div>
    </article>
  );
}

function Messages({ problems }: { problems: Problem[] }) {
  if (!problems.length) return null;
  return (
    <ul className="space-y-0.5">
      {problems.map((p, i) => (
        <li key={i} className="text-xs text-danger">
          {p.message}
        </li>
      ))}
    </ul>
  );
}
