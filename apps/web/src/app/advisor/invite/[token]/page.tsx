import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck, Compass, KeyRound, Landmark, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { fmtLongDate } from "@/lib/time";
import { loadInviteForViewer } from "@/lib/domain/advisors";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, Container } from "@/components/ui/layout";
import { InviteResponse } from "@/components/founding/InviteResponse";
import { TYPE_LABEL } from "@/components/founding/copy";

export const metadata: Metadata = { title: "Advisor invitation" };

const DUTIES = [
  { icon: Compass, title: "Guide student leaders", body: "Meet with the club's leaders a few times a semester and help them think through plans." },
  { icon: Landmark, title: "Keep the club on solid ground", body: `Help them follow ${INSTITUTION.shortName} policy, and be a contact for ${INSTITUTION.studentGovernment}.` },
  { icon: Wallet, title: "Review budgets and funding", body: "Look over the club's budget and funding requests before they go to the university." },
  { icon: CalendarCheck, title: "Show up when it counts", body: "Attend major events when you can. You don't need to be at every meeting." },
  { icon: KeyRound, title: "Full access and a say in leadership", body: `You can see and use all of the club's tools in ${PLATFORM.name}. By default, you and the President choose the club's leaders together. You don't vote when members elect them.` },
];

function mask(email: string) {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

export default async function AdvisorInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireUser(`/advisor/invite/${token}`);
  const view = await loadInviteForViewer(user, token);
  if (!view) notFound();
  const { invite, emailMatches, canAnswer } = view;
  const club = invite.club;
  const closed = club.status === "RETIRED" || club.status === "REJECTED";
  const where = [club.department?.name, club.college?.name].filter(Boolean).join(" · ");

  return (
    <Container size="md">
      <p className="mb-2 text-sm font-medium text-brand">Advisor invitation</p>
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Will you advise {club.name}?</h1>
      <p className="mt-2 text-ink-2">
        {invite.invitedBy.name} invited {emailMatches ? "you" : invite.name} on {fmtLongDate(invite.createdAt)} to be this club&apos;s faculty/staff advisor.
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
              {where ? <p className="text-sm text-ink-3">{where}</p> : null}
              <p className="text-sm text-ink-2">{club.shortDescription || "The founders are still writing their description."}</p>
              <p className="text-xs text-ink-3">
                Invited by {invite.invitedBy.name} ·{" "}
                <a href={`mailto:${invite.invitedBy.email}`} className="text-brand-600 hover:underline">
                  {invite.invitedBy.email}
                </a>
              </p>
            </div>
          </CardBody>
        </Card>

        {invite.status === "ACCEPTED" ? (
          <Callout tone="success" title={emailMatches ? "You're this club's advisor" : "This invitation was accepted"}>
            {emailMatches ? (
              <Link href={`/clubs/${club.slug}/manage`} className="font-medium underline">
                Open the club workspace
              </Link>
            ) : null}
          </Callout>
        ) : invite.status === "DECLINED" ? (
          <Callout tone="info" title="This invitation was declined">
            {invite.respondedAt ? `Declined ${fmtLongDate(invite.respondedAt)}.` : null} If you change your mind, ask the club to send a new invitation.
          </Callout>
        ) : invite.status === "CANCELLED" || closed ? (
          <Callout tone="info" title="This invitation has closed">
            {closed ? "The club is no longer active." : "The club cancelled it."} Nothing else is needed from you.
          </Callout>
        ) : !emailMatches ? (
          <Callout tone="warning" title="This invitation is for someone else">
            It was sent to <span className="font-medium">{mask(invite.email)}</span>, but you&apos;re signed in as {user.email}. Sign in with the invited @{INSTITUTION.staffEmailDomain} account to answer it.
            <div className="mt-3">
              <ButtonLink href={`/login?switch=1&next=${encodeURIComponent(`/advisor/invite/${token}`)}`} size="sm" variant="outline">
                Switch accounts
              </ButtonLink>
            </div>
          </Callout>
        ) : !canAnswer ? (
          <Callout tone="warning" title="Only faculty and staff can advise clubs">
            Sign in with your @{INSTITUTION.staffEmailDomain} account to accept.
          </Callout>
        ) : null}

        <Card>
          <CardHeader title="What advising means" description="A light-touch role that makes a big difference for student leaders." />
          <CardBody>
            <ul className="grid gap-4 sm:grid-cols-2">
              {DUTIES.map((d) => (
                <li key={d.title} className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand">
                    <d.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="text-sm">
                    <span className="block font-medium text-ink">{d.title}</span>
                    <span className="block text-ink-3">{d.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {canAnswer && !closed ? (
          <div className="space-y-2">
            <InviteResponse token={token} clubName={club.name} />
            <p className="text-xs text-ink-3">You can step down later — just let the club&apos;s President or {INSTITUTION.studentGovernment} know.</p>
          </div>
        ) : null}
      </div>
    </Container>
  );
}
