import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, CalendarClock, CheckCircle2, ClipboardList, Hourglass, Pencil, PlayCircle, Repeat, Target, Timer } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { canManageTest, manageHref, takerState } from "@/lib/domain/tests";
import { fmtDate, fmtLongDate, fmtTime } from "@/lib/time";
import { minutesLabel } from "@/lib/tests/deadlines";
import { attemptLabel, fmtPercent } from "@/lib/tests/types";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, Container, PageHeader } from "@/components/ui/layout";
import { RichContent } from "@/components/rich/RichContent";
import { StartTestButton } from "@/components/tests/StartTestButton";
import { ResultBadge } from "@/components/tests/badges";
import { PolicyNotices } from "@/components/policies/PolicyNotices";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: "Test" };
  const t = await db.test.findUnique({ where: { id }, select: { title: true, status: true } });
  return { title: t && t.status !== "DRAFT" ? t.title : "Test" };
}

function when(d: Date) {
  return `${fmtDate(d, "EEE, MMM d")} at ${fmtTime(d)}`;
}

/**
 * A test's intro page: what it covers (the builder's intro: text, documents,
 * video), the facts (time, questions, passing score, attempts, due date), and
 * "Take the test". People in the audience — or anyone, for open tests — can
 * take it; builders see a shortcut to edit and results.
 */
export default async function TestIntroPage({ params }: { params: Params }) {
  const { id } = await params;
  const user = await requireUser(`/tests/${id}`);
  const now = new Date();
  const exists = await db.test.findUnique({ where: { id }, select: { id: true, clubId: true, status: true } });
  if (!exists) notFound();
  const manager = await canManageTest(user, exists);
  // Drafts are private to their builders (who preview them from the builder).
  if (exists.status === "DRAFT" && !manager) notFound();

  const s = await takerState(user, id, now);
  const t = s.test;
  const [questions, attempts] = await Promise.all([
    db.testQuestion.findMany({ where: { testId: id }, select: { points: true } }),
    db.testAttempt.findMany({
      where: { testId: id, userId: user.id, cycleKey: s.cycle.key },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, passed: true, scorePercent: true, submittedAt: true, startedAt: true, autoSubmitted: true },
    }),
  ]);
  const points = questions.reduce((n, q) => n + q.points, 0);
  const due = s.assignment?.dueAt ?? (t.recurrence === "ONE_OFF" ? t.closesAt : null);
  const overdue = due ? due < now && !s.passed : false;
  // Mention the closing time in the confirmation only when it cuts the time short (or there's no limit).
  const closesSoon =
    t.recurrence === "ONE_OFF" && t.closesAt && (!t.timeLimitMinutes || t.closesAt.getTime() < now.getTime() + t.timeLimitMinutes * 60_000) ? when(t.closesAt) : null;
  const owner = t.club ? t.club.name : "WSUSA";

  const facts = [
    { icon: <Timer className="h-4 w-4" />, label: "Time", value: t.timeLimitMinutes ? minutesLabel(t.timeLimitMinutes) : "No time limit — the clock still runs" },
    { icon: <ClipboardList className="h-4 w-4" />, label: "Questions", value: `${questions.length} ${questions.length === 1 ? "question" : "questions"} · ${points} ${points === 1 ? "point" : "points"}` },
    { icon: <Target className="h-4 w-4" />, label: "Passing score", value: `${t.passingPercent}%` },
    {
      icon: <Repeat className="h-4 w-4" />,
      label: s.cycle.key === "once" ? "Attempts" : `Attempts (${s.cycle.label})`,
      value: s.attemptsLeft === null ? (s.attemptsUsed ? `Unlimited · ${s.attemptsUsed} used` : "Unlimited") : `${s.attemptsLeft} of ${t.maxAttempts} left`,
    },
    ...(due ? [{ icon: <CalendarClock className="h-4 w-4" />, label: overdue ? "Was due" : "Due", value: when(due) }] : []),
  ];

  return (
    <Container size="md">
      <PageHeader
        breadcrumbs={[{ href: "/tests", label: "Your tests" }, { label: t.title }]}
        title={t.title}
        description={`From ${owner}${s.cycle.key === "once" ? "" : ` · ${s.cycle.label} round`}`}
        actions={
          manager ? (
            <>
              <ButtonLink href={manageHref(t)} variant="outline" size="sm">
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </ButtonLink>
              <ButtonLink href={manageHref(t, "results")} variant="ghost" size="sm">
                <BarChart3 className="h-4 w-4" aria-hidden /> Results
              </ButtonLink>
            </>
          ) : null
        }
      />

      {t.status === "DRAFT" ? (
        <Callout tone="warning" className="mb-6" title="This test is a draft">
          Only people who manage it can see this page. Publish it from the builder to let people take it.
        </Callout>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody>
              {t.introHtml.trim() ? (
                <RichContent html={t.introHtml} />
              ) : (
                <p className="text-ink-2">Answer each question, then press Submit test at the bottom. Multiple choice is scored right away; written answers are reviewed by a person.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              {s.inProgress ? (
                <>
                  <p className="font-medium text-ink">You have an attempt in progress.</p>
                  <p className="text-sm text-ink-2">
                    {s.inProgress.deadlineAt
                      ? s.inProgress.deadlineAt > now
                        ? `Your clock is still running — it runs out at ${fmtTime(s.inProgress.deadlineAt)}.`
                        : "Your time has run out. Open it to hand in what you saved."
                      : `You started ${fmtDate(s.inProgress.startedAt, "MMM d")} at ${fmtTime(s.inProgress.startedAt)}. The clock is still running.`}
                  </p>
                  <ButtonLink href={`/tests/${t.id}/attempt/${s.inProgress.id}`} size="lg">
                    <PlayCircle className="h-5 w-5" aria-hidden /> Go back to your test
                  </ButtonLink>
                </>
              ) : s.canTake ? (
                <>
                  <p className="text-sm text-ink-2">
                    {t.timeLimitMinutes ? `When you start, you'll have ${minutesLabel(t.timeLimitMinutes)}.` : "There's no time limit, but the clock runs from the moment you start."} Your answers save as you go.
                  </p>
                  {overdue ? <p className="text-sm text-warning">This was due {fmtLongDate(due!)}. It's still open, so take it as soon as you can.</p> : null}
                  <StartTestButton testId={t.id} timeLimitMinutes={t.timeLimitMinutes} closesSoonAt={closesSoon} label={attempts.length ? "Take it again" : "Take the test"} />
                </>
              ) : s.block?.reason === "passed" ? (
                <Callout tone="success" icon={<CheckCircle2 />} title="You passed">
                  {s.block.message}
                </Callout>
              ) : s.block?.reason === "review" ? (
                <Callout tone="info" icon={<Hourglass />} title="Waiting for a reviewer">
                  {s.block.message}
                </Callout>
              ) : (
                <Callout tone="warning" title="You can't take this test right now">
                  {s.block?.message}
                </Callout>
              )}
            </CardBody>
          </Card>

          {t.audience === "ROLE_REQUIREMENT" ? <PolicyNotices placement="OFFICER_ROLES" title="Policies for officers and leaders" /> : null}

          {attempts.some((a) => a.status !== "IN_PROGRESS") ? (
            <Card>
              <CardHeader title={s.cycle.key === "once" ? "Your attempts" : `Your attempts this round`} />
              <ul className="divide-y divide-line">
                {attempts
                  .filter((a) => a.status !== "IN_PROGRESS")
                  .map((a, i, list) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <span className="text-sm font-medium text-ink">Attempt {list.length - i}</span>
                      <ResultBadge status={a.status === "NEEDS_REVIEW" ? "needs-review" : a.passed ? "passed" : "failed"} />
                      <span className="text-sm text-ink-3">
                        {a.submittedAt ? `Handed in ${fmtDate(a.submittedAt, "MMM d")} at ${fmtTime(a.submittedAt)}` : ""}
                        {a.autoSubmitted ? " (time ran out)" : ""}
                      </span>
                      <span className="ml-auto text-sm font-medium tabular-nums text-ink">{a.scorePercent !== null ? fmtPercent(a.scorePercent) : attemptLabel(a)}</span>
                      <Link href={`/tests/${t.id}/results/${a.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                        See results<span className="sr-only"> for attempt {list.length - i}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <aside aria-label="About this test" className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody>
              <dl className="space-y-3">
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
        </aside>
      </div>
    </Container>
  );
}
