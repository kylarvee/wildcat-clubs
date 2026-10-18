import "server-only";
import { Prisma, type AssignmentStatus, type AttemptStatus, type QuestionType, type TestAudience, type TestRecurrence, type TestStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { cycleForTest } from "@/lib/domain/tests";
import { cycleKeyLabel, type Cycle } from "@/lib/tests/cycles";
import { isChoice, parseOptions, type QuestionOption } from "@/lib/tests/types";
import { scoreAttempt } from "@/lib/tests/scoring";
import { richToText } from "@/lib/rich/sanitize";

/**
 * Read models for the Test Tool (builders' lists, results, grading, and the
 * taker's own pages). Read-only — every write goes through lib/domain/tests.
 * Numbers are computed here once so the list, the results page and the CSV
 * agree.
 */

// ─── Summary statistics ──────────────────────────────────────────────────────

export type TestStats = {
  /** Submitted attempts (waiting for review or graded). */
  attempts: number;
  takers: number;
  graded: number;
  /** Graded attempts with a score (form responses have none). */
  scored: number;
  passed: number;
  /** passed ÷ graded, 0–1. */
  passRate: number | null;
  /** Mean final score of scored attempts, 0–100. */
  avgScore: number | null;
  /** Mean time from start to hand-in. */
  avgTimeMs: number | null;
  needsReview: number;
  inProgress: number;
  // Sums so an "All tests" row can weight each test by its attempts.
  scoreSum: number;
  timeSumMs: number;
};

const EMPTY_STATS: TestStats = { attempts: 0, takers: 0, graded: 0, scored: 0, passed: 0, passRate: null, avgScore: null, avgTimeMs: null, needsReview: 0, inProgress: 0, scoreSum: 0, timeSumMs: 0 };

type StatsRow = {
  testId: string;
  submitted: number;
  takers: number;
  graded: number;
  scored: number;
  passed: number;
  score_sum: number | null;
  seconds_sum: number | null;
  needs_review: number;
  in_progress: number;
};

/** One pass over TestAttempt for many tests. `cycleKey` limits it to one round. */
export async function testStatsFor(testIds: string[], opts: { cycleKey?: string | null } = {}): Promise<Map<string, TestStats>> {
  const out = new Map<string, TestStats>();
  if (!testIds.length) return out;
  const cycle = opts.cycleKey ? Prisma.sql`AND "cycleKey" = ${opts.cycleKey}` : Prisma.empty;
  const rows = await db.$queryRaw<StatsRow[]>`
    SELECT "testId",
      count(*) FILTER (WHERE "submittedAt" IS NOT NULL)::int AS submitted,
      count(DISTINCT "userId") FILTER (WHERE "submittedAt" IS NOT NULL)::int AS takers,
      count(*) FILTER (WHERE status = 'GRADED')::int AS graded,
      count(*) FILTER (WHERE status = 'GRADED' AND "scorePercent" IS NOT NULL)::int AS scored,
      count(*) FILTER (WHERE status = 'GRADED' AND passed)::int AS passed,
      sum("scorePercent") FILTER (WHERE status = 'GRADED')::float8 AS score_sum,
      sum(extract(epoch FROM ("submittedAt" - "startedAt"))) FILTER (WHERE "submittedAt" IS NOT NULL)::float8 AS seconds_sum,
      count(*) FILTER (WHERE status = 'NEEDS_REVIEW')::int AS needs_review,
      count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress
    FROM "TestAttempt"
    WHERE "testId" IN (${Prisma.join(testIds)}) ${cycle}
    GROUP BY "testId"`;
  for (const id of testIds) out.set(id, { ...EMPTY_STATS });
  for (const r of rows) out.set(r.testId, statsFrom(r));
  return out;
}

function statsFrom(r: StatsRow): TestStats {
  const scoreSum = r.score_sum ?? 0;
  const timeSumMs = Math.max(0, (r.seconds_sum ?? 0) * 1000);
  return {
    attempts: r.submitted,
    takers: r.takers,
    graded: r.graded,
    scored: r.scored,
    passed: r.passed,
    passRate: r.graded ? r.passed / r.graded : null,
    avgScore: r.scored ? scoreSum / r.scored : null,
    avgTimeMs: r.submitted ? timeSumMs / r.submitted : null,
    needsReview: r.needs_review,
    inProgress: r.in_progress,
    scoreSum,
    timeSumMs,
  };
}

/** Combines per-test stats into one "All tests" line (weighted by attempts, not averaged averages). */
export function combineStats(list: TestStats[]): TestStats & { takers: number } {
  const t = list.reduce(
    (a, s) => ({
      attempts: a.attempts + s.attempts,
      takers: a.takers + s.takers,
      graded: a.graded + s.graded,
      scored: a.scored + s.scored,
      passed: a.passed + s.passed,
      needsReview: a.needsReview + s.needsReview,
      inProgress: a.inProgress + s.inProgress,
      scoreSum: a.scoreSum + s.scoreSum,
      timeSumMs: a.timeSumMs + s.timeSumMs,
    }),
    { attempts: 0, takers: 0, graded: 0, scored: 0, passed: 0, needsReview: 0, inProgress: 0, scoreSum: 0, timeSumMs: 0 },
  );
  return {
    ...t,
    passRate: t.graded ? t.passed / t.graded : null,
    avgScore: t.scored ? t.scoreSum / t.scored : null,
    avgTimeMs: t.attempts ? t.timeSumMs / t.attempts : null,
  };
}

/** A page title in the right words: `testOrFormTitle(id, "Test results", "Responses")`. Unknown ids get the test wording. */
export async function testOrFormTitle(testId: string, test: string, form: string): Promise<string> {
  const t = await db.test.findUnique({ where: { id: testId }, select: { isForm: true } });
  return t?.isForm ? form : test;
}

// ─── Builder lists ───────────────────────────────────────────────────────────

export type ManagedTestRow = {
  id: string;
  title: string;
  isForm: boolean;
  status: TestStatus;
  audience: TestAudience;
  recurrence: TestRecurrence;
  timeLimitMinutes: number | null;
  passingPercent: number;
  questions: number;
  updatedAt: Date;
  requirementNames: string[];
  cycle: Cycle;
  /** Assignments in the current round (people who owe it). */
  assignment: { total: number; completed: number; missed: number };
  stats: TestStats;
};

const STATUS_ORDER: Record<TestStatus, number> = { PUBLISHED: 0, DRAFT: 1, ARCHIVED: 2 };

/** Tests a scope manages: one club's tests, or WSUSA's university tests (clubId null). */
export async function listManagedTests(clubId: string | null): Promise<ManagedTestRow[]> {
  const tests = await db.test.findMany({
    where: { clubId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { questions: true } },
      requirements: { where: { active: true }, select: { name: true } },
    },
  });
  const ids = tests.map((t) => t.id);
  const [stats, assignments] = await Promise.all([
    testStatsFor(ids),
    ids.length
      ? db.testAssignment.groupBy({ by: ["testId", "cycleKey", "status"], where: { testId: { in: ids } }, _count: { _all: true } })
      : Promise.resolve([] as { testId: string; cycleKey: string; status: AssignmentStatus; _count: { _all: number } }[]),
  ]);
  const rows: ManagedTestRow[] = [];
  for (const t of tests) {
    const cycle = await cycleForTest(t);
    const mine = assignments.filter((a) => a.testId === t.id && a.cycleKey === cycle.key && a.status !== "EXCUSED");
    const count = (s: AssignmentStatus) => mine.filter((a) => a.status === s).reduce((n, a) => n + a._count._all, 0);
    rows.push({
      id: t.id,
      title: t.title,
      isForm: t.isForm,
      status: t.status,
      audience: t.audience,
      recurrence: t.recurrence,
      timeLimitMinutes: t.timeLimitMinutes,
      passingPercent: t.passingPercent,
      questions: t._count.questions,
      updatedAt: t.updatedAt,
      requirementNames: t.requirements.map((r) => r.name),
      cycle,
      assignment: { total: mine.reduce((n, a) => n + a._count._all, 0), completed: count("COMPLETED"), missed: count("MISSED") },
      stats: stats.get(t.id) ?? { ...EMPTY_STATS },
    });
  }
  return rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.updatedAt.getTime() - a.updatedAt.getTime());
}

// ─── Results ─────────────────────────────────────────────────────────────────

export type PersonRef = { id: string; name: string; handle: string; email: string; avatarUrl: string | null; avatarColor: string };

const personSelect = { id: true, name: true, handle: true, email: true, avatarUrl: true, avatarColor: true } as const;

export type ResultRowStatus = "not-started" | "in-progress" | "needs-review" | "passed" | "failed" | "missed" | "excused";

export type ResultRow = {
  person: PersonRef;
  status: ResultRowStatus;
  /** The attempt shown: their passing attempt, else the latest. */
  attempt: { id: string; status: AttemptStatus; scorePercent: number | null; passed: boolean | null; startedAt: Date; submittedAt: Date | null; autoSubmitted: boolean; timeMs: number | null } | null;
  attempts: number;
  dueAt: Date | null;
};

export type ResultsData = {
  cycles: { key: string; label: string; attempts: number }[];
  cycleKey: string | null;
  rows: ResultRow[];
  stats: TestStats;
};

/**
 * One row per person for a round (cycleKey) — or across every round when
 * cycleKey is null. People who were assigned but haven't started are listed
 * too, so the table answers "who still owes this?".
 */
export async function testResults(testId: string, cycleKey: string | null): Promise<ResultsData> {
  const [attempts, assignments, cycleRows] = await Promise.all([
    db.testAttempt.findMany({
      where: { testId, ...(cycleKey ? { cycleKey } : {}) },
      orderBy: { startedAt: "desc" },
      select: { id: true, userId: true, status: true, scorePercent: true, passed: true, startedAt: true, submittedAt: true, autoSubmitted: true, user: { select: personSelect } },
    }),
    db.testAssignment.findMany({
      where: { testId, ...(cycleKey ? { cycleKey } : {}) },
      orderBy: { dueAt: "desc" },
      select: { userId: true, status: true, dueAt: true, user: { select: personSelect } },
    }),
    db.testAttempt.groupBy({ by: ["cycleKey"], where: { testId }, _count: { _all: true }, _max: { startedAt: true } }),
  ]);

  const byUser = new Map<string, ResultRow>();
  for (const a of attempts) {
    const prev = byUser.get(a.userId);
    const timeMs = a.submittedAt ? a.submittedAt.getTime() - a.startedAt.getTime() : null;
    const shown = { id: a.id, status: a.status, scorePercent: a.scorePercent, passed: a.passed, startedAt: a.startedAt, submittedAt: a.submittedAt, autoSubmitted: a.autoSubmitted, timeMs };
    if (!prev) {
      byUser.set(a.userId, { person: a.user, status: attemptStatus(a), attempt: shown, attempts: 1, dueAt: null });
      continue;
    }
    prev.attempts++;
    // A pass anywhere in the round is what counts; otherwise keep the latest (attempts come newest first).
    if (a.passed && !prev.attempt?.passed) {
      prev.attempt = shown;
      prev.status = "passed";
    }
  }
  for (const a of assignments) {
    const row = byUser.get(a.userId);
    if (row) {
      row.dueAt ??= a.dueAt;
      continue;
    }
    if (a.status === "EXCUSED") continue;
    byUser.set(a.userId, { person: a.user, status: a.status === "MISSED" ? "missed" : a.status === "COMPLETED" ? "passed" : "not-started", attempt: null, attempts: 0, dueAt: a.dueAt });
  }

  const order: Record<ResultRowStatus, number> = { "needs-review": 0, "in-progress": 1, failed: 2, missed: 3, "not-started": 4, passed: 5, excused: 6 };
  const rows = [...byUser.values()].sort((a, b) => order[a.status] - order[b.status] || a.person.name.localeCompare(b.person.name));
  const stats = (await testStatsFor([testId], { cycleKey })).get(testId) ?? { ...EMPTY_STATS };
  const cycles = cycleRows
    .sort((a, b) => (b._max.startedAt?.getTime() ?? 0) - (a._max.startedAt?.getTime() ?? 0))
    .map((c) => ({ key: c.cycleKey, label: cycleKeyLabel(c.cycleKey), attempts: c._count._all }));
  return { cycles, cycleKey, rows, stats };
}

function attemptStatus(a: { status: AttemptStatus; passed: boolean | null }): ResultRowStatus {
  if (a.status === "IN_PROGRESS") return "in-progress";
  if (a.status === "NEEDS_REVIEW") return "needs-review";
  return a.passed ? "passed" : "failed";
}

// ─── Form responses (CSV) ────────────────────────────────────────────────────

/**
 * A form's responses as CSV rows (header first): one row per person in the
 * round (or every round), with each question's answer in its own column.
 * Choices are joined with "; ", written answers become plain text. People who
 * owe it but haven't submitted are listed with empty answers.
 */
export async function formResponseRows(testId: string, cycleKey: string | null): Promise<(string | number)[][]> {
  const [questions, { rows }] = await Promise.all([db.testQuestion.findMany({ where: { testId }, orderBy: { order: "asc" } }), testResults(testId, cycleKey)]);
  const attemptIds = rows.map((r) => r.attempt?.id).filter((id): id is string => Boolean(id));
  const answers = attemptIds.length ? await db.testAnswer.findMany({ where: { attemptId: { in: attemptIds } }, select: { attemptId: true, questionId: true, selectedOptionIds: true, text: true } }) : [];
  const byAttempt = new Map<string, Map<string, (typeof answers)[number]>>();
  for (const a of answers) {
    const m = byAttempt.get(a.attemptId) ?? new Map();
    m.set(a.questionId, a);
    byAttempt.set(a.attemptId, m);
  }
  const options = new Map(questions.map((q) => [q.id, new Map(parseOptions(q.options).map((o) => [o.id, o.text]))]));
  const STATUS: Record<ResultRowStatus, string> = {
    passed: "Submitted",
    "in-progress": "Started",
    "not-started": "Not yet",
    missed: "Missed deadline",
    excused: "Excused",
    "needs-review": "Submitted",
    failed: "Submitted",
  };
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");
  const header = ["Name", "Email", "Status", "Submitted", "Due", ...questions.map((q, i) => `Q${i + 1}: ${richToText(q.promptHtml, 120).replace(/\s+/g, " ")}`)];
  const body = rows.map((r) => {
    // Only handed-in answers are responses; a form someone is still filling out shows blank.
    const mine = r.attempt && r.attempt.status !== "IN_PROGRESS" ? byAttempt.get(r.attempt.id) : undefined;
    return [
      r.person.name,
      r.person.email,
      STATUS[r.status],
      r.attempt?.status === "IN_PROGRESS" ? "" : iso(r.attempt?.submittedAt),
      iso(r.dueAt),
      ...questions.map((q) => {
        const a = mine?.get(q.id);
        if (!a) return "";
        if (isChoice(q.type)) return a.selectedOptionIds.map((id) => options.get(q.id)?.get(id) ?? "").filter(Boolean).join("; ");
        return richToText(a.text, 100_000);
      }),
    ];
  });
  return [header, ...body];
}

// ─── Per-question statistics ─────────────────────────────────────────────────

export type QuestionStat = {
  id: string;
  order: number;
  type: QuestionType;
  promptHtml: string;
  points: number;
  options: (QuestionOption & { correct: boolean; picked: number })[];
  /** Submitted attempts that reached this question with an answer. */
  answered: number;
  /** Attempts scored on this question (choice: all answered; open: graded ones). */
  scored: number;
  /** Share of scored answers that earned full points, 0–1. */
  correctRate: number | null;
  /** Average share of points earned (open questions give partial credit), 0–1. */
  avgPointsRate: number | null;
  pendingReview: number;
};

export async function questionStats(testId: string, cycleKey: string | null): Promise<QuestionStat[]> {
  const [questions, answers] = await Promise.all([
    db.testQuestion.findMany({ where: { testId }, orderBy: { order: "asc" } }),
    db.testAnswer.findMany({
      where: { attempt: { testId, status: { in: ["NEEDS_REVIEW", "GRADED"] }, ...(cycleKey ? { cycleKey } : {}) } },
      select: { questionId: true, selectedOptionIds: true, text: true, pointsAwarded: true },
    }),
  ]);
  const byQ = new Map<string, typeof answers>();
  for (const a of answers) {
    const list = byQ.get(a.questionId);
    if (list) list.push(a);
    else byQ.set(a.questionId, [a]);
  }
  return questions.map((q) => {
    const list = byQ.get(q.id) ?? [];
    const options = parseOptions(q.options);
    const correct = new Set(q.correctOptionIds);
    const answered = list.filter((a) => (isChoice(q.type) ? a.selectedOptionIds.length > 0 : Boolean(a.text))).length;
    const scoredList = list.filter((a) => a.pointsAwarded !== null);
    const full = scoredList.filter((a) => (a.pointsAwarded ?? 0) >= q.points - 1e-9).length;
    const pointsSum = scoredList.reduce((s, a) => s + (a.pointsAwarded ?? 0), 0);
    return {
      id: q.id,
      order: q.order,
      type: q.type,
      promptHtml: q.promptHtml,
      points: q.points,
      options: options.map((o) => ({ ...o, correct: correct.has(o.id), picked: list.filter((a) => a.selectedOptionIds.includes(o.id)).length })),
      answered,
      scored: scoredList.length,
      correctRate: scoredList.length ? full / scoredList.length : null,
      avgPointsRate: scoredList.length && q.points ? pointsSum / (scoredList.length * q.points) : null,
      pendingReview: list.filter((a) => a.pointsAwarded === null && !isChoice(q.type)).length,
    };
  });
}

// ─── Grading ─────────────────────────────────────────────────────────────────

export type ReviewQueueItem = { attemptId: string; person: PersonRef; submittedAt: Date | null; autoSubmitted: boolean; pending: number; cycleKey: string };

/** Attempts waiting on a reviewer, oldest first (first in, first graded). */
export async function reviewQueue(testId: string): Promise<ReviewQueueItem[]> {
  const rows = await db.testAttempt.findMany({
    where: { testId, status: "NEEDS_REVIEW" },
    orderBy: { submittedAt: "asc" },
    select: { id: true, submittedAt: true, autoSubmitted: true, cycleKey: true, user: { select: personSelect }, answers: { where: { pointsAwarded: null }, select: { id: true } } },
  });
  return rows.map((r) => ({ attemptId: r.id, person: r.user, submittedAt: r.submittedAt, autoSubmitted: r.autoSubmitted, pending: r.answers.length, cycleKey: r.cycleKey }));
}

export type ReviewAnswer = {
  questionId: string;
  answerId: string | null;
  order: number;
  type: QuestionType;
  promptHtml: string;
  points: number;
  modelAnswer: string | null;
  options: (QuestionOption & { correct: boolean; picked: boolean })[];
  text: string | null;
  pointsAwarded: number | null;
  reviewerComment: string | null;
  ai: { points: number; feedback: string; model: string } | null;
};

export async function reviewAttempt(attemptId: string) {
  const attempt = await db.testAttempt.findUnique({
    where: { id: attemptId },
    include: {
      user: { select: personSelect },
      gradedBy: { select: { name: true } },
      test: { include: { questions: { orderBy: { order: "asc" } }, club: { select: { id: true, name: true, slug: true } } } },
      answers: true,
    },
  });
  if (!attempt) return null;
  const byQ = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const items: ReviewAnswer[] = attempt.test.questions.map((q) => {
    const a = byQ.get(q.id);
    const correct = new Set(q.correctOptionIds);
    return {
      questionId: q.id,
      answerId: a?.id ?? null,
      order: q.order,
      type: q.type,
      promptHtml: q.promptHtml,
      points: q.points,
      modelAnswer: q.modelAnswer,
      options: parseOptions(q.options).map((o) => ({ ...o, correct: correct.has(o.id), picked: Boolean(a?.selectedOptionIds.includes(o.id)) })),
      text: a?.text ?? null,
      pointsAwarded: a?.pointsAwarded ?? null,
      reviewerComment: a?.reviewerComment ?? null,
      ai: a && a.aiSuggestedPoints !== null ? { points: a.aiSuggestedPoints, feedback: a.aiFeedback ?? "", model: a.aiModel ?? "Claude" } : null,
    };
  });
  const score = scoreAttempt(
    attempt.test.questions.map((q) => ({ id: q.id, type: q.type, points: q.points, correctOptionIds: q.correctOptionIds })),
    attempt.answers.map((a) => ({ questionId: a.questionId, selectedOptionIds: a.selectedOptionIds, text: a.text, pointsAwarded: a.pointsAwarded })),
    attempt.test.passingPercent,
  );
  return { attempt, items, score };
}

export type ReviewAttemptData = NonNullable<Awaited<ReturnType<typeof reviewAttempt>>>;

// ─── The taker's own pages ───────────────────────────────────────────────────

/** An attempt as its taker sees it while answering: no correct answers, no model answers. */
export async function attemptForTaker(actor: Actor, attemptId: string) {
  const attempt = await db.testAttempt.findUnique({
    where: { id: attemptId },
    include: {
      answers: { select: { questionId: true, selectedOptionIds: true, text: true } },
      test: {
        select: {
          id: true,
          title: true,
          isForm: true,
          clubId: true,
          timeLimitMinutes: true,
          passingPercent: true,
          club: { select: { name: true, slug: true } },
          questions: { orderBy: { order: "asc" }, select: { id: true, order: true, type: true, promptHtml: true, options: true, points: true } },
        },
      },
    },
  });
  if (!attempt || attempt.userId !== actor.id) return null;
  return attempt;
}

export type TakerResultItem = {
  questionId: string;
  order: number;
  type: QuestionType;
  promptHtml: string;
  points: number;
  options: (QuestionOption & { picked: boolean })[];
  text: string | null;
  /** null = waiting for a reviewer. */
  earned: number | null;
  correct: boolean | null;
  reviewerComment: string | null;
};

/** The results page: score, each question's outcome. Correct choices aren't revealed, so retakes stay meaningful. */
export async function resultForTaker(actor: Actor, attemptId: string) {
  const attempt = await db.testAttempt.findUnique({
    where: { id: attemptId },
    include: {
      answers: true,
      test: {
        include: {
          questions: { orderBy: { order: "asc" } },
          club: { select: { name: true, slug: true } },
          requirements: { where: { active: true }, select: { id: true } },
        },
      },
    },
  });
  if (!attempt || attempt.userId !== actor.id) return null;
  const byQ = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const items: TakerResultItem[] = attempt.test.questions.map((q) => {
    const a = byQ.get(q.id);
    const earned = attempt.status === "IN_PROGRESS" ? null : (a?.pointsAwarded ?? (isChoice(q.type) || !a?.text ? 0 : null));
    return {
      questionId: q.id,
      order: q.order,
      type: q.type,
      promptHtml: q.promptHtml,
      points: q.points,
      options: parseOptions(q.options).map((o) => ({ ...o, picked: Boolean(a?.selectedOptionIds.includes(o.id)) })),
      text: a?.text ?? null,
      earned,
      correct: earned === null ? null : earned >= q.points - 1e-9,
      reviewerComment: a?.reviewerComment ?? null,
    };
  });
  const score = scoreAttempt(
    attempt.test.questions.map((q) => ({ id: q.id, type: q.type, points: q.points, correctOptionIds: q.correctOptionIds })),
    attempt.answers.map((a) => ({ questionId: a.questionId, selectedOptionIds: a.selectedOptionIds, text: a.text, pointsAwarded: a.pointsAwarded })),
    attempt.test.passingPercent,
  );
  return { attempt, items, score };
}

export type MyTestItem = {
  testId: string;
  title: string;
  isForm: boolean;
  /** WSUSA assigned it (a club's own tests and forms aren't required). */
  required: boolean;
  clubName: string | null;
  cycleKey: string;
  dueAt: Date | null;
  status: "todo" | "missed" | "in-progress" | "needs-review" | "passed" | "failed";
  latestAttemptId: string | null;
  scorePercent: number | null;
};

/** The /tests page: what I owe (current rounds) and what I've taken. */
export async function myTests(actor: Actor): Promise<{ todo: MyTestItem[]; history: MyTestItem[] }> {
  const [assignments, attempts] = await Promise.all([
    db.testAssignment.findMany({
      where: { userId: actor.id, status: { in: ["ASSIGNED", "MISSED"] }, test: { status: "PUBLISHED" } },
      orderBy: { dueAt: "asc" },
      select: { testId: true, cycleKey: true, dueAt: true, status: true, test: { select: { title: true, isForm: true, clubId: true, audience: true, recurrence: true, club: { select: { name: true, status: true } } } } },
    }),
    db.testAttempt.findMany({
      where: { userId: actor.id },
      orderBy: { startedAt: "desc" },
      take: 60,
      select: { id: true, testId: true, cycleKey: true, status: true, passed: true, scorePercent: true, submittedAt: true, test: { select: { title: true, isForm: true, clubId: true, club: { select: { name: true } } } } },
    }),
  ]);
  const todo: MyTestItem[] = [];
  for (const a of assignments) {
    if (a.test.club && a.test.club.status !== "APPROVED") continue;
    // Only rounds that are still current: an old round's MISSED row isn't something to do now.
    const cycle = await cycleForTest({ id: a.testId, audience: a.test.audience, recurrence: a.test.recurrence });
    if (a.cycleKey !== cycle.key) continue;
    const latest = attempts.find((x) => x.testId === a.testId && x.cycleKey === a.cycleKey);
    if (latest?.passed) continue;
    todo.push({
      testId: a.testId,
      title: a.test.title,
      isForm: a.test.isForm,
      required: a.test.clubId === null,
      clubName: a.test.club?.name ?? null,
      cycleKey: a.cycleKey,
      dueAt: a.dueAt,
      status: latest?.status === "IN_PROGRESS" ? "in-progress" : latest?.status === "NEEDS_REVIEW" ? "needs-review" : a.status === "MISSED" ? "missed" : "todo",
      latestAttemptId: latest?.id ?? null,
      scorePercent: latest?.scorePercent ?? null,
    });
  }
  const history: MyTestItem[] = attempts
    .filter((a) => a.status !== "IN_PROGRESS")
    .map((a) => ({
      testId: a.testId,
      title: a.test.title,
      isForm: a.test.isForm,
      required: a.test.clubId === null,
      clubName: a.test.club?.name ?? null,
      cycleKey: a.cycleKey,
      dueAt: a.submittedAt,
      status: a.status === "NEEDS_REVIEW" ? "needs-review" : a.passed ? "passed" : "failed",
      latestAttemptId: a.id,
      scorePercent: a.scorePercent,
    }));
  return { todo, history };
}
