import { ShieldCheck, ShieldOff } from "lucide-react";
import { fmtLongDate } from "@/lib/time";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { fmtServiceHours } from "@/lib/metrics/service";
import type { VerifiedRecord } from "@/lib/documents/involvement";
import { seatDates, studyLine } from "@/lib/documents/record";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/layout";
import { issued, SupportLink } from "./parts";

/**
 * An involvement record's verify result (lib/documents/involvement): the
 * record as it stands now (its summary and leadership, never the dates and
 * events), or that the account it belongs to has closed.
 */
export function InvolvementResult({ result, help }: { result: Exclude<VerifiedRecord, { state: "invalid" }>; help: string }) {
  if (result.state === "closed") {
    return (
      <Card className="flex items-start gap-3 px-5 py-5">
        <ShieldOff className="mt-0.5 h-6 w-6 shrink-0 text-ink-3" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold text-ink">This record is no longer available</h1>
          <p className="mt-1 text-ink-2">
            The link is genuine ({PLATFORM.name} issued it on {issued(result.issuedAt)}), but the account it belongs to has been closed, so there&apos;s no live record to show. To
            confirm the document, email {INSTITUTION.studentGovernment} at <SupportLink email={help} />.
          </p>
        </div>
      </Card>
    );
  }
  const { record } = result;
  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 border-b border-green-200 bg-success-50 px-5 py-4 text-green-900">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
          <div>
            <h1 className="text-lg font-semibold">This involvement record is genuine</h1>
            <p className="text-sm">
              {PLATFORM.name} issued it on {issued(result.issuedAt)}. Below is the record as it stands today, {fmtLongDate(new Date())}.
            </p>
          </div>
        </div>
        <div className="space-y-5 px-5 py-5">
          <div>
            <p className="text-2xl font-bold tracking-tight text-ink">{record.person.name}</p>
            <p className="text-ink-2">{studyLine(record.person) || INSTITUTION.name}</p>
            {record.person.status === "ALUMNI" ? (
              <Badge tone="brand" className="mt-2">
                Alumni
              </Badge>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Service hours" value={fmtServiceHours(record.summary.serviceMinutes)} />
            <Stat label="Service events" value={record.summary.serviceEvents} />
            <Stat label="Clubs" value={record.summary.clubs} />
            <Stat label="Leadership roles" value={record.summary.leadershipRoles} />
          </div>
          {record.leadership.length ? (
            <section aria-labelledby="leadership-heading">
              <h2 id="leadership-heading" className="text-sm font-semibold uppercase tracking-wide text-ink-3">
                Leadership
              </h2>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {record.leadership.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{s.title}</span>
                      <span className="text-ink-2"> · {s.club.name}</span>
                    </span>
                    <span className="text-ink-3">{seatDates(s)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </Card>
      <p className="text-sm text-ink-3">
        Numbers here are counted live from {PLATFORM.name}: service hours and attendance from event check-ins, leadership from club org charts. If they differ from the document,
        it changed after it was issued (a new event, or a club leader correcting a check-in). The document lists each service date; this page shows only the summary. Questions?
        Email {INSTITUTION.studentGovernment} at <SupportLink email={help} />.
      </p>
    </>
  );
}
