"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { Loader2, Search } from "lucide-react";
import type { ComplaintStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { fmtLongDate, fmtTime } from "@/lib/time";
import { COMPLAINT_STATUS_HELP, COMPLAINT_STATUS_LABEL, COMPLAINT_STATUS_TONE, normalizeCaseCode } from "@/components/admin/complaint-copy";
import { checkComplaintStatusAction } from "@/app/report/actions";

type Result = { caseCode: string; status: ComplaintStatus; updatedAt: string };

const STEPS = ["Received", "In review", "Decided"];
function stepIndex(s: ComplaintStatus) {
  return s === "NEW" ? 0 : s === "IN_REVIEW" ? 1 : 2;
}

/** Look up a report by case code. Shows the status and when it last changed — nothing else. */
export function StatusLookup() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputId = useId();
  const errorId = useId();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get("code") ?? "");
    setResult(null);
    if (!normalizeCaseCode(raw)) {
      setError("Case codes look like WC-7KQ2-48: “WC”, four letters or numbers, then two digits.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        const r = await checkComplaintStatusAction(raw);
        if (!r.ok) return setError(r.code === "NOT_FOUND" ? "We couldn't find a report with that case code. Check each character — codes never use the letters O or I." : r.error);
        setResult(r.data);
      } catch {
        setError("We couldn't reach the server. Check your connection and try again.");
      }
    });
  }

  const finished = result && (result.status === "RESOLVED" || result.status === "CLOSED" || result.status === "REFERRED");

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <form onSubmit={submit} noValidate className="space-y-2" aria-busy={pending}>
          <label htmlFor={inputId} className="block text-sm font-medium text-ink">
            Case code
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={inputId}
              name="code"
              placeholder="WC-0000-00"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={20}
              className="font-mono uppercase tracking-wider sm:max-w-xs"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
              {pending ? "Checking…" : "Check status"}
            </Button>
          </div>
          {error ? (
            <p id={errorId} className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : (
            <p className="text-xs text-ink-3">You got this code when you sent the report. Checking a code isn&rsquo;t recorded.</p>
          )}
        </form>
      </Card>

      <div aria-live="polite">
        {result ? (
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-sm font-semibold tracking-wider text-ink-2">{result.caseCode}</p>
              <Badge tone={COMPLAINT_STATUS_TONE[result.status]}>{COMPLAINT_STATUS_LABEL[result.status]}</Badge>
            </div>
            <ol className="mt-4 flex flex-wrap items-center gap-2 text-xs" aria-label="Progress">
              {STEPS.map((label, i) => {
                const reached = i <= stepIndex(result.status);
                return (
                  <li key={label} className="flex items-center gap-2" aria-current={i === stepIndex(result.status) ? "step" : undefined}>
                    <span className={reached ? "rounded-full bg-brand px-2.5 py-1 font-medium text-white" : "rounded-full bg-muted px-2.5 py-1 text-ink-3"}>
                      {i === 2 && finished ? COMPLAINT_STATUS_LABEL[result.status] : label}
                    </span>
                    {i < STEPS.length - 1 ? <span className="h-px w-4 bg-line-2" aria-hidden /> : null}
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 text-sm text-ink">{COMPLAINT_STATUS_HELP[result.status]}</p>
            <p className="mt-1 text-sm text-ink-3">
              Last updated {fmtLongDate(result.updatedAt)} at {fmtTime(result.updatedAt)}
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
