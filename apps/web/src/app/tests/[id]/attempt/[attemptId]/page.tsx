import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { attemptForTaker } from "@/lib/tests/queries";
import { parseOptions } from "@/lib/tests/types";
import { Container, PageHeader } from "@/components/ui/layout";
import { RichContent } from "@/components/rich/RichContent";
import { AttemptRunner, type RunnerQuestion } from "@/components/tests/AttemptRunner";

export const metadata: Metadata = { title: "Taking a test" };

/**
 * An attempt in progress. Only its taker can open it. Handed-in attempts go
 * to their results; an attempt whose time ran out while the page was closed
 * opens with the clock at zero and hands itself in (the scheduled job does the
 * same if nobody comes back).
 */
export default async function AttemptPage({ params }: { params: Promise<{ id: string; attemptId: string }> }) {
  const { id, attemptId } = await params;
  const user = await requireUser(`/tests/${id}/attempt/${attemptId}`);
  const attempt = await attemptForTaker(user, attemptId);
  if (!attempt || attempt.testId !== id) notFound();
  if (attempt.status !== "IN_PROGRESS") redirect(`/tests/${id}/results/${attemptId}`);

  const questions: RunnerQuestion[] = attempt.test.questions.map((q) => ({
    id: q.id,
    type: q.type,
    points: q.points,
    options: parseOptions(q.options),
    prompt: <RichContent html={q.promptHtml} />,
  }));
  const initialAnswers = Object.fromEntries(attempt.answers.map((a) => [a.questionId, { selectedOptionIds: a.selectedOptionIds, text: a.text }]));

  return (
    <Container size="md">
      <PageHeader title={attempt.test.title} description={`From ${attempt.test.club?.name ?? "WSUSA"} · passing score ${attempt.test.passingPercent}%`} className="mb-4" />
      <AttemptRunner
        mode="live"
        attemptId={attempt.id}
        title={attempt.test.title}
        startedAt={attempt.startedAt.toISOString()}
        deadlineAt={attempt.deadlineAt?.toISOString() ?? null}
        serverNow={new Date().toISOString()}
        questions={questions}
        initialAnswers={initialAnswers}
        resultsHref={`/tests/${id}/results/${attempt.id}`}
        exitHref={`/tests/${id}`}
      />
    </Container>
  );
}
