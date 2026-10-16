import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { INSTITUTION } from "@/lib/institution";
import { fmtLongDate } from "@/lib/time";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Callout, Container, EmptyState, PageHeader } from "@/components/ui/layout";
import { STATUS_LABEL, STATUS_TONE } from "@/components/founding/copy";

export const metadata: Metadata = { title: "Advising" };

/** Faculty/staff home for advising: invitations waiting on you and the clubs you advise. */
export default async function AdvisingPage() {
  const user = await requireUser("/advisor");
  const [invites, roles] = await Promise.all([
    db.advisorInvite.findMany({
      where: { status: "PENDING", OR: [{ inviteeId: user.id }, { email: { equals: user.email, mode: "insensitive" } }], club: { status: { notIn: ["RETIRED", "REJECTED"] } } },
      orderBy: { createdAt: "desc" },
      include: { club: { select: { name: true, logoUrl: true, logoColor: true, shortDescription: true } }, invitedBy: { select: { name: true } } },
    }),
    db.roleAssignment.findMany({
      where: { userId: user.id, role: "ADVISOR", endedAt: null },
      orderBy: { startedAt: "asc" },
      include: { club: { select: { name: true, slug: true, status: true, logoUrl: true, logoColor: true } } },
    }),
  ]);

  return (
    <Container size="md">
      <PageHeader title="Advising" description={`Clubs you advise at ${INSTITUTION.shortName}, and invitations waiting for your answer.`} />
      {user.kind !== "FACULTY_STAFF" ? (
        <Callout tone="info" title="Advisors are faculty and staff">
          Club advisors sign in with an @{INSTITUTION.staffEmailDomain} account. Students lead clubs from each club&apos;s workspace.
        </Callout>
      ) : (
        <div className="space-y-6">
          {invites.length ? (
            <Card>
              <CardHeader title="Waiting for your answer" />
              <ul className="divide-y divide-line">
                {invites.map((i) => (
                  <li key={i.id}>
                    <Link href={`/advisor/invite/${i.token}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/50">
                      <ClubLogo name={i.club.name} src={i.club.logoUrl} color={i.club.logoColor} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-ink">{i.club.name}</span>
                        <span className="block truncate text-xs text-ink-3">
                          From {i.invitedBy.name} · {fmtLongDate(i.createdAt)}
                        </span>
                      </span>
                      <Badge tone="info">
                        <Mail className="h-3 w-3" aria-hidden /> Respond
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {roles.length ? (
            <Card>
              <CardHeader title="Clubs you advise" />
              <ul className="divide-y divide-line">
                {roles.map((r) => (
                  <li key={r.id}>
                    <Link href={`/clubs/${r.club.slug}/manage`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/50">
                      <ClubLogo name={r.club.name} src={r.club.logoUrl} color={r.club.logoColor} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-ink">{r.club.name}</span>
                        <span className="block text-xs text-ink-3">Advisor since {fmtLongDate(r.startedAt)}</span>
                      </span>
                      <Badge tone={STATUS_TONE[r.club.status]}>{STATUS_LABEL[r.club.status]}</Badge>
                      <ArrowRight className="h-4 w-4 text-ink-3" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {!invites.length && !roles.length ? (
            <EmptyState title="You're not advising a club yet" description="When students invite you to advise their club, the invitation shows up here and in your email." />
          ) : null}
        </div>
      )}
    </Container>
  );
}
