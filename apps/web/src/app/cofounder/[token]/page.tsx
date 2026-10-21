import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Armchair, CalendarCheck, FileText, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { officeById } from "@/lib/offices";
import { fmtLongDate } from "@/lib/time";
import { loadCofounderInviteForViewer } from "@/lib/domain/cofounders";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, Container } from "@/components/ui/layout";
import { CofounderInviteResponse } from "@/components/founding/CofounderInviteResponse";
import { TYPE_LABEL } from "@/components/founding/copy";

export const metadata: Metadata = { title: "Co-founder invitation" };

function mask(email: string) {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

/** A co-founder invitation (lib/domain/cofounders), like an advisor's (/advisor/invite/[token]). */
export default async function CofounderInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireUser(`/cofounder/${token}`);
  const view = await loadCofounderInviteForViewer(user, token);
  if (!view) notFound();
  const { invite, emailMatches, open, canAnswer } = view;
  const club = invite.club;
  const office = await officeById(club.officeId);
  const steps = [
    { icon: Users, title: "Join the founding team", body: `You become a member of ${club.name} now, before it's approved.` },
    { icon: Armchair, title: "Take a seat", body: "A founder can give you a seat on the org chart, like Vice President or Treasurer." },
    { icon: FileText, title: "Help finish the checklist", body: "The profile, a faculty or staff advisor, and the constitution and bylaws." },
    { icon: CalendarCheck, title: `${office.name} reviews it`, body: "Once it's approved, events, budgets and the rest of the club's tools unlock." },
  ];

  return (
    <Container size="md">
      <p className="mb-2 text-sm font-medium text-brand">Co-founder invitation</p>
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Help start {club.name}?</h1>
      <p className="mt-2 text-ink-2">
        {invite.invitedBy.name} invited {emailMatches ? "you" : invite.name} on {fmtLongDate(invite.createdAt)} to join the founding team of a new club at {INSTITUTION.shortName}.
      </p>

      <div className="mt-6 space-y-6">
        <Card>
          <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="lg" />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-semibold text-ink">{club.name}</p>
                <Badge tone="brand">{TYPE_LABEL[club.type]}</Badge>
              </div>
              <p className="text-sm text-ink-2">{club.shortDescription || "The founders are still writing their description."}</p>
              <p className="text-xs text-ink-3">
                Invited by {invite.invitedBy.name}
                {emailMatches ? (
                  <>
                    {" · "}
                    <a href={`mailto:${invite.invitedBy.email}`} className="text-brand-600 hover:underline">
                      {invite.invitedBy.email}
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          </CardBody>
        </Card>

        {invite.status === "ACCEPTED" ? (
          <Callout tone="success" title={emailMatches ? `You're on ${club.name}'s founding team` : "This invitation was accepted"}>
            {emailMatches ? (
              <>
                A founder can give you a seat on the org chart; then its workspace opens for you.{" "}
                <Link href={`/clubs/${club.slug}`} className="font-medium underline">
                  Open the club&apos;s page
                </Link>
              </>
            ) : null}
          </Callout>
        ) : invite.status === "DECLINED" ? (
          <Callout tone="info" title="This invitation was declined">
            {invite.respondedAt ? `Declined ${fmtLongDate(invite.respondedAt)}.` : null} If you change your mind, ask the founders to send a new one.
          </Callout>
        ) : !open ? (
          <Callout tone="info" title="This invitation has closed">
            {invite.status === "CANCELLED" && club.status !== "APPROVED"
              ? "The founders cancelled it. Nothing else is needed from you."
              : club.status === "APPROVED"
                ? (
                  <>
                    {club.name} is an approved club now.{" "}
                    <Link href={`/clubs/${club.slug}`} className="font-medium underline">
                      Join it from its page
                    </Link>
                    .
                  </>
                )
                : "The club isn't being founded anymore. Nothing else is needed from you."}
          </Callout>
        ) : !emailMatches ? (
          <Callout tone="warning" title="This invitation is for someone else">
            It was sent to <span className="font-medium">{mask(invite.email)}</span>, but you&apos;re signed in as {user.email}. Sign in with the invited @{INSTITUTION.studentEmailDomain} account to answer it.
            <div className="mt-3">
              <ButtonLink href={`/login?switch=1&next=${encodeURIComponent(`/cofounder/${token}`)}`} size="sm" variant="outline">
                Switch accounts
              </ButtonLink>
            </div>
          </Callout>
        ) : !canAnswer ? (
          <Callout tone="warning" title="Only current students can co-found a club">
            {user.status === "ALUMNI" ? "Alumni accounts can't join new clubs." : `Sign in with your @${INSTITUTION.studentEmailDomain} account to accept.`}
          </Callout>
        ) : null}

        <Card>
          <CardHeader title="What co-founding means" description={`Starting a club together on ${PLATFORM.name}.`} />
          <CardBody>
            <ul className="grid gap-4 sm:grid-cols-2">
              {steps.map((s) => (
                <li key={s.title} className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand">
                    <s.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="text-sm">
                    <span className="block font-medium text-ink">{s.title}</span>
                    <span className="block text-ink-3">{s.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {canAnswer ? (
          <div className="space-y-2">
            <CofounderInviteResponse token={token} clubName={club.name} />
            <p className="text-xs text-ink-3">If plans change, you can leave the club later from its page.</p>
          </div>
        ) : null}
      </div>
    </Container>
  );
}
