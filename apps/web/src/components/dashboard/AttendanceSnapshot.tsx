import Link from "next/link";
import { CalendarCheck2, Star } from "lucide-react";
import type { MemberClubSummaryEntry } from "@/lib/metrics";
import { ProgressBar } from "@/components/ui/layout";
import { Panel } from "@/components/dashboard/Panel";

/**
 * Your attendance at a glance: check-ins this term, clubs you're active in,
 * and how close you are to reviewing each club. Every number comes from the
 * same places as /me/attendance (lib/metrics), so they always agree.
 */
export function AttendanceSnapshot({
  termLabel,
  termCheckins,
  activeIn,
  memberClubs,
  summaries,
}: {
  termLabel: string;
  termCheckins: number;
  activeIn: number;
  memberClubs: number;
  summaries: MemberClubSummaryEntry[];
}) {
  // Alumni and faculty/staff can't review, so their clubs show no review progress.
  const reviewable = summaries.filter((s) => s.summary.canReview);
  const locked = reviewable.filter((s) => !s.summary.reviewEligible).sort((a, b) => b.summary.attended - a.summary.attended);
  const unlocked = reviewable.filter((s) => s.summary.reviewEligible);
  return (
    <Panel id="dash-attendance" title="Your attendance" icon={<CalendarCheck2 />} link={{ href: "/me/attendance", label: "Details" }}>
      <dl className={memberClubs ? "grid grid-cols-2 gap-3" : "grid gap-3"}>
        <div className="rounded-xl bg-muted/70 px-3 py-2.5">
          <dt className="text-xs text-ink-3">Events this term</dt>
          <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{termCheckins}</dd>
          <dd className="text-xs text-ink-3">{termLabel}</dd>
        </div>
        {memberClubs ? (
          <div className="rounded-xl bg-muted/70 px-3 py-2.5">
            <dt className="text-xs text-ink-3">Active in</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">
              {activeIn}
              <span className="text-sm font-normal text-ink-3"> of {memberClubs}</span>
            </dd>
            <dd className="text-xs text-ink-3">club{memberClubs === 1 ? "" : "s"} you&apos;re in</dd>
          </div>
        ) : null}
      </dl>

      {locked.length ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Unlock reviews</h3>
          <ul className="mt-2 space-y-3">
            {locked.slice(0, 3).map(({ club, summary }) => {
              const left = Math.max(0, summary.reviewThreshold - summary.attended);
              return (
                <li key={club.id}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <Link href={`/clubs/${club.slug}`} className="min-w-0 truncate font-medium text-ink hover:text-brand-600 hover:underline">
                      {club.name}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-ink-3">
                      {summary.attended} of {summary.reviewThreshold}
                    </span>
                  </div>
                  <ProgressBar value={summary.attended} max={summary.reviewThreshold} className="mt-1 bg-brand-50" />
                  <p className="sr-only">
                    {left} more event{left === 1 ? "" : "s"} to review {club.name}.
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-ink-3">Go to {locked[0].summary.reviewThreshold} events and you can review the club.</p>
        </div>
      ) : null}

      {unlocked.length ? (
        <p className="mt-4 flex items-start gap-2 text-sm text-ink-2">
          <Star className="mt-0.5 h-4 w-4 shrink-0 fill-amber-400 text-amber-400" aria-hidden />
          <span>
            You can review{" "}
            {unlocked.length === 1 ? (
              <Link href={`/clubs/${unlocked[0].club.slug}#reviews`} className="font-medium text-brand-600 hover:underline">
                {unlocked[0].club.name}
              </Link>
            ) : (
              `${unlocked.length} of your clubs`
            )}
            .
          </span>
        </p>
      ) : null}
    </Panel>
  );
}
