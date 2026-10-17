import Link from "next/link";
import { BarChart3, ClipboardCheck, Hourglass, Pencil, ShieldCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Section, Stat } from "@/components/ui/layout";
import { CreateTestButton } from "@/components/tests/CreateTestButton";
import { TestStatusBadge } from "@/components/tests/badges";
import type { TestScope } from "@/components/tests/scope";
import { combineStats, listManagedTests, type ManagedTestRow } from "@/lib/tests/queries";
import { durationLabel, minutesLabel } from "@/lib/tests/deadlines";
import { audienceLabel, fmtPercent, RECURRENCE_LABEL } from "@/lib/tests/types";
import { fmtAgo } from "@/lib/time";

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

/**
 * The Test Tool's home: every test this scope manages with its numbers, plus
 * an "All tests" row. Shared by /admin/tests and /clubs/[slug]/manage/tests.
 */
export async function TestsHome({ scope }: { scope: TestScope }) {
  const tests = await listManagedTests(scope.clubId);
  const all = combineStats(tests.map((t) => t.stats));
  const published = tests.filter((t) => t.status === "PUBLISHED").length;
  const kind = scope.kind;

  return (
    <div className="space-y-8">
      <PageHeader
        title={kind === "club" ? "Club tests" : "Tests"}
        description={
          kind === "club"
            ? `Quizzes and checks for ${scope.ownerName}'s members — safety briefings, training refreshers, anything you need people to know. Multiple choice is scored instantly; written answers come to you for review.`
            : "University tests for student leaders and students: officer policy tests, refreshers and campus-wide checks. Attach a test to roles in Officer requirements to make it a gate."
        }
        actions={tests.length ? <CreateTestButton clubId={scope.clubId} basePath={scope.basePath} /> : null}
      />

      {tests.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title="No tests yet"
          description={
            kind === "club"
              ? "Build a quiz for your members: add an intro page, a few questions and a passing score, then publish it to assign it."
              : "Build the officer policy test or a campus-wide refresher. Publish it, then attach it to roles in Officer requirements."
          }
          action={<CreateTestButton clubId={scope.clubId} basePath={scope.basePath} label="Build your first test" />}
        />
      ) : (
        <>
          <Section title="All tests" description={`Across ${tests.length} ${tests.length === 1 ? "test" : "tests"} (${published} published), every round.`}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Attempts" value={all.attempts.toLocaleString()} hint={`${all.takers.toLocaleString()} ${all.takers === 1 ? "person" : "people"}`} />
              <Stat label="Pass rate" value={pct(all.passRate)} hint={all.graded ? `${all.passed.toLocaleString()} of ${all.graded.toLocaleString()} graded` : "Nothing graded yet"} />
              <Stat label="Average score" value={fmtPercent(all.avgScore)} hint="graded attempts" />
              <Stat label="Average time" value={all.avgTimeMs === null ? "—" : durationLabel(all.avgTimeMs)} hint="start to hand-in" />
              <Stat
                label="Waiting for review"
                value={all.needsReview}
                hint={all.needsReview ? "written answers to grade" : "All caught up"}
                className="col-span-2 md:col-span-1"
              />
            </div>
          </Section>

          <Section title="Your tests">
            <ul className="space-y-3">
              {tests.map((t) => (
                <li key={t.id}>
                  <TestRow t={t} scope={scope} />
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}

function TestRow({ t, scope }: { t: ManagedTestRow; scope: TestScope }) {
  const kind = scope.kind;
  const href = `${scope.basePath}/${t.id}`;
  const facts = [
    audienceLabel(t.audience, kind),
    t.audience === "ROLE_REQUIREMENT" ? null : RECURRENCE_LABEL[t.recurrence],
    t.timeLimitMinutes ? minutesLabel(t.timeLimitMinutes) : "No time limit",
    `${t.questions} ${t.questions === 1 ? "question" : "questions"}`,
    `pass at ${t.passingPercent}%`,
  ].filter(Boolean);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={href} className="text-base font-semibold text-ink hover:text-brand-600 hover:underline">
              {t.title}
            </Link>
            <TestStatusBadge status={t.status} />
            {t.requirementNames.length ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-600">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {t.requirementNames.join(", ")}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-ink-3">{facts.join(" · ")}</p>
          <p className="mt-0.5 text-xs text-ink-3">Edited {fmtAgo(t.updatedAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {t.stats.needsReview ? (
            <ButtonLink href={`${href}/results#review`} size="sm" variant="secondary">
              <Hourglass className="h-4 w-4" aria-hidden /> Grade {t.stats.needsReview}
            </ButtonLink>
          ) : null}
          <ButtonLink href={`${href}/results`} size="sm" variant="outline">
            <BarChart3 className="h-4 w-4" aria-hidden /> Results
          </ButtonLink>
          <ButtonLink href={href} size="sm" variant="ghost">
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </ButtonLink>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3 text-sm sm:grid-cols-5">
        <Fact label="Attempts" value={t.stats.attempts.toLocaleString()} />
        <Fact label="Pass rate" value={pct(t.stats.passRate)} />
        <Fact label="Avg. score" value={fmtPercent(t.stats.avgScore)} />
        <Fact label="Avg. time" value={t.stats.avgTimeMs === null ? "—" : durationLabel(t.stats.avgTimeMs)} />
        <Fact
          label={t.cycle.key === "once" ? "Assigned" : `This round (${t.cycle.label})`}
          value={t.assignment.total ? `${t.assignment.completed} of ${t.assignment.total} done${t.assignment.missed ? ` · ${t.assignment.missed} missed` : ""}` : t.audience === "OPEN" ? "Open to anyone" : "Nobody yet"}
          className="col-span-2 sm:col-span-1"
        />
      </dl>
    </Card>
  );
}

function Fact({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}
