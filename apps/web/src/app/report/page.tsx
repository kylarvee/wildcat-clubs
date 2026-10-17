import type { Metadata } from "next";
import Link from "next/link";
import { FileSearch, Inbox, LifeBuoy, Lock, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { myComplaints } from "@/lib/domain/complaints";
import { fmtDate, fmtLongDate } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, Container, PageHeader } from "@/components/ui/layout";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { COMPLAINT_STATUS_HELP, COMPLAINT_STATUS_LABEL, COMPLAINT_STATUS_TONE } from "@/components/admin/complaint-copy";
import { ReportForm } from "@/app/report/_components/ReportForm";

export const metadata: Metadata = { title: "Report a concern" };

/**
 * Report a concern — the one input tool for complaints. Signed-in Weber State
 * accounts only; reports go to WSUSA administrators and nowhere else.
 */
export default async function ReportPage() {
  const user = await requireUser("/report");
  const [mine, clubs] = await Promise.all([
    myComplaints(user),
    db.club.findMany({
      where: { status: { in: ["APPROVED", "SUBMITTED", "CHANGES_REQUESTED", "RETIRED"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true },
    }),
  ]);
  const options = clubs.map((c) => ({ value: c.id, label: c.name, hint: c.status === "RETIRED" ? "Retired" : c.status === "APPROVED" ? null : "In founding" }));

  return (
    <Container size="lg">
      <PageHeader
        title="Report a concern"
        description="Tell WSUSA administrators about hazing, discrimination, misuse of funds, safety problems or other policy violations in a club. You can report anonymously."
        actions={
          <ButtonLink href="/report/status" variant="outline">
            <FileSearch className="h-4 w-4" aria-hidden /> Check a report&rsquo;s status
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Callout tone="info" icon={<LifeBuoy />} title="If someone is in danger right now">
            Call 911 first. Reports here are read during WSUSA office hours, so they aren&rsquo;t for emergencies.
          </Callout>
          <Card className="p-4 sm:p-6">
            <ReportForm clubs={options} today={fmtDate(new Date(), "yyyy-MM-dd")} reporter={{ name: user.name, email: user.email }} />
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="How reports work" />
            <CardBody className="space-y-4 text-sm">
              <Point icon={<Lock />} title="Only administrators read reports">
                WSUSA administrators — and, when WSU policy requires it, the proper university authorities. Never club leaders, never other students.
              </Point>
              <Point icon={<ShieldCheck />} title="Anonymous means anonymous">
                We don&rsquo;t store who sent an anonymous report. Administrators must acknowledge that every time they open one.
              </Point>
              <Point icon={<FileSearch />} title="Keep your case code">
                Every report gets one. Use it to check the status any time, from any device.
              </Point>
            </CardBody>
          </Card>
          <PolicyNotices placement="COMPLAINTS" />
          <MyReports reports={mine} />
        </aside>
      </div>
    </Container>
  );
}

function Point({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-brand [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
        {icon}
      </span>
      <div>
        <p className="font-medium text-ink">{title}</p>
        <p className="text-ink-2">{children}</p>
      </div>
    </div>
  );
}

function MyReports({ reports }: { reports: Awaited<ReturnType<typeof myComplaints>> }) {
  return (
    <section aria-labelledby="my-reports">
      <h2 id="my-reports" className="mb-2 text-base font-semibold text-ink">
        My reports
      </h2>
      {reports.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface px-4 py-6 text-center text-sm">
          <Inbox className="mx-auto h-6 w-6 text-ink-3" aria-hidden />
          <p className="mt-2 font-medium text-ink">No named reports</p>
          <p className="mt-1 text-ink-3">
            Reports you send with your name show up here. Anonymous reports aren&rsquo;t linked to you — check those with their{" "}
            <Link href="/report/status" className="text-brand-600 underline-offset-2 hover:underline">
              case code
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id}>
              <Card className="p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold tracking-wider text-ink-2">{r.caseCode}</span>
                  <Badge tone={COMPLAINT_STATUS_TONE[r.status]}>{COMPLAINT_STATUS_LABEL[r.status]}</Badge>
                </div>
                <p className="mt-1.5 font-medium text-ink [overflow-wrap:anywhere]">{r.subject}</p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {r.category}
                  {r.club ? ` · ${r.club.name}` : ""} · sent {fmtLongDate(r.createdAt)}
                </p>
                <p className="mt-2 text-xs text-ink-2">
                  {COMPLAINT_STATUS_HELP[r.status]} <span className="text-ink-3">Updated {fmtLongDate(r.updatedAt)}.</span>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
