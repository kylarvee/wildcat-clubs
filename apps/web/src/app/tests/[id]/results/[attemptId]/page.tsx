import type { Metadata } from "next";
import { testOrFormTitle } from "@/lib/tests/queries";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, CircleDashed, Hourglass, MinusCircle, XCircle } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { takerState } from "@/lib/domain/tests";
import { resultForTaker, type TakerResultItem } from "@/lib/tests/queries";
import { durationLabel } from "@/lib/tests/deadlines";
import { fmtPercent, fmtPoints, isChoice } from "@/lib/tests/types";
import { fmtDate, fmtTime } from "@/lib/time";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Callout, Container, PageHeader } from "@/components/ui/layout";
import { RichContent } from "@/components/rich/RichContent";
import { FormAnswers } from "@/components/tests/FormAnswers";
import { StartTestButton } from "@/components/tests/StartTestButton";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: await testOrFormTitle((await params).id, "Test results", "Your answers") };
}

/**
 * A taker's results. Multiple choice is scored the moment they hand in;
 * written answers show "awaiting review" until a person grades them, then the
 * final pass/fail. Which choices were correct isn't revealed, so a retake
 * still tests what people know. A form shows "Submitted" and their answers,
 * read-only.
 */
export default async function ResultsPage({ params }: { params: Promise<{ id: string; attemptId: string }> }) {
  const { id, attemptId } = await params;
  const user = await requireUser(`/tests/${id}/results/${attemptId}`);
  const r = await resultForTaker(user, attemptId);
  if (!r || r.attempt.testId !== id) notFound();
  const { attempt, items, score } = r;
  if (attempt.status === "IN_PROGRESS") redirect(`/tests/${id}/attempt/${attemptId}`);

  const test = attempt.test;
  const state = await takerState(user, id);
  const timeMs = attempt.submittedAt ? attempt.submittedAt.getTime() - attempt.startedAt.getTime() : null;
  const graded = attempt.status === "GRADED";
  const pendingCount = items.filter((i) => i.earned === null).length;
  const owner = test.club?.name ?? "WSUSA";

  if (test.isForm) {
    return (
      <Container size="md">
        <PageHeader breadcrumbs={[{ href: "/tests", label: "Your tests" }, { href: `/tests/${id}`, label: test.title }, { label: "Your answers" }]} title={test.title} description={`From ${owner}`} />
        <Card className="mb-6">
          <CardBody className="flex flex-wrap items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden />
            <div>
              <p className="text-lg font-semibold text-ink">{attempt.submittedAt ? `Submitted ${fmtDate(attempt.submittedAt, "EEE, MMM d")} at ${fmtTime(attempt.submittedAt)}` : "Submitted"}</p>
              <p className="text-sm text-ink-2">
                {attempt.autoSubmitted ? "It was handed in with the answers you'd saved when the form closed. " : "Thanks for filling it out. "}
                {test.requirements.length ? "This meets your WSUSA requirement for this round." : "Nothing more to do."}
              </p>
            </div>
          </CardBody>
        </Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Your answers</h2>
        <FormAnswers items={items.map((it) => ({ questionId: it.questionId, type: it.type, promptHtml: it.promptHtml, options: it.options, text: it.text }))} />
        <p className="mt-8 text-sm text-ink-3">
          <Link href="/tests" className="font-medium text-brand-600 hover:underline">
            Back to your tests
          </Link>
        </p>
      </Container>
    );
  }

  return (
    <Container size="md">
      <PageHeader
        breadcrumbs={[{ href: "/tests", label: "Your tests" }, { href: `/tests/${id}`, label: test.title }, { label: "Results" }]}
        title={`Results: ${test.title}`}
        description={
          attempt.submittedAt
            ? `Handed in ${fmtDate(attempt.submittedAt, "EEE, MMM d")} at ${fmtTime(attempt.submittedAt)}${timeMs !== null ? ` · took ${durationLabel(timeMs)}` : ""}${attempt.autoSubmitted ? " · handed in automatically when time ran out" : ""}`
            : undefined
        }
      />

      <Card className="mb-6">
        <CardBody className="space-y-4">
          {graded ? (
            <div className="flex flex-wrap items-center gap-4">
              <div
                className={cn("flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-2xl font-bold", attempt.passed ? "bg-success-50 text-success" : "bg-danger-50 text-danger")}
                aria-hidden
              >
                {fmtPercent(attempt.scorePercent)}
              </div>
              <div>
                <p className="flex items-center gap-2 text-lg font-semibold text-ink">
                  {attempt.passed ? <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> : <XCircle className="h-5 w-5 text-danger" aria-hidden />}
                  {attempt.passed ? "You passed" : "You didn't pass this time"}
                </p>
                <p className="text-sm text-ink-2">
                  Score {fmtPercent(attempt.scorePercent)} · {fmtPoints(score.earned)} of {score.possible} points · {test.passingPercent}% needed
                </p>
                {attempt.passed && test.requirements.length ? <p className="mt-1 text-sm text-success">This meets your WSUSA requirement for this round.</p> : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-start gap-4">
              <Hourglass className="mt-1 h-6 w-6 shrink-0 text-info" aria-hidden />
              <div>
                <p className="text-lg font-semibold text-ink">Waiting for a reviewer</p>
                <p className="text-sm text-ink-2">
                  Multiple choice so far: {fmtPoints(score.choiceEarned)} of {score.choicePossible} points. {pendingCount} written {pendingCount === 1 ? "answer is" : "answers are"} awaiting review by {owner}. You&apos;ll get a notification with your final score.
                </p>
              </div>
            </div>
          )}

          {graded && !attempt.passed ? (
            state.canTake ? (
              <div className="border-t border-line pt-4">
                <p className="mb-2 text-sm text-ink-2">{state.attemptsLeft === null ? "You can take it again whenever you're ready." : `You have ${state.attemptsLeft} ${state.attemptsLeft === 1 ? "attempt" : "attempts"} left.`}</p>
                <StartTestButton testId={id} timeLimitMinutes={test.timeLimitMinutes} closesSoonAt={null} label="Retake the test" />
              </div>
            ) : state.inProgress ? (
              <ButtonLink href={`/tests/${id}/attempt/${state.inProgress.id}`}>Go back to your new attempt</ButtonLink>
            ) : state.block && state.block.reason !== "passed" ? (
              <Callout tone="warning" title="No retake right now">
                {state.block.message} {state.block.reason === "attempts" ? `Contact ${test.club ? `${owner}'s leaders` : "WSUSA"} if you need another chance.` : null}
              </Callout>
            ) : null
          ) : null}
        </CardBody>
      </Card>

      <h2 className="mb-3 text-lg font-semibold text-ink">Question by question</h2>
      <ol className="space-y-4">
        {items.map((it, i) => (
          <li key={it.questionId}>
            <ResultItem it={it} n={i + 1} />
          </li>
        ))}
      </ol>

      <p className="mt-8 text-sm text-ink-3">
        <Link href="/tests" className="font-medium text-brand-600 hover:underline">
          Back to your tests
        </Link>
      </p>
    </Container>
  );
}

function ResultItem({ it, n }: { it: TakerResultItem; n: number }) {
  const status =
    it.earned === null
      ? { icon: <Hourglass className="h-4 w-4" aria-hidden />, text: "Awaiting review", cls: "text-info" }
      : it.correct
        ? { icon: <CheckCircle2 className="h-4 w-4" aria-hidden />, text: "Correct", cls: "text-success" }
        : it.earned > 0
          ? { icon: <CircleDashed className="h-4 w-4" aria-hidden />, text: "Partial credit", cls: "text-warning" }
          : { icon: <XCircle className="h-4 w-4" aria-hidden />, text: isChoice(it.type) ? "Incorrect" : "No points", cls: "text-danger" };
  const blank = isChoice(it.type) ? !it.options.some((o) => o.picked) : !it.text;
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-3">
          <span>Question {n}</span>
          <span className={cn("ml-auto flex items-center gap-1 normal-case tracking-normal", status.cls)}>
            {status.icon} {status.text}
          </span>
          <span className="normal-case tracking-normal tabular-nums text-ink-2">
            {it.earned === null ? "—" : fmtPoints(it.earned)} / {it.points} {it.points === 1 ? "pt" : "pts"}
          </span>
        </div>
        <RichContent html={it.promptHtml} />
        <div className="rounded-xl bg-muted/50 px-3 py-2.5">
          <p className="mb-1 text-xs font-medium text-ink-3">Your answer</p>
          {blank ? (
            <p className="flex items-center gap-1.5 text-sm text-ink-3">
              <MinusCircle className="h-4 w-4" aria-hidden /> No answer
            </p>
          ) : isChoice(it.type) ? (
            <ul className="space-y-1">
              {it.options
                .filter((o) => o.picked)
                .map((o) => (
                  <li key={o.id} className="text-sm text-ink">
                    {o.text}
                  </li>
                ))}
            </ul>
          ) : (
            <RichContent html={it.text} className="text-sm" />
          )}
        </div>
        {it.reviewerComment ? (
          <div className="rounded-xl border border-line px-3 py-2.5">
            <p className="mb-1 text-xs font-medium text-ink-3">Reviewer&apos;s note</p>
            <p className="whitespace-pre-line text-sm text-ink">{it.reviewerComment}</p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
