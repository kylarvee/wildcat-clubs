/**
 * The test editor's data shape and its publish checks — pure and
 * client-safe, so the builder shows the same problems the server enforces
 * (lib/domain/tests.saveTest / publishTest run testProblems too).
 */
import type { QuestionType, TestAudience, TestRecurrence } from "@prisma/client";
import { hasText } from "@/lib/tests/scoring";
import { CLUB_AUDIENCES, UNIVERSITY_AUDIENCES, isChoice, isOpen, type Automation } from "@/lib/tests/types";

export type EditorOption = { id: string; text: string };

export type EditorQuestion = {
  /** Existing question id, or a temporary "new-…" id until the first save. */
  id: string;
  type: QuestionType;
  promptHtml: string;
  options: EditorOption[];
  correctOptionIds: string[];
  modelAnswer: string;
  points: number;
  /** How many submitted answers exist (answered questions can't be removed). */
  answerCount: number;
};

export type EditorTest = {
  title: string;
  introHtml: string;
  timeLimitMinutes: number | null;
  passingPercent: number;
  maxAttempts: number | null;
  audience: TestAudience;
  selectedUserIds: string[];
  recurrence: TestRecurrence;
  dueDays: number;
  /** ISO string (one-off deadline) or null. */
  closesAt: string | null;
  automations: Automation[];
  questions: EditorQuestion[];
};

export type Problem = { questionId?: string; field: string; message: string };

export const LIMITS = {
  title: 120,
  questions: 100,
  options: 12,
  optionText: 500,
  modelAnswer: 4000,
  points: 100,
  timeLimit: 600,
  attempts: 20,
  dueDays: 365,
} as const;

export const isTempId = (id: string) => id.startsWith("new-");

/** Next option id: a, b, c… then o27, o28… (ids only need to be unique within a question). */
export function nextOptionId(existing: string[]): string {
  const taken = new Set(existing);
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(97 + i);
    if (!taken.has(id)) return id;
  }
  let n = 27;
  while (taken.has(`o${n}`)) n++;
  return `o${n}`;
}

/** A blank question of a type, with sensible starting options. */
export function blankQuestion(type: QuestionType, tempId: string): EditorQuestion {
  return {
    id: tempId,
    type,
    promptHtml: "",
    options: isChoice(type) ? [{ id: "a", text: "" }, { id: "b", text: "" }] : [],
    correctOptionIds: [],
    modelAnswer: "",
    points: 1,
    answerCount: 0,
  };
}

/** Switching type keeps the prompt; choice ↔ choice keeps options (a single answer keeps only its first correct option). */
export function changeQuestionType(q: EditorQuestion, type: QuestionType): EditorQuestion {
  if (q.type === type) return q;
  if (isChoice(type)) {
    const options = isChoice(q.type) && q.options.length ? q.options : [{ id: "a", text: "" }, { id: "b", text: "" }];
    const correct = isChoice(q.type) ? (type === "SINGLE_CHOICE" ? q.correctOptionIds.slice(0, 1) : q.correctOptionIds) : [];
    return { ...q, type, options, correctOptionIds: correct };
  }
  return { ...q, type, options: [], correctOptionIds: [] };
}

/** Everything that must be true before a test can be published (and while it stays published). */
export function testProblems(t: EditorTest, scope: "club" | "university"): Problem[] {
  const out: Problem[] = [];
  if (t.title.trim().length < 3) out.push({ field: "title", message: "Give the test a title (at least 3 characters)." });
  const allowed = scope === "club" ? CLUB_AUDIENCES : UNIVERSITY_AUDIENCES;
  if (!allowed.includes(t.audience)) out.push({ field: "audience", message: "Choose who takes this test." });
  if (t.audience === "SELECTED_USERS" && t.selectedUserIds.length === 0) out.push({ field: "audience", message: "Pick at least one person to take this test." });
  if (t.timeLimitMinutes !== null && (t.timeLimitMinutes < 1 || t.timeLimitMinutes > LIMITS.timeLimit)) out.push({ field: "timeLimit", message: `Time limits run from 1 to ${LIMITS.timeLimit} minutes.` });
  if (t.passingPercent < 1 || t.passingPercent > 100) out.push({ field: "passing", message: "The passing score must be between 1% and 100%." });
  if (t.maxAttempts !== null && (t.maxAttempts < 1 || t.maxAttempts > LIMITS.attempts)) out.push({ field: "attempts", message: `Allow between 1 and ${LIMITS.attempts} attempts, or unlimited.` });
  if (t.recurrence !== "ONE_OFF" && (t.dueDays < 1 || t.dueDays > LIMITS.dueDays)) out.push({ field: "due", message: "People need at least 1 day to finish each round." });
  if (t.questions.length === 0) out.push({ field: "questions", message: "Add at least one question." });
  t.questions.forEach((q, i) => {
    const n = `Question ${i + 1}`;
    if (!hasText(q.promptHtml)) out.push({ questionId: q.id, field: "prompt", message: `${n} needs a question.` });
    if (q.points < 1 || q.points > LIMITS.points) out.push({ questionId: q.id, field: "points", message: `${n} must be worth 1–${LIMITS.points} points.` });
    if (isChoice(q.type)) {
      const filled = q.options.filter((o) => o.text.trim());
      if (filled.length < 2) out.push({ questionId: q.id, field: "options", message: `${n} needs at least two answer choices.` });
      if (q.options.some((o) => !o.text.trim())) out.push({ questionId: q.id, field: "options", message: `${n} has an empty answer choice — fill it in or remove it.` });
      const ids = new Set(q.options.map((o) => o.id));
      const correct = q.correctOptionIds.filter((id) => ids.has(id));
      if (q.type === "SINGLE_CHOICE" && correct.length !== 1) out.push({ questionId: q.id, field: "correct", message: `${n}: mark the one correct answer.` });
      if (q.type === "MULTI_CHOICE" && correct.length < 1) out.push({ questionId: q.id, field: "correct", message: `${n}: mark every correct answer.` });
      if (q.type === "MULTI_CHOICE" && correct.length === filled.length && filled.length > 0) out.push({ questionId: q.id, field: "correct", message: `${n}: at least one choice should be wrong, or everyone gets it right by picking all of them.` });
    }
    if (isOpen(q.type) && !q.modelAnswer.trim()) out.push({ questionId: q.id, field: "model", message: `${n}: describe what a correct answer looks like, so reviewers have something to compare against.` });
  });
  return out;
}

export function totalPoints(t: Pick<EditorTest, "questions">): number {
  return t.questions.reduce((s, q) => s + (Number.isFinite(q.points) ? q.points : 0), 0);
}
