import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { getConfig } from "@/lib/config";
import { fmtLongDate, fmtTime } from "@/lib/time";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { fmtServiceHours } from "@/lib/metrics/service";
import { verifiedRecord } from "@/lib/documents/involvement";
import { seatDates, studyLine } from "@/lib/documents/record";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Container, Stat } from "@/components/ui/layout";
import { LogoMark } from "@/components/shell/Logo";

type Props = { params: Promise<{ token: string }> };

// A verification link is shared on purpose; keep it out of search engines all the same.
export const metadata: Metadata = { title: "Verify a record", robots: { index: false, follow: false } };

const issued = (d: Date) => `${fmtLongDate(d)} at ${fmtTime(d)}`;

/**
 * /verify/[token]: the public check behind the QR code on an involvement
 * record (lib/documents/tokens). A link we signed shows the record as it
 * stands now (its summary and leadership, never the dates and events) and
 * when the document was issued; anything else says plainly that the link
 * isn't valid. No sign-in: the link is the permission.
 */
export default async function VerifyPage({ params }: Props) {
  const { token } = await params;
  // Tokens are URL-safe as issued, so the segment is used as it arrives.
  const [result, cfg] = await Promise.all([verifiedRecord(token), getConfig()]);
  const help = cfg["platform.supportEmail"];

  return (
    <Container size="md">
      <div className="mx-auto max-w-2xl space-y-6 py-4">
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-brand">{INSTITUTION.name}</p>
            <p className="text-sm text-ink-3">{PLATFORM.name} · Record verification</p>
          </div>
        </div>

        {result.state === "valid" ? (
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
                  <p className="text-2xl font-bold tracking-tight text-ink">{result.record.person.name}</p>
                  <p className="text-ink-2">{studyLine(result.record.person) || INSTITUTION.name}</p>
                  {result.record.person.status === "ALUMNI" ? (
                    <Badge tone="brand" className="mt-2">
                      Alumni
                    </Badge>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Service hours" value={fmtServiceHours(result.record.summary.serviceMinutes)} />
                  <Stat label="Service events" value={result.record.summary.serviceEvents} />
                  <Stat label="Clubs" value={result.record.summary.clubs} />
                  <Stat label="Leadership roles" value={result.record.summary.leadershipRoles} />
                </div>
                {result.record.leadership.length ? (
                  <section aria-labelledby="leadership-heading">
                    <h2 id="leadership-heading" className="text-sm font-semibold uppercase tracking-wide text-ink-3">
                      Leadership
                    </h2>
                    <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                      {result.record.leadership.map((s) => (
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
              Numbers here are counted live from {PLATFORM.name}: service hours and attendance from event check-ins, leadership from club org charts. If they differ from the
              document, it changed after it was issued (a new event, or a club leader correcting a check-in). The document lists each service date; this page shows only the
              summary. Questions? Email {INSTITUTION.studentGovernment} at{" "}
              <a href={`mailto:${help}`} className="font-medium text-brand-600 hover:underline">
                {help}
              </a>
              .
            </p>
          </>
        ) : result.state === "closed" ? (
          <Card className="flex items-start gap-3 px-5 py-5">
            <ShieldOff className="mt-0.5 h-6 w-6 shrink-0 text-ink-3" aria-hidden />
            <div>
              <h1 className="text-lg font-semibold text-ink">This record is no longer available</h1>
              <p className="mt-1 text-ink-2">
                The link is genuine ({PLATFORM.name} issued it on {issued(result.issuedAt)}), but the account it belongs to has been closed, so there&apos;s no live record to show.
                To confirm the document, email {INSTITUTION.studentGovernment} at{" "}
                <a href={`mailto:${help}`} className="font-medium text-brand-600 hover:underline">
                  {help}
                </a>
                .
              </p>
            </div>
          </Card>
        ) : (
          <Card className="flex items-start gap-3 px-5 py-5">
            <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-danger" aria-hidden />
            <div>
              <h1 className="text-lg font-semibold text-ink">This link isn&apos;t valid</h1>
              <p className="mt-1 text-ink-2">
                It doesn&apos;t match any record {PLATFORM.name} issued. It may have been cut short or changed when it was copied. Scan the QR code on the document again, or ask the
                student for a fresh copy of their involvement record. Questions? Email {INSTITUTION.studentGovernment} at{" "}
                <a href={`mailto:${help}`} className="font-medium text-brand-600 hover:underline">
                  {help}
                </a>
                .
              </p>
            </div>
          </Card>
        )}

        <p className="text-xs text-ink-3">
          <Link href="/" className="hover:text-ink hover:underline">
            {PLATFORM.name}
          </Link>{" "}
          is {INSTITUTION.name}&apos;s platform for student clubs and organizations.
        </p>
      </div>
    </Container>
  );
}
