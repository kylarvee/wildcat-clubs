import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Check, ClipboardList, Download, Eye, Hourglass, Repeat, Target, Timer, Users } from "lucide-react";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { aiLive } from "@/lib/config";
import { cycleForTest, editorPayload, testPeopleByIds } from "@/lib/domain/tests";
import { questionStats, reviewAttempt, reviewQueue, testResults, type QuestionStat, type ResultRow } from "@/lib/tests/queries";
import { durationLabel, minutesLabel } from "@/lib/tests/deadlines";
import { hasText } from "@/lib/tests/scoring";
import { audienceLabel, fmtPercent, fmtPoints, isChoice, parseOptions, RECURRENCE_LABEL, RENEWAL_LABEL } from "@/lib/tests/types";
import { fmtDate, fmtLongDate, fmtTime } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState, PageHeader, Section, Stat } from "@/components/ui/layout";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { RichContent, RichContentText } from "@/components/rich/RichContent";
import { AttemptRunner, type RunnerQuestion } from "@/components/tests/AttemptRunner";
import { GradingForm, type GradingItem } from "@/components/tests/GradingForm";
import { ResultBadge, TestStatusBadge } from "@/components/tests/badges";
import { TestBuilder } from "@/components/tests/TestBuilder";
import type { TestScope } from "@/components/tests/scope";

/**
 * The Test Tool's builder-side pages, shared by WSUSA (/admin/tests/…) and
 * clubs (/clubs/[slug]/manage/tests/…). Route files check permission and pass
 * the scope; these views make sure the test belongs to that scope.
 */

async function loadManagedTest(scope: TestScope, testId: string) {
  const test = await db.test.findUnique({
    where: { id: testId },
    include: {
      requirements: { where: { active: true }, select: { id: true, name: true, renewal: true } },
      _count: { select: { attempts: true, questions: true } },
    },
  });
  if (!test || test.clubId !== scope.clubId) notFound();
  return test;
}

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

function listLabel(scope: TestScope) {
  return scope.kind === "club" ? "Club tests" : "Tests";
}

function TestNav({ scope, testId }: { scope: TestScope; testId: string }) {
  const base = `${scope.basePath}/${testId}`;
  return (
    <LinkTabs
      className="mb-6"
      tabs={[
        { href: base, label: "Build", exact: true },
        { href: `${base}/preview`, label: "Preview" },
        { href: `${base}/results`, label: "Results & grading" },
      ]}
    />
  );
}

// ─── Build ───────────────────────────────────────────────────────────────────

export async function TestEditorView({ scope, testId }: { scope: TestScope; testId: string }) {
  const test = await loadManagedTest(scope, testId);
  const [payload, aiOn] = await Promise.all([editorPayload(testId), aiLive("grading")]);
  const people = await testPeopleByIds(payload.selectedUserIds);
  const req = test.requirements[0];
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ href: scope.basePath, label: listLabel(scope) }, { label: test.title }]}
        title={test.title}
        actions={<TestStatusBadge status={test.status} />}
        className="mb-4"
      />
      <TestNav scope={scope} testId={testId} />
      <TestBuilder
        key={test.id}
        scope={scope}
        testId={test.id}
        status={test.status}
        initial={payload}
        initialPeople={people}
        requirementNames={test.requirements.map((r) => r.name)}
        renewalLabel={req ? RENEWAL_LABEL[req.renewal] : null}
        attemptCount={test._count.attempts}
        aiOn={aiOn}
      />
    </div>
  );
}

// ─── Preview as taker ────────────────────────────────────────────────────────

export async function TestPreviewView({ scope, testId }: { scope: TestScope; testId: string }) {
  const test = await loadManagedTest(scope, testId);
  const questions = await db.testQuestion.findMany({ where: { testId }, orderBy: { order: "asc" } });
  const now = new Date();
  const points = questions.reduce((n, q) => n + q.points, 0);
  const runner: RunnerQuestion[] = questions.map((q) => ({ id: q.id, type: q.type, points: q.points, options: parseOptions(q.options), prompt: <RichContent html={q.promptHtml} /> }));
  const key = Object.fromEntries(questions.filter((q) => isChoice(q.type)).map((q) => [q.id, q.correctOptionIds]));
  const facts = [
    { icon: <Timer className="h-4 w-4" />, label: "Time", value: test.timeLimitMinutes ? minutesLabel(test.timeLimitMinutes) : "No time limit — the clock still runs" },
    { icon: <ClipboardList className="h-4 w-4" />, label: "Questions", value: `${questions.length} · ${points} ${points === 1 ? "point" : "points"}` },
    { icon: <Target className="h-4 w-4" />, label: "Passing score", value: `${test.passingPercent}%` },
    { icon: <Repeat className="h-4 w-4" />, label: "Attempts", value: test.maxAttempts === null ? "Unlimited" : `${test.maxAttempts}` },
    ...(test.recurrence === "ONE_OFF" && test.closesAt ? [{ icon: <CalendarClock className="h-4 w-4" />, label: "Closes", value: `${fmtLongDate(test.closesAt)} at ${fmtTime(test.closesAt)}` }] : []),
  ];
  return (
    <div>
      <PageHeader breadcrumbs={[{ href: scope.basePath, label: listLabel(scope) }, { href: `${scope.basePath}/${testId}`, label: test.title }, { label: "Preview" }]} title={test.title} className="mb-4" />
      <TestNav scope={scope} testId={testId} />
      <Callout tone="brand" icon={<Eye />} title="Preview as a taker" className="mb-6">
        This is exactly what people see, with the saved version of the test. The clock runs, but nothing you answer is saved.
      </Callout>
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader title="Intro page" />
          <CardBody>
            {test.introHtml.trim() ? <RichContent html={test.introHtml} /> : <p className="text-sm text-ink-3">No intro yet. People will see a short default note about how the test works.</p>}
          </CardBody>
          <CardBody className="border-t border-line">
            <dl className="grid gap-3 sm:grid-cols-2">
              {facts.map((f) => (
                <div key={f.label} className="flex gap-3">
                  <span className="mt-0.5 text-ink-3" aria-hidden>
                    {f.icon}
                  </span>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">{f.label}</dt>
                    <dd className="text-sm text-ink">{f.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        {questions.length ? (
          <AttemptRunner
            mode="preview"
            attemptId={null}
            title={test.title}
            startedAt={now.toISOString()}
            deadlineAt={test.timeLimitMinutes ? new Date(now.getTime() + test.timeLimitMinutes * 60_000).toISOString() : null}
            serverNow={now.toISOString()}
            questions={runner}
            initialAnswers={{}}
            resultsHref={`${scope.basePath}/${testId}`}
            exitHref={`${scope.basePath}/${testId}`}
            previewKey={key}
          />
        ) : (
          <EmptyState icon={<ClipboardList />} title="No questions yet" description="Add questions in the builder, then preview again." action={<ButtonLink href={`${scope.basePath}/${testId}`}>Back to the builder</ButtonLink>} />
        )}
      </div>
    </div>
  );
}

// ─── Results & grading ───────────────────────────────────────────────────────

export async function TestResultsView({ scope, testId, cycleParam }: { scope: TestScope; testId: string; cycleParam: string | undefined }) {
  const test = await loadManagedTest(scope, testId);
  const current = await cycleForTest(test);
  const cycleKey = cycleParam === "all" ? null : (cycleParam ?? current.key);
  const [results, stats, queue] = await Promise.all([testResults(testId, cycleKey), questionStats(testId, cycleKey), reviewQueue(testId)]);
  const base = `${scope.basePath}/${testId}`;
  const s = results.stats;
  const cycleOptions = results.cycles.some((c) => c.key === current.key) ? results.cycles : [{ key: current.key, label: current.label, attempts: 0 }, ...results.cycles];
  const showCycles = !(cycleOptions.length === 1 && cycleOptions[0].key === "once");
  const exportHref = `/api/tests/${testId}/export?cycle=${encodeURIComponent(cycleKey ?? "all")}`;

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          breadcrumbs={[{ href: scope.basePath, label: listLabel(scope) }, { href: base, label: test.title }, { label: "Results" }]}
          title={test.title}
          description={`${audienceLabel(test.audience, scope.kind)}${test.audience === "ROLE_REQUIREMENT" ? "" : ` · ${RECURRENCE_LABEL[test.recurrence]}`} · pass at ${test.passingPercent}%`}
          actions={<TestStatusBadge status={test.status} />}
          className="mb-4"
        />
        <TestNav scope={scope} testId={testId} />
      </div>

      {showCycles ? (
        <nav aria-label="Round" className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-3">Round:</span>
          {cycleOptions.map((c) => (
            <Link
              key={c.key}
              href={`${base}/results?cycle=${encodeURIComponent(c.key)}`}
              aria-current={cycleKey === c.key ? "page" : undefined}
              className={buttonClasses(cycleKey === c.key ? "secondary" : "ghost", "sm")}
            >
              {c.label}
              {c.key === current.key ? " (current)" : ""}
            </Link>
          ))}
          <Link href={`${base}/results?cycle=all`} aria-current={cycleKey === null ? "page" : undefined} className={buttonClasses(cycleKey === null ? "secondary" : "ghost", "sm")}>
            All rounds
          </Link>
        </nav>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Attempts" value={s.attempts.toLocaleString()} hint={`${s.takers.toLocaleString()} ${s.takers === 1 ? "person" : "people"}`} />
        <Stat label="Pass rate" value={pct(s.passRate)} hint={s.graded ? `${s.passed} of ${s.graded} graded` : "Nothing graded yet"} />
        <Stat label="Average score" value={fmtPercent(s.avgScore)} hint="graded attempts" />
        <Stat label="Average time" value={s.avgTimeMs === null ? "—" : durationLabel(s.avgTimeMs)} hint="start to hand-in" />
        <Stat label="In progress" value={s.inProgress} hint="clock running now" className="col-span-2 md:col-span-1" />
      </div>

      <section id="review" aria-labelledby="review-heading" className="scroll-mt-24 space-y-3">
        <div>
          <h2 id="review-heading" className="text-lg font-semibold text-ink">
            Waiting for review
          </h2>
          <p className="text-sm text-ink-3">Written answers a person needs to score. Oldest first, across every round.</p>
        </div>
        {queue.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">
            <Check className="h-4 w-4 text-success" aria-hidden /> All caught up — nothing to grade.
          </p>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {queue.map((q) => (
                <li key={q.attemptId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar name={q.person.name} src={q.person.avatarUrl} color={q.person.avatarColor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{q.person.name}</p>
                    <p className="text-xs text-ink-3">
                      {q.submittedAt ? `Handed in ${fmtDate(q.submittedAt, "MMM d")} at ${fmtTime(q.submittedAt)}` : "Handed in"}
                      {q.autoSubmitted ? " (time ran out)" : ""} · {q.pending} written {q.pending === 1 ? "answer" : "answers"}
                    </p>
                  </div>
                  <ButtonLink href={`${base}/review/${q.attemptId}`} size="sm">
                    <Hourglass className="h-4 w-4" aria-hidden /> Grade
                  </ButtonLink>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <Section
        title="People"
        description={cycleKey === null ? "Everyone who took it or was asked to, in any round." : "Everyone who took it or was asked to in this round. A pass anywhere in the round counts."}
        action={
          results.rows.length ? (
            <a href={exportHref} className={buttonClasses("outline", "sm")} download>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          ) : null
        }
      >
        {results.rows.length === 0 ? (
          <EmptyState icon={<Users />} title="No one yet" description={test.status === "PUBLISHED" ? "Results show up here as people take the test." : "Publish the test to start collecting results."} />
        ) : (
          <PeopleTable rows={results.rows} base={base} />
        )}
      </Section>

      <Section title="Question by question" description="How people answered each question in this view. Multiple choice shows how many picked each answer.">
        {stats.length === 0 ? <p className="text-sm text-ink-3">This test has no questions.</p> : <QuestionStatsList stats={stats} />}
      </Section>
    </div>
  );
}

function PeopleTable({ rows, base }: { rows: ResultRow[]; base: string }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Person</TH>
          <TH>Status</TH>
          <TH className="text-right">Score</TH>
          <TH className="hidden text-right sm:table-cell">Attempts</TH>
          <TH className="hidden md:table-cell">Time taken</TH>
          <TH className="hidden md:table-cell">Handed in</TH>
          <TH>
            <span className="sr-only">Answers</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.person.id}>
            <TD>
              <div className="flex items-center gap-2">
                <Avatar name={r.person.name} src={r.person.avatarUrl} color={r.person.avatarColor} size="xs" />
                <div className="min-w-0">
                  <p className="max-w-[12rem] truncate font-medium">{r.person.name}</p>
                  {r.dueAt && !r.attempt ? <p className="text-xs text-ink-3">Due {fmtDate(r.dueAt, "MMM d")}</p> : null}
                </div>
              </div>
            </TD>
            <TD>
              <ResultBadge status={r.status} />
            </TD>
            <TD className="text-right tabular-nums">{r.attempt?.scorePercent !== null && r.attempt?.scorePercent !== undefined ? fmtPercent(r.attempt.scorePercent) : "—"}</TD>
            <TD className="hidden text-right tabular-nums sm:table-cell">{r.attempts || "—"}</TD>
            <TD className="hidden whitespace-nowrap md:table-cell">
              {r.attempt?.timeMs !== null && r.attempt?.timeMs !== undefined ? durationLabel(r.attempt.timeMs) : "—"}
              {r.attempt?.autoSubmitted ? <span className="text-xs text-ink-3"> · timed out</span> : null}
            </TD>
            <TD className="hidden whitespace-nowrap md:table-cell">{r.attempt?.submittedAt ? `${fmtDate(r.attempt.submittedAt, "MMM d")}, ${fmtTime(r.attempt.submittedAt)}` : "—"}</TD>
            <TD className="text-right">
              {r.attempt && r.attempt.status !== "IN_PROGRESS" ? (
                <Link href={`${base}/review/${r.attempt.id}`} className="whitespace-nowrap text-sm font-medium text-brand-600 hover:underline">
                  {r.attempt.status === "NEEDS_REVIEW" ? "Grade" : "Answers"}
                  <span className="sr-only"> for {r.person.name}</span>
                </Link>
              ) : null}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/**
 * Per-question results. Option bars use emphasis, not categories: the correct
 * answers in the brand color, the rest in a quiet gray, and each bar carries
 * its count and share as text plus a "Correct" mark, so color is never the
 * only cue.
 */
function QuestionStatsList({ stats }: { stats: QuestionStat[] }) {
  return (
    <ol className="space-y-3">
      {stats.map((q, i) => {
        const headline = isChoice(q.type) ? q.correctRate : q.avgPointsRate;
        return (
          <li key={q.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
                    Question {i + 1} · {q.points} {q.points === 1 ? "pt" : "pts"}
                  </p>
                  <p className="mt-0.5 text-sm text-ink">
                    <RichContentText html={q.promptHtml} max={220} />
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-semibold text-ink">{headline === null ? "—" : `${Math.round(headline * 100)}%`}</p>
                  <p className="text-xs text-ink-3">{isChoice(q.type) ? "got it right" : "average points"}</p>
                </div>
              </div>
              {isChoice(q.type) ? (
                <ul className="mt-3 space-y-2" aria-label={`Answers to question ${i + 1}`}>
                  {q.options.map((o) => {
                    const share = q.answered ? o.picked / q.answered : 0;
                    return (
                      <li key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
                        <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink-2">
                          {o.correct ? <Check className="h-4 w-4 shrink-0 text-success" aria-label="Correct answer" /> : <span className="inline-block h-4 w-4 shrink-0" aria-hidden />}
                          <span className="truncate" title={o.text}>
                            {o.text}
                          </span>
                        </span>
                        <span className="col-span-2 row-start-2 h-2.5 sm:col-span-1 sm:row-start-auto" aria-hidden>
                          <span
                            className="block h-full rounded-r-[4px]"
                            style={{ width: `${Math.max(share * 100, o.picked ? 1 : 0)}%`, background: o.correct ? "var(--color-brand-600)" : "#a8a1b0" }}
                          />
                        </span>
                        <span className="text-right text-sm tabular-nums text-ink-2">
                          {o.picked} <span className="text-ink-3">({Math.round(share * 100)}%)</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink-3">
                  {q.answered} written {q.answered === 1 ? "answer" : "answers"} · {q.scored} scored
                  {q.pendingReview ? ` · ${q.pendingReview} waiting for review` : ""}
                  {q.correctRate !== null ? ` · ${Math.round(q.correctRate * 100)}% earned full points` : ""}
                </p>
              )}
              {isChoice(q.type) ? <p className="mt-2 text-xs text-ink-3">{q.answered} answered</p> : null}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Review one attempt ──────────────────────────────────────────────────────

export async function TestReviewView({ scope, testId, attemptId, actor }: { scope: TestScope; testId: string; attemptId: string; actor: Actor }) {
  const test = await loadManagedTest(scope, testId);
  const data = await reviewAttempt(attemptId);
  if (!data || data.attempt.testId !== test.id) notFound();
  const { attempt, items } = data;
  if (attempt.status === "IN_PROGRESS") {
    return (
      <div>
        <PageHeader breadcrumbs={[{ href: scope.basePath, label: listLabel(scope) }, { href: `${scope.basePath}/${testId}/results`, label: test.title }, { label: attempt.user.name }]} title={attempt.user.name} />
        <Callout tone="info" title="Still in progress">
          {attempt.user.name} hasn&apos;t handed this attempt in yet. You can grade it once they do (or when their time runs out).
        </Callout>
      </div>
    );
  }
  const aiOn = await aiLive("grading");
  const next = await db.testAttempt.findFirst({ where: { testId, status: "NEEDS_REVIEW", id: { not: attemptId } }, orderBy: { submittedAt: "asc" }, select: { id: true } });
  const resultsHref = `${scope.basePath}/${testId}/results`;
  const gradingItems: GradingItem[] = items.map((it, i) => {
    const blank = !isChoice(it.type) && !hasText(it.text);
    return {
      questionId: it.questionId,
      answerId: it.answerId,
      n: i + 1,
      type: it.type,
      points: it.points,
      prompt: <RichContent html={it.promptHtml} />,
      answer: !isChoice(it.type) && !blank ? <RichContent html={it.text} /> : null,
      blank,
      modelAnswer: it.modelAnswer,
      options: it.options,
      settled: it.pointsAwarded ?? (isChoice(it.type) || blank ? 0 : null),
      ai: it.ai,
      comment: it.reviewerComment,
    };
  });
  const graded = attempt.status === "GRADED";
  const timeMs = attempt.submittedAt ? attempt.submittedAt.getTime() - attempt.startedAt.getTime() : null;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ href: scope.basePath, label: listLabel(scope) }, { href: resultsHref, label: test.title }, { label: attempt.user.name }]}
        title={attempt.user.name}
        description={[
          attempt.submittedAt ? `Handed in ${fmtDate(attempt.submittedAt, "EEE, MMM d")} at ${fmtTime(attempt.submittedAt)}` : null,
          timeMs !== null ? `took ${durationLabel(timeMs)}` : null,
          attempt.autoSubmitted ? "handed in automatically when time ran out" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={<ResultBadge status={graded ? (attempt.passed ? "passed" : "failed") : "needs-review"} />}
      />
      {graded ? (
        <Callout tone={attempt.passed ? "success" : "warning"} title={`${fmtPercent(attempt.scorePercent)} — ${attempt.passed ? "passed" : "not passed"}`}>
          {attempt.gradedBy ? `Graded by ${attempt.gradedBy.name}${attempt.gradedAt ? ` on ${fmtLongDate(attempt.gradedAt)}` : ""}.` : "Scored automatically (multiple choice only)."} Passing needs {test.passingPercent}%. Grades are final.
        </Callout>
      ) : (
        <p className="text-sm text-ink-2">
          Score each written answer against the model answer, add a note if it helps, then finish grading. Multiple choice is already scored ({fmtPoints(data.score.choiceEarned)} of {data.score.choicePossible} points).
          {aiOn ? " Claude's suggestions are advice only — the points you enter are the grade." : ""}
        </p>
      )}
      <GradingForm
        attemptId={attempt.id}
        items={gradingItems}
        passingPercent={test.passingPercent}
        aiOn={aiOn}
        readOnly={graded}
        ownAttempt={attempt.userId === actor.id}
        nextHref={next ? `${scope.basePath}/${testId}/review/${next.id}` : resultsHref}
      />
      {graded ? (
        <p className="text-sm">
          <Link href={resultsHref} className="font-medium text-brand-600 hover:underline">
            Back to results
          </Link>
        </p>
      ) : null}
    </div>
  );
}
