import Link from "next/link";
import { Hourglass, XCircle } from "lucide-react";
import type { Club } from "@prisma/client";
import type { ClubAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { officeForClub } from "@/lib/offices";
import { DAY_MS, fmtLongDate } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/layout";
import { ClubOfficeContacts } from "@/components/founding/ClubOfficeContacts";
import { FoundingTeam } from "@/components/founding/FoundingTeam";

const nextSteps = (office: string) => [
  { title: "A reviewer reads your submission", body: "Your profile, constitution and bylaws, and who your founders are." },
  { title: "They confirm your advisor", body: `${office} may reach out to your advisor to confirm they're on board.` },
  { title: "They decide", body: "Approve the club, ask for specific changes, or explain why it can't be approved. You'll get a notification and an email." },
  { title: "You get the keys", body: "Once approved, your club page goes public and Events, Attendance, Budget & funding and the rest unlock." },
];

/**
 * SUBMITTED: what the club's office (lib/offices: WSUSA, or the office its
 * scope and category sent it to) does next, how long its reviews take, and
 * who to contact. The founding team keeps growing while it waits.
 */
export async function InReview({ club, access }: { club: Club; access: ClubAccess }) {
  const office = await officeForClub(club.id);
  const days = office.reviewDays;
  const submitted = club.submittedAt ?? club.createdAt;
  const expected = new Date(submitted.getTime() + days * DAY_MS);
  const base = `/clubs/${club.slug}/manage`;
  return (
    <div className="space-y-5">
      <Callout tone="info" icon={<Hourglass />} title={`${club.name} is with ${office.name} for review`}>
        Submitted {fmtLongDate(submitted)}. {office.name} usually reviews new clubs within {days} days, so expect to hear back by about {fmtLongDate(expected)}.
      </Callout>
      <Card>
        <CardHeader title="What happens next" />
        <CardBody>
          <ol className="grid gap-4 sm:grid-cols-2">
            {nextSteps(office.name).map((s, i) => (
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
      <ClubOfficeContacts clubId={club.id} description="Questions about your review? Reach out anytime." />
      <FoundingTeam club={club} access={access} />
      <Card>
        <CardHeader title="While you wait" />
        <CardBody className="text-sm text-ink-2">
          You can keep improving your{" "}
          <Link href={`${base}/profile`} className="font-medium text-brand-600 hover:underline">
            profile
          </Link>
          , plan your{" "}
          <Link href={`${base}/org-chart`} className="font-medium text-brand-600 hover:underline">
            org chart
          </Link>
          , and organize your{" "}
          <Link href={`${base}/files`} className="font-medium text-brand-600 hover:underline">
            files
          </Link>
          . Reviewers see your latest changes.
        </CardBody>
      </Card>
    </div>
  );
}

/** REJECTED: the reason and who to talk to (the club's office). */
export async function NotApproved({ club }: { club: Club }) {
  const [decision, office] = await Promise.all([
    db.clubDecision.findFirst({ where: { clubId: club.id, action: "REJECTED" }, orderBy: { at: "desc" }, include: { by: { select: { name: true } } } }),
    officeForClub(club.id),
  ]);
  return (
    <div className="space-y-5">
      <Callout tone="danger" icon={<XCircle />} title={`${office.name} didn't approve ${club.name}`}>
        {decision?.note ? <p className="whitespace-pre-line">{decision.note}</p> : null}
        {decision ? (
          <p className="mt-2 text-xs opacity-80">
            {decision.by.name} · {fmtLongDate(decision.at)}
          </p>
        ) : null}
      </Callout>
      <p className="text-sm text-ink-2">
        The club&apos;s workspace is now read-only. If you have questions or want to talk about starting again, contact {office.name}. You can always{" "}
        <Link href="/clubs/new" className="font-medium text-brand-600 hover:underline">
          start a new club
        </Link>
        .
      </p>
      <ClubOfficeContacts clubId={club.id} title={`Talk to ${office.name}`} />
    </div>
  );
}
