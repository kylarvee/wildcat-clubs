import Link from "next/link";
import { Vote } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { loadVisibleClub } from "@/lib/clubs/context";
import { canSeeElections, syncClubElections } from "@/lib/domain/elections";
import { clubElections } from "@/lib/roles/election-queries";
import { readSelectionRules } from "@/lib/roles/pipeline";
import { SUCCESSION_HOW, SUCCESSION_NAME } from "@/lib/roles/labels";
import { ElectionStatusBadge, fmtWhen } from "@/components/elections/ElectionBits";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container, EmptyState, PageHeader, Section } from "@/components/ui/layout";

export const metadata = { title: "Elections" };

type Row = Awaited<ReturnType<typeof clubElections>>[number];

function when(e: Row, wentToRunoff: Set<string>) {
  if (e.status === "APPLIED") return e.appliedAt ? `filled ${fmtWhen(e.appliedAt)}` : "filled";
  if (e.status === "CANCELLED") return wentToRunoff.has(e.id) ? "tied, went to a runoff" : "called off";
  if (e.method === "ADVISOR_PRESIDENT") return `decide by ${fmtWhen(e.votingClosesAt)}`;
  if (e.method === "NEXT_IN_LINE") return e.status === "VOTING" ? `answers due ${fmtWhen(e.votingClosesAt)}` : `answers closed ${fmtWhen(e.votingClosesAt)}`;
  if (e.status === "NOMINATING") return `voting opens ${fmtWhen(e.votingOpensAt)}`;
  if (e.status === "VOTING") return `closes ${fmtWhen(e.votingClosesAt)}`;
  return `closed ${fmtWhen(e.votingClosesAt)}`;
}

/** A club's leadership selections, for its members: what's open now and what's been decided. */
export default async function ClubElectionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireUser(`/clubs/${slug}/elections`);
  const { club, access } = await loadVisibleClub(slug);
  const crumbs = [{ href: "/clubs", label: "Clubs" }, { href: `/clubs/${club.slug}`, label: club.name }, { label: "Elections" }];

  if (!canSeeElections(access)) {
    return (
      <Container size="md">
        <PageHeader breadcrumbs={crumbs} title="Elections" />
        <EmptyState
          icon={<Vote />}
          title={`Elections are for members of ${club.name}`}
          description="Join the club to run for a seat or vote when an election opens."
          action={<ButtonLink href={`/clubs/${club.slug}`}>Go to the club page</ButtonLink>}
        />
      </Container>
    );
  }

  await syncClubElections(club.id);
  const all = await clubElections(club.id);
  const open = all.filter((e) => e.status === "NOMINATING" || e.status === "VOTING" || e.status === "CLOSED");
  const past = all.filter((e) => e.status === "APPLIED" || e.status === "CANCELLED");
  const wentToRunoff = new Set(all.map((e) => readSelectionRules(e.rules).runoffOf).filter((x): x is string => Boolean(x)));

  return (
    <Container size="md">
      <PageHeader
        breadcrumbs={crumbs}
        title="Elections"
        description={`How ${club.name} fills its leadership seats. Its primary method is ${SUCCESSION_NAME[club.successionMethod]}: ${SUCCESSION_HOW[club.successionMethod]}. Its President and advisor may use another method for a particular seat.`}
        actions={access?.capabilities.has("elections") ? <ButtonLink href={`/clubs/${club.slug}/manage/elections`} variant="outline">Manage elections</ButtonLink> : null}
      />
      {all.length === 0 ? (
        <EmptyState icon={<Vote />} title="Nothing yet" description="When leaders start filling a seat, it shows up here, and you'll get a notification if you can run or vote." />
      ) : (
        <div className="space-y-8">
          {open.length ? (
            <Section title="In progress">
              <ElectionList slug={club.slug} items={open} wentToRunoff={wentToRunoff} />
            </Section>
          ) : null}
          {past.length ? (
            <Section title="Past">
              <ElectionList slug={club.slug} items={past} wentToRunoff={wentToRunoff} />
            </Section>
          ) : null}
        </div>
      )}
    </Container>
  );
}

function ElectionList({ slug, items, wentToRunoff }: { slug: string; items: Row[]; wentToRunoff: Set<string> }) {
  return (
    <Card>
      <ul className="divide-y divide-line">
        {items.map((e) => (
          <li key={e.id}>
            <Link href={`/clubs/${slug}/elections/${e.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-brand">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">{e.title}</span>
                <span className="block text-sm text-ink-3">
                  {e.position.name} · {SUCCESSION_NAME[e.method]} · {e._count.candidates} {e.method === "NEXT_IN_LINE" ? "in line" : `candidate${e._count.candidates === 1 ? "" : "s"}`} · {when(e, wentToRunoff)}
                </span>
              </span>
              <ElectionStatusBadge status={e.status} method={e.method} proposedCandidateId={e.proposedCandidateId} wentToRunoff={wentToRunoff.has(e.id)} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
