import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { INSTITUTION } from "@/lib/institution";
import { fmtLongDate } from "@/lib/time";
import { Container, PageHeader, Callout } from "@/components/ui/layout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClubLogo } from "@/components/ui/avatar";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { CreateClubWizard } from "@/components/founding/CreateClubWizard";
import { STATUS_LABEL, STATUS_TONE } from "@/components/founding/copy";

export const metadata: Metadata = { title: "Start a club" };

const STEPS = [
  { title: "Create your draft", body: "Pick your club type and the basics. Saved as a private draft." },
  { title: "Finish your profile", body: "Description, logo and focus — what students will see." },
  { title: "Invite an advisor", body: `A ${INSTITUTION.shortName} faculty or staff member accepts by email.` },
  { title: "Adopt a constitution", body: "Use the builder's default constitution and bylaws, or customize them." },
  { title: `Submit to ${INSTITUTION.studentGovernment}`, body: "They review and approve. Then events, budgets and the rest unlock." },
];

export default async function NewClubPage() {
  const user = await requireUser("/clubs/new");
  const allowed = can(user, "club.create");

  const [departments, colleges, majors, inProgress] = allowed
    ? await Promise.all([
        db.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, college: { select: { shortName: true } } } }),
        db.college.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
        db.major.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, college: { select: { shortName: true } } } }),
        db.club.findMany({
          where: { createdById: user.id, status: { in: ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, slug: true, status: true, logoUrl: true, logoColor: true, createdAt: true },
        }),
      ])
    : [[], [], [], []];

  return (
    <Container size="xl">
      <PageHeader
        title="Start a club"
        description={`Bring your people together at ${INSTITUTION.shortName}. Set up a draft in a couple of minutes — you'll finish the rest at your own pace before sending it to ${INSTITUTION.studentGovernment}.`}
        breadcrumbs={[{ href: "/clubs", label: "Clubs" }, { label: "Start a club" }]}
      />
      {!allowed ? (
        <Callout tone="warning" title="This account can't start a club">
          Only active student, faculty and staff accounts can found clubs. If you think that&apos;s a mistake, contact {INSTITUTION.studentGovernment}.
        </Callout>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-6">
            {inProgress.length ? (
              <Card>
                <CardHeader title="Clubs you're already founding" description="Pick up where you left off instead of starting over." />
                <ul className="divide-y divide-line">
                  {inProgress.map((c) => (
                    <li key={c.id}>
                      <Link href={`/clubs/${c.slug}/manage`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50">
                        <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{c.name}</span>
                          <span className="block text-xs text-ink-3">Started {fmtLongDate(c.createdAt)}</span>
                        </span>
                        <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                        <ArrowRight className="h-4 w-4 text-ink-3" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            <CreateClubWizard
              founderIsStaff={user.kind === "FACULTY_STAFF"}
              departments={departments.map((d) => ({ value: d.id, label: d.name, hint: d.college?.shortName ?? null }))}
              colleges={colleges}
              majors={majors.map((m) => ({ value: m.id, label: m.name, hint: m.college?.shortName ?? null }))}
            />
          </div>
          <aside className="space-y-4">
            <Card>
              <CardHeader title="How founding works" />
              <CardBody>
                <ol className="space-y-4">
                  {STEPS.map((s, i) => (
                    <li key={s.title} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand">{i + 1}</span>
                      <span className="text-sm">
                        <span className="block font-medium text-ink">{s.title}</span>
                        <span className="block text-ink-3">{s.body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
            <PolicyNotices placement="CLUB_CREATION" title="Policies for new clubs" />
          </aside>
        </div>
      )}
    </Container>
  );
}
