import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { myTests, type MyTestItem } from "@/lib/tests/queries";
import { cycleKeyLabel } from "@/lib/tests/cycles";
import { fmtPercent } from "@/lib/tests/types";
import { fmtDate, fmtLongDate } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container, EmptyState, PageHeader, Section } from "@/components/ui/layout";
import { FormBadge, ResultBadge } from "@/components/tests/badges";
import { REQUIRED_LABEL } from "@/components/tasks/labels";

export const metadata: Metadata = { title: "Your tests" };

/** Every test and form you've been asked to take or fill out (this round) and everything you've handed in. */
export default async function MyTestsPage() {
  const user = await requireUser("/tests");
  const { todo, history } = await myTests(user);
  const now = new Date();
  // WSUSA's come first, like required tasks everywhere.
  const sorted = [...todo].sort((a, b) => Number(b.required) - Number(a.required));

  return (
    <Container size="md">
      <PageHeader
        title="Your tests"
        description="Tests to take and forms to fill out from your clubs and WSUSA, and what you've handed in. WSUSA's come first."
      />

      <Section title="To do" className="mb-8">
        {sorted.length === 0 ? (
          <EmptyState icon={<ClipboardCheck />} title="Nothing to do right now" description="When a club or WSUSA assigns you a test or a form, it shows up here and in your tasks." />
        ) : (
          <ul className="space-y-3">
            {sorted.map((t) => (
              <li key={`${t.testId}:${t.cycleKey}`}>
                <TodoCard t={t} now={now} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Results">
        {history.length === 0 ? (
          <p className="text-sm text-ink-3">You haven&apos;t handed in any tests or forms yet.</p>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {history.map((h) => (
                <li key={h.latestAttemptId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/tests/${h.testId}/results/${h.latestAttemptId}`} className="font-medium text-ink hover:text-brand-600 hover:underline">
                      {h.title}
                    </Link>
                    <p className="text-xs text-ink-3">
                      {h.clubName ?? "WSUSA"}
                      {h.cycleKey !== "once" ? ` · ${cycleKeyLabel(h.cycleKey)}` : ""}
                      {h.dueAt ? ` · ${fmtLongDate(h.dueAt)}` : ""}
                    </p>
                  </div>
                  {h.isForm ? <FormBadge /> : null}
                  <ResultBadge status={h.status === "needs-review" ? "needs-review" : h.status === "passed" ? "passed" : "failed"} form={h.isForm} />
                  {/* Forms have no score. */}
                  <span className="w-14 text-right text-sm font-medium tabular-nums text-ink">{h.isForm ? "" : h.scorePercent !== null ? fmtPercent(h.scorePercent) : "—"}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>
    </Container>
  );
}

function TodoCard({ t, now }: { t: MyTestItem; now: Date }) {
  const late = t.dueAt ? t.dueAt < now : false;
  const action =
    t.status === "in-progress" && t.latestAttemptId
      ? { href: `/tests/${t.testId}/attempt/${t.latestAttemptId}`, label: "Continue" }
      : t.status === "needs-review" && t.latestAttemptId
        ? { href: `/tests/${t.testId}/results/${t.latestAttemptId}`, label: "See results" }
        : { href: `/tests/${t.testId}`, label: t.isForm ? "Fill out" : t.latestAttemptId ? "Try again" : "Open" };
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
          {t.title}
          {t.isForm ? <FormBadge /> : null}
          {t.required ? (
            <Badge tone="danger" className="font-semibold">
              {REQUIRED_LABEL}
            </Badge>
          ) : null}
        </p>
        <p className={late ? "text-sm text-warning" : "text-sm text-ink-3"}>
          {t.clubName ?? "WSUSA"}
          {t.dueAt ? ` · ${late ? "was due" : "due"} ${fmtDate(t.dueAt, "EEE, MMM d")}` : ""}
          {t.cycleKey !== "once" ? ` · ${cycleKeyLabel(t.cycleKey)}` : ""}
        </p>
      </div>
      <ResultBadge status={t.status === "missed" ? "missed" : t.status === "in-progress" ? "in-progress" : t.status === "needs-review" ? "needs-review" : t.status === "failed" ? "failed" : "todo"} />
      <ButtonLink href={action.href} size="sm" variant={t.status === "needs-review" ? "outline" : "primary"}>
        {action.label}
      </ButtonLink>
    </Card>
  );
}
