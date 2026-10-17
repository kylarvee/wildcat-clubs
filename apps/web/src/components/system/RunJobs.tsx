"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, Loader2, Play } from "lucide-react";
import type { JobReport } from "@/lib/jobs/tick";
import { fmtTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { runJobsNowAction } from "@/app/system/jobs/actions";

/** "Run jobs now", then each job's report. Jobs are idempotent, so running early is safe. */
export function RunJobs() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ranAt: string; reports: JobReport[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const r = await runJobsNowAction();
      if (!r.ok) return setError(r.error);
      setResult(r.data);
      const failed = r.data.reports.filter((x) => !x.ok).length;
      if (failed) toast.error(`${failed} job${failed === 1 ? "" : "s"} failed`);
      else toast.success("Jobs finished");
    } catch {
      setError("We couldn't reach the server, so the jobs didn't run. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          {pending ? "Running…" : "Run jobs now"}
        </Button>
        <p className="text-sm text-ink-3">Safe to run any time — each job skips work that&rsquo;s already done.</p>
      </div>
      {error ? (
        <Callout tone="danger" title="Jobs didn't run">
          {error}
        </Callout>
      ) : null}
      <div aria-live="polite">{result ? <JobReports reports={result.reports} ranAt={result.ranAt} /> : null}</div>
    </div>
  );
}

export function JobReports({ reports, ranAt }: { reports: JobReport[]; ranAt?: string }) {
  if (!reports.length) return <p className="rounded-lg border border-dashed border-line-2 px-4 py-4 text-sm text-ink-3">No jobs are registered yet, so there was nothing to run.</p>;
  const failed = reports.filter((r) => !r.ok).length;
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <p className="border-b border-line bg-muted/50 px-4 py-2 text-sm font-medium text-ink">
        {failed ? `${failed} of ${reports.length} jobs failed` : `All ${reports.length} jobs finished`}
        {ranAt ? <span className="font-normal text-ink-3"> · ran at {fmtTime(ranAt)}</span> : null}
      </p>
      <ul className="divide-y divide-line">
        {reports.map((r, i) => (
          <li key={`${r.name}-${i}`} className="flex gap-3 px-4 py-2.5 text-sm">
            {r.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Finished" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-label="Failed" />}
            <div className="min-w-0">
              <p className="font-medium text-ink">{r.name}</p>
              {r.detail ? <p className="whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{r.detail}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
