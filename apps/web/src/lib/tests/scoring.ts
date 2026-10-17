/**
 * Scoring — pure, so the same rules run on submit, in the grading screen and
 * in tests. Choice questions are all-or-nothing: you get the points only when
 * you picked exactly the correct options (no partial credit for picking two
 * of three). Open answers need a person, except blank ones, which score 0.
 */
import type { QuestionType } from "@prisma/client";
import { isChoice, isOpen } from "@/lib/tests/types";

export type ScoringQuestion = { id: string; type: QuestionType; points: number; correctOptionIds: string[] };
export type ScoringAnswer = { questionId: string; selectedOptionIds: string[]; text: string | null; pointsAwarded?: number | null };

/** True when rich-text HTML has something a person actually wrote (not just empty paragraphs). */
export function hasText(html: string | null | undefined): boolean {
  if (!html) return false;
  if (/<(img|iframe)\b|data-embed=/i.test(html)) return true;
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, "x")
    .trim();
  return text.length > 0;
}

/** All-or-nothing: the chosen set must equal the correct set exactly. */
export function choiceCorrect(correctOptionIds: string[], selected: string[]): boolean {
  const correct = new Set(correctOptionIds);
  const picked = new Set(selected);
  if (correct.size === 0 || picked.size !== correct.size) return false;
  for (const id of picked) if (!correct.has(id)) return false;
  return true;
}

/** Points a question earns without a person: choice → full or 0; blank open → 0; written open → null (needs review). */
export function autoPoints(q: ScoringQuestion, a: ScoringAnswer | undefined): number | null {
  if (isChoice(q.type)) return a && choiceCorrect(q.correctOptionIds, a.selectedOptionIds) ? q.points : 0;
  if (isOpen(q.type)) return a && hasText(a.text) ? null : 0;
  return 0;
}

export function isAnswered(q: Pick<ScoringQuestion, "type">, a: Pick<ScoringAnswer, "selectedOptionIds" | "text"> | undefined): boolean {
  if (!a) return false;
  return isChoice(q.type) ? a.selectedOptionIds.length > 0 : hasText(a.text);
}

export type AttemptScore = {
  /** Points earned so far (graded questions only). */
  earned: number;
  possible: number;
  /** Final percent, or null while open answers wait for review. */
  percent: number | null;
  passed: boolean | null;
  /** Questions a reviewer still has to score. */
  pendingQuestionIds: string[];
  /** Score on the choice questions alone (shown right away, before review). */
  choiceEarned: number;
  choicePossible: number;
};

/**
 * Scores an attempt. Uses a reviewer's pointsAwarded on open answers when
 * present; otherwise open answers with text are pending.
 */
export function scoreAttempt(questions: ScoringQuestion[], answers: ScoringAnswer[], passingPercent: number): AttemptScore {
  const byQ = new Map(answers.map((a) => [a.questionId, a]));
  let earned = 0;
  let possible = 0;
  let choiceEarned = 0;
  let choicePossible = 0;
  const pending: string[] = [];
  for (const q of questions) {
    possible += q.points;
    const a = byQ.get(q.id);
    if (isChoice(q.type)) {
      const p = autoPoints(q, a) ?? 0;
      earned += p;
      choiceEarned += p;
      choicePossible += q.points;
      continue;
    }
    const auto = autoPoints(q, a);
    if (auto !== null) {
      earned += auto;
    } else if (a?.pointsAwarded !== null && a?.pointsAwarded !== undefined) {
      earned += clampPoints(a.pointsAwarded, q.points);
    } else {
      pending.push(q.id);
    }
  }
  const done = pending.length === 0;
  const percent = done ? percentOf(earned, possible) : null;
  return {
    earned,
    possible,
    percent,
    passed: percent === null ? null : passes(percent, passingPercent),
    pendingQuestionIds: pending,
    choiceEarned,
    choicePossible,
  };
}

export function percentOf(earned: number, possible: number): number {
  if (possible <= 0) return 0;
  return Math.round((earned / possible) * 1000) / 10; // one decimal place
}

/** A tiny tolerance so 79.99999 from float math still counts as 80. */
export function passes(percent: number, passingPercent: number): boolean {
  return percent + 1e-9 >= passingPercent;
}

/** Reviewer points: 0..max in half-point steps. */
export function clampPoints(points: number, max: number): number {
  if (!Number.isFinite(points)) return 0;
  const half = Math.round(points * 2) / 2;
  return Math.max(0, Math.min(max, half));
}
