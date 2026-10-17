import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck, Clock, TriangleAlert } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { fmtAgo, fmtLongDate, fmtTime } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/layout";
import { RunJobs } from "@/components/system/RunJobs";

export const metadata: Metadata = { title: "Scheduled jobs" };

type RunData = { manual?: boolean; reports?: { name: string; ok: boolean; detail?: string }[] };

/**
 * Scheduled jobs (system.config): reminders, elections opening and closing,
 * overdue requirements and the other time-based work. A scheduler calls the
 * cron URL; this page can also run them on demand and shows recent runs.
 */
export default async function JobsPage() {
  const user = await requireUser("/system/jobs");
  if (!can(user, "system.config")) notFound();

  const runs = await db.activityLog.findMany({
    where: { action: "system.jobs_run" },
    orderBy: { at: "desc" },
    take: 12,
    select: { id: true, at: true, data: true, actor: { select: { name: true } } },
  });
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const secretState = !secret ? "missing" : secret === "change-me" ? "default" : "set";
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const lastScheduled = runs.find((r) => !(r.data as RunData | null)?.manual) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scheduled jobs"
        description="Time-based work the platform does on its own: reminders, requirement deadlines, opening and closing elections, and similar checks. Each job is safe to run more than once."
      />

      <Card>
        <CardHeader title="Run now" description="Runs every job immediately, exactly as the schedule would. Use it to test reminders or to catch up after the scheduler was down." />
        <CardBody>
          <RunJobs />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="The schedule" description="Point the server's scheduler (a crontab, Vercel Cron or Cloud Scheduler) at this address every 15 minutes." />
        <CardBody className="space-y-4 text-sm">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">Request</p>
            <pre className="overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-xs leading-relaxed text-white">
              {`GET ${appUrl}/api/cron/tick\nAuthorization: Bearer $CRON_SECRET`}
            </pre>
            <p className="mt-1.5 text-ink-3">
              Requests without the secret are refused. <code className="font-mono text-xs">$CRON_SECRET</code> stands for the value of the <code className="font-mono text-xs">CRON_SECRET</code> environment variable — it isn&rsquo;t shown here.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">CRON_SECRET</span>
            {secretState === "set" ? (
              <Badge tone="success">
                <CircleCheck className="h-3 w-3" aria-hidden /> Set
              </Badge>
            ) : secretState === "default" ? (
              <Badge tone="warning">
                <TriangleAlert className="h-3 w-3" aria-hidden /> Still the example value
              </Badge>
            ) : (
              <Badge tone="danger">
                <CircleAlert className="h-3 w-3" aria-hidden /> Not set
              </Badge>
            )}
            <span className="text-ink-3">
              {secretState === "set"
                ? "The scheduler must send the same value."
                : secretState === "default"
                  ? "Replace “change-me” with a long random value before launch, or anyone could trigger the jobs."
                  : "Set it on the server, or the scheduler can't run the jobs."}
            </span>
          </div>
          <p className="flex items-center gap-2 text-ink-2">
            <Clock className="h-4 w-4 text-ink-3" aria-hidden />
            {lastScheduled ? `Last scheduled run ${fmtAgo(lastScheduled.at)} (${fmtLongDate(lastScheduled.at)} at ${fmtTime(lastScheduled.at)}).` : "No scheduled run recorded yet."}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent runs" />
        {runs.length ? (
          <ol className="divide-y divide-line">
            {runs.map((r) => {
              const d = (r.data as RunData | null) ?? {};
              const reports = d.reports ?? [];
              const failed = reports.filter((x) => !x.ok);
              return (
                <li key={r.id.toString()} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2">
                      {failed.length ? (
                        <Badge tone="danger">
                          <CircleAlert className="h-3 w-3" aria-hidden /> {failed.length} failed
                        </Badge>
                      ) : (
                        <Badge tone="success">
                          <CircleCheck className="h-3 w-3" aria-hidden /> {reports.length ? `${reports.length} ran` : "Nothing to run"}
                        </Badge>
                      )}
                      <span className="text-ink-2">{d.manual ? `Run by ${r.actor?.name ?? "a system administrator"}` : "Scheduled"}</span>
                    </p>
                    <time dateTime={r.at.toISOString()} className="text-xs text-ink-3">
                      {fmtLongDate(r.at)} at {fmtTime(r.at)}
                    </time>
                  </div>
                  {failed.length ? (
                    <ul className="mt-1.5 space-y-0.5 text-xs text-danger">
                      {failed.map((f, i) => (
                        <li key={i} className="[overflow-wrap:anywhere]">
                          <span className="font-medium">{f.name}:</span> {f.detail}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <CardBody>
            <p className="text-sm text-ink-3">No runs recorded yet. Press “Run jobs now” to try them.</p>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
