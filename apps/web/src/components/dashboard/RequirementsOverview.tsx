import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import type { RequirementOverviewRow } from "@/lib/domain/requirements";
import { fmtDate } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/layout";
import { audienceLabel } from "@/components/dashboard/format";

const KIND: Record<RequirementOverviewRow["kind"], { label: string; verb: string }> = {
  TEST: { label: "Test", verb: "passed" },
  FORM: { label: "Form", verb: "submitted" },
  TRAINING: { label: "Training", verb: "attended" },
};

/**
 * WSUSA staff: what WSUSA requires this period and how far along everyone
 * is (from requirementsOverview), with the leaders whose permissions are
 * paused. Details and the per-person table live in Admin → Requirements.
 */
export function RequirementsOverview({ rows, pausedLeaders, now }: { rows: RequirementOverviewRow[]; pausedLeaders: number; now: Date }) {
  return (
    <section aria-labelledby="dash-req-title">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="dash-req-title" className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-ink">
            <ShieldAlert className="h-5 w-5 text-danger" aria-hidden /> What WSUSA requires
          </h2>
          <Link href="/admin/requirements" className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand">
            Requirements <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        <p className="mt-0.5 text-sm text-ink-3">This renewal period. Each one shows as Required by WSUSA in people&apos;s tasks until it&apos;s done.</p>
        {rows.length ? (
          <ul className="mt-3 divide-y divide-muted">
            {rows.map((r) => {
              const total = r.done + r.open;
              return (
                <li key={r.id} className="py-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <Link href={`/admin/requirements/${r.id}`} className="font-semibold text-ink hover:text-brand-600 hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-xs text-ink-3">
                      {KIND[r.kind].label} · {audienceLabel(r.appliesTo)}
                    </span>
                  </div>
                  <ProgressBar value={r.done} max={total || 1} className="mt-2 bg-brand-100" />
                  <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-ink-2">
                    <span>
                      <strong className="font-bold text-ink">{r.done}</strong> of {total} {KIND[r.kind].verb}
                    </span>
                    <span className={r.overdue ? "font-semibold text-danger" : undefined}>
                      {r.open ? `${r.open} to go` : "Everyone's done"}
                      {r.overdue ? ` · ${r.overdue} overdue` : r.nextDue ? ` · next due ${fmtDate(r.nextDue, "MMM d")}` : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-2">
            Nothing is required right now.{" "}
            <Link href="/admin/requirements/new" className="font-medium text-brand-600 hover:underline">
              Add a requirement
            </Link>
            .
          </p>
        )}
        {pausedLeaders ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-danger-50 px-3.5 py-3">
            <p className="text-sm font-semibold text-danger">
              {pausedLeaders} student {pausedLeaders === 1 ? "leader has" : "leaders have"} paused permissions
            </p>
            <Link href="/admin/requirements?state=paused" className="inline-flex h-9 items-center rounded-lg border border-red-200 bg-surface px-3 text-sm font-semibold text-danger hover:bg-danger-50 focus-visible:outline-2 focus-visible:outline-danger">
              See who
            </Link>
          </div>
        ) : null}
        <p className="sr-only">As of {fmtDate(now, "MMMM d")}.</p>
      </Card>
    </section>
  );
}
