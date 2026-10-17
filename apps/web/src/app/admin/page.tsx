import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowRight, BarChart3, CheckCircle2, Network, Sprout, TrendingDown } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { platformSummary } from "@/lib/metrics";
import { fmtAgo, fmtDate, fmtLongDate } from "@/lib/time";
import { atRiskClubs, clubCounts, recentPlatformActivity, waitingOnWsusa, type AtRiskClub, type Queue } from "@/lib/analytics/admin";
import { CLUB_TYPE_NAMES } from "@/lib/analytics/club-table";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { PageHeader, Stat } from "@/components/ui/layout";
import { BarList, type BarItem } from "@/components/analytics/BarList";
import { MonthlyCheckinsChart } from "@/components/analytics/MonthlyCheckinsChart";

export const metadata: Metadata = { title: "Admin overview" };

const fmt = (n: number) => n.toLocaleString("en-US");
const pctOf = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * WSUSA's front page: this term's headline numbers (all from lib/metrics
 * platformSummary), check-ins by month, what's waiting on WSUSA, clubs at
 * risk of going inactive, and recent platform activity. Reports appear only
 * as a count.
 */
export default async function AdminOverviewPage() {
  const user = await requireUser("/admin");
  if (!can(user, "admin.access")) notFound();
  const now = new Date();
  const [summary, waiting, atRisk, counts, feed] = await Promise.all([platformSummary(now), waitingOnWsusa(), atRiskClubs(now), clubCounts(), recentPlatformActivity(12)]);

  const term = summary.termName ?? "this term";
  const onRecord = summary.activeClubs - summary.pilotClubs;
  const founding = (counts.byStatus.DRAFT ?? 0) + (counts.byStatus.SUBMITTED ?? 0) + (counts.byStatus.CHANGES_REQUESTED ?? 0);
  const busyQueues = waiting.queues.filter((q) => q.count > 0).length + (waiting.other ? 1 : 0);

  // The newest month is still running: drawn lighter so a half month doesn't read as a drop.
  const thisMonth = fmtDate(now, "MMM yyyy");
  const months = summary.monthlyCheckins.map((m) => ({ ...m, partial: m.month === thisMonth }));
  const yearTotal = summary.monthlyCheckins.reduce((n, m) => n + m.checkins, 0);

  const stages: BarItem[] = [
    { key: "active", label: "Active on their record", value: onRecord, href: "/admin/analytics?status=active" },
    { key: "pilot", label: "In their pilot period", value: summary.pilotClubs, href: "/admin/analytics?status=pilot" },
    { key: "inactive", label: "Inactive", value: summary.inactiveClubs, href: "/admin/analytics?status=inactive" },
    {
      key: "founding",
      label: "In founding",
      value: founding,
      hint: foundingHint(counts.byStatus),
      href: "/admin/analytics?status=founding",
    },
    { key: "retired", label: "Retired", value: counts.byStatus.RETIRED ?? 0, href: "/admin/analytics?status=retired" },
    { key: "rejected", label: "Not approved", value: counts.byStatus.REJECTED ?? 0, href: "/admin/analytics?status=rejected" },
  ];
  const types: BarItem[] = (Object.keys(CLUB_TYPE_NAMES) as (keyof typeof CLUB_TYPE_NAMES)[])
    .map((t) => ({ key: t, label: CLUB_TYPE_NAMES[t], value: counts.approvedByType[t] ?? 0, href: `/admin/analytics?status=approved&type=${t}` }))
    .sort((a, b) => b.value - a.value);
  const barMax = Math.max(...stages.map((s) => s.value), ...types.map((t) => t.value));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={`How Weber State's clubs are doing in ${term}, and what's waiting on WSUSA.`}
        actions={
          <>
            <ButtonLink href="/admin/analytics" variant="outline" size="sm">
              <BarChart3 className="h-4 w-4" aria-hidden="true" /> Club analytics
            </ButtonLink>
            <ButtonLink href="/network" variant="outline" size="sm">
              <Network className="h-4 w-4" aria-hidden="true" /> Club network
            </ButtonLink>
          </>
        }
        className="mb-0"
      />

      <section aria-labelledby="glance-title">
        <h2 id="glance-title" className="sr-only">
          {term} at a glance
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Active clubs" value={fmt(summary.activeClubs)} hint={summary.pilotClubs ? `${fmt(onRecord)} on their record, ${fmt(summary.pilotClubs)} in pilot` : "Meeting the activity bar"} />
          <Stat label="In pilot period" value={fmt(summary.pilotClubs)} hint="New clubs, active until the pilot ends" />
          <Stat label="Inactive clubs" value={fmt(summary.inactiveClubs)} hint="Approved, but below the bar" />
          <Stat label="Students showing up" value={fmt(summary.activeStudents)} hint={`Active in a club · ${pctOf(summary.activeStudents, summary.students)} of ${fmt(summary.students)} students`} />
          <Stat label="Check-ins" value={fmt(summary.checkinsThisTerm)} hint={`${term} so far`} />
          <Stat label="Events held" value={fmt(summary.eventsThisTerm)} hint="With at least one check-in" />
          <Stat
            label="Cross-club check-ins"
            value={fmt(summary.crossClubCheckinsThisTerm)}
            hint={summary.checkinsThisTerm ? `${pctOf(summary.crossClubCheckinsThisTerm, summary.checkinsThisTerm)} of check-ins linked two clubs` : "Members visiting other clubs"}
          />
          <Link href="#waiting" className="group block rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <Stat
              label="Waiting on WSUSA"
              value={fmt(waiting.total)}
              hint={waiting.total ? `Across ${busyQueues} ${busyQueues === 1 ? "queue" : "queues"}` : "Nothing waiting"}
              className={cn("h-full transition-colors group-hover:border-brand-200", waiting.total ? "bg-brand-50/40" : "")}
            />
          </Link>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <Card className="min-w-0">
          <CardHeader
            title="Check-ins by month"
            description={yearTotal ? `${fmt(yearTotal)} check-ins at club and university events over the last 12 months.` : "Check-ins at club and university events over the last 12 months."}
          />
          <CardBody>
            {yearTotal ? (
              <MonthlyCheckinsChart months={months} height={240} />
            ) : (
              <p className="flex h-[240px] flex-col items-center justify-center gap-2 rounded-xl bg-muted/50 text-center text-sm text-ink-3">
                <BarChart3 className="h-6 w-6" aria-hidden="true" />
                No check-ins in the last 12 months yet.
              </p>
            )}
          </CardBody>
        </Card>

        <Card id="waiting" className="min-w-0 scroll-mt-24">
          <CardHeader
            title="Waiting on WSUSA"
            description={waiting.total ? `${fmt(waiting.total)} open ${waiting.total === 1 ? "item" : "items"} for any admin to pick up.` : "All caught up."}
          />
          <QueueList queues={waiting.other ? [...waiting.queues, waiting.other] : waiting.queues} now={now} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <Card className="min-w-0">
          <CardHeader
            title="Clubs at risk"
            description="Approved clubs below the activity bar now, or likely to fall below it."
            action={
              atRisk.length ? (
                <Link href="/admin/analytics?status=inactive" className="text-sm font-medium text-brand-600 hover:underline">
                  All inactive
                </Link>
              ) : null
            }
          />
          <AtRiskList clubs={atRisk} />
        </Card>

        <Card className="min-w-0">
          <CardHeader title="Where clubs stand" description="Every club on the platform, by status." />
          <CardBody className="space-y-6">
            <BarList items={stages} max={barMax} label="Clubs by status" />
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Approved clubs by type</h3>
              <BarList items={types} max={barMax} label="Approved clubs by type" />
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent activity" description="The latest public changes across every club: approvals, new officers, events and more." />
        {feed.length ? (
          <ol className="divide-y divide-line">
            {feed.map((f) => (
              <li key={f.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                <Avatar name={f.actor?.name ?? "Wildcat Clubs"} src={f.actor?.avatarUrl} color={f.actor?.avatarColor ?? "#77707f"} size="xs" className="mt-0.5" />
                <p className="min-w-0 flex-1 text-ink-2">
                  <span className="font-medium text-ink">{f.actor?.name ?? "Wildcat Clubs"}</span> {f.text}
                  {f.club ? (
                    <>
                      {" "}
                      <Link href={`/admin/analytics/${f.club.id}`} className="font-medium text-ink hover:text-brand-600 hover:underline">
                        {f.club.name}
                      </Link>
                    </>
                  ) : null}
                </p>
                <time dateTime={f.at.toISOString()} title={fmtLongDate(f.at)} className="shrink-0 text-xs text-ink-3">
                  {fmtAgo(f.at)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <CardBody>
            <p className="text-sm text-ink-3">Nothing yet. Approvals, new officers and new events show up here as clubs get going.</p>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

function foundingHint(byStatus: Partial<Record<string, number>>) {
  const parts = [
    byStatus.SUBMITTED ? `${byStatus.SUBMITTED} waiting on WSUSA` : null,
    byStatus.CHANGES_REQUESTED ? `${byStatus.CHANGES_REQUESTED} sent back for changes` : null,
    byStatus.DRAFT ? `${byStatus.DRAFT} ${byStatus.DRAFT === 1 ? "draft" : "drafts"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function QueueList({ queues, now }: { queues: Queue[]; now: Date }) {
  return (
    <ul className="divide-y divide-line">
      {queues.map((q) => (
        <li key={q.key}>
          <Link
            href={q.href}
            className="group flex items-center gap-3 px-5 py-3 hover:bg-muted/40 focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
          >
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm font-medium group-hover:text-brand-600", q.count ? "text-ink" : "text-ink-2")}>{q.label}</span>
              <span className="block text-xs text-ink-3">
                {q.count && q.oldest ? waitedFor(q.oldest, now, q.count) : q.detail}
              </span>
            </span>
            {q.count ? (
              <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold tabular-nums text-white">{fmt(q.count)}</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" /> None
              </span>
            )}
            <ArrowRight className="h-4 w-4 shrink-0 text-ink-3 group-hover:text-brand-600" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function waitedFor(since: Date, now: Date, count: number) {
  const days = Math.floor((now.getTime() - since.getTime()) / 86_400_000);
  const who = count === 1 ? "Waiting" : "Oldest waiting";
  if (days < 1) return count === 1 ? "Came in today" : "Oldest came in today";
  return `${who} ${days === 1 ? "1 day" : `${days} days`}`;
}

const RISK_TONE = { inactive: "warning", pilot: "info", slipping: "neutral" } as const;

function AtRiskList({ clubs }: { clubs: AtRiskClub[] }) {
  if (!clubs.length)
    return (
      <CardBody>
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" /> Every approved club is meeting the activity bar, with room to spare.
        </p>
      </CardBody>
    );
  return (
    <ul className="divide-y divide-line">
      {clubs.map((c) => (
        <li key={c.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-5 py-3">
          <span className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true">
            {c.kind === "inactive" ? <AlertTriangle className="h-4 w-4 text-warning" /> : c.kind === "pilot" ? <Sprout className="h-4 w-4 text-info" /> : <TrendingDown className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1 basis-56">
            <Link href={`/admin/analytics/${c.id}`} className="font-medium text-ink hover:text-brand-600 hover:underline">
              {c.name}
            </Link>
            <ul className="mt-0.5 space-y-0.5 text-sm text-ink-2">
              {c.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <Badge tone={c.kind === "pilot" && c.endsThisTerm ? "warning" : RISK_TONE[c.kind]}>{c.endsThisTerm ? `${c.tag} · this term` : c.tag}</Badge>
        </li>
      ))}
    </ul>
  );
}
