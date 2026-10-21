import Link from "next/link";
import { BadgeCheck, CalendarClock, ShieldCheck, ShieldOff } from "lucide-react";
import { fmtLongDate } from "@/lib/time";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { overseenBy } from "@/lib/offices/rules";
import type { VerifiedOfficers } from "@/lib/domain/officers";
import { recognizedLine, renewalLine, sinceLine } from "@/lib/documents/officers";
import { Card } from "@/components/ui/card";
import { OfficeContact } from "@/components/offices/OfficeContact";
import { issued, SupportLink } from "./parts";

/**
 * An officers of record letter's verify result (lib/domain/officers): the
 * club's officers and advisors as they stand today, read live from its org
 * chart, with the office that oversees it and where the club stands. Only
 * what the letter itself prints: names, titles and start dates, and the
 * office's public contacts.
 */
export function OfficersResult({ result, help }: { result: Exclude<VerifiedOfficers, { state: "invalid" }>; help: string }) {
  if (result.state === "closed") {
    return (
      <Card className="flex items-start gap-3 px-5 py-5">
        <ShieldOff className="mt-0.5 h-6 w-6 shrink-0 text-ink-3" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold text-ink">This letter is no longer available</h1>
          <p className="mt-1 text-ink-2">
            The link is genuine ({PLATFORM.name} issued it on {issued(result.issuedAt)}), but the club it names is no longer listed, so there are no current officers to show. To
            confirm the letter, email {INSTITUTION.studentGovernment} at <SupportLink email={help} />.
          </p>
        </div>
      </Card>
    );
  }

  const { record } = result;
  const { club, office } = record;
  if (result.state === "retired") {
    return (
      <Card className="flex items-start gap-3 px-5 py-5">
        <ShieldOff className="mt-0.5 h-6 w-6 shrink-0 text-ink-3" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold text-ink">{club.name} has retired</h1>
          <p className="mt-1 text-ink-2">
            The link is genuine ({PLATFORM.name} issued it on {issued(result.issuedAt)}), but the club retired{club.retiredAt ? ` on ${fmtLongDate(club.retiredAt)}` : " since"}, so it
            has no officers now. Who led it stays in its{" "}
            <Link href={`/clubs/${club.slug}/history`} className="font-medium text-brand-600 hover:underline">
              role history
            </Link>
            . Questions? Contact {office.name}
            {office.email ? (
              <>
                {" "}
                at <SupportLink email={office.email} />
              </>
            ) : null}
            .
          </p>
        </div>
      </Card>
    );
  }

  const renewal = renewalLine(record.renewal);
  const RenewalIcon = record.renewal.kind === "renewed" ? BadgeCheck : CalendarClock;
  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 border-b border-green-200 bg-success-50 px-5 py-4 text-green-900">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
          <div>
            <h1 className="text-lg font-semibold">This officers of record letter is genuine</h1>
            <p className="text-sm">
              {PLATFORM.name} issued it on {issued(result.issuedAt)}. Below are the club&apos;s officers as they stand today, {fmtLongDate(new Date())}.
            </p>
          </div>
        </div>
        <div className="space-y-6 px-5 py-5">
          <div>
            <Link href={`/clubs/${club.slug}`} className="text-2xl font-bold tracking-tight text-ink hover:text-brand-600 hover:underline">
              {club.name}
            </Link>
            <p className="text-ink-2">
              {overseenBy(office)}
              {recognizedLine(record) ? ` · ${recognizedLine(record)}` : ""}
            </p>
            {renewal ? (
              <p className="mt-2 flex items-start gap-2 text-sm text-ink-2">
                <RenewalIcon className={record.renewal.kind === "renewed" ? "mt-0.5 h-4 w-4 shrink-0 text-brand" : "mt-0.5 h-4 w-4 shrink-0 text-ink-3"} aria-hidden />
                {renewal}
              </p>
            ) : null}
          </div>

          <PeopleList id="officers-heading" title="Officers" empty="No one holds an officer seat right now." rows={record.officers.map((o) => ({ id: o.id, name: o.name, title: o.title, since: o.since }))} />
          <PeopleList
            id="advisors-heading"
            title={record.advisors.length === 1 ? "Advisor" : "Advisors"}
            empty="The club has no faculty or staff advisor right now."
            rows={record.advisors.map((a) => ({ id: a.id, name: a.name, title: "Faculty or staff advisor", since: a.since }))}
          />

          <section aria-labelledby="contact-heading">
            <h2 id="contact-heading" className="text-sm font-semibold uppercase tracking-wide text-ink-3">
              Questions about this club
            </h2>
            <p className="mt-1 text-sm text-ink-2">{office.name} oversees the club and can confirm anything here.</p>
            <OfficeContact office={office} className="mt-3" />
          </section>
        </div>
      </Card>
      <p className="text-sm text-ink-3">
        This list is read live from the club&apos;s org chart on {PLATFORM.name}, {INSTITUTION.name}&apos;s platform for student clubs. If it differs from the letter, the
        club&apos;s leadership changed after the letter was issued. Officers&apos; own contact details are never shown; reach the club through {office.name}.
      </p>
    </>
  );
}

function PeopleList({ id, title, empty, rows }: { id: string; title: string; empty: string; rows: { id: string; name: string; title: string; since: Date }[] }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold uppercase tracking-wide text-ink-3">
        {title}
      </h2>
      {rows.length ? (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-ink">{r.name}</span>
                <span className="text-ink-2"> · {r.title}</span>
              </span>
              <span className="text-ink-3">Since {sinceLine(r.since)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-xl border border-dashed border-line-2 px-4 py-3 text-sm text-ink-3">{empty}</p>
      )}
    </section>
  );
}
