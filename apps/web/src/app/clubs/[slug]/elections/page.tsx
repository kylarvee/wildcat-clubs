import Link from "next/link";
import { Vote } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { loadVisibleClub } from "@/lib/clubs/context";
import { canSeeElections, electionsAllowed, syncClubElections } from "@/lib/domain/elections";
import { clubElections } from "@/lib/roles/election-queries";
import { SUCCESSION_LABEL } from "@/lib/roles/labels";
import { ElectionStatusBadge, fmtWhen } from "@/components/elections/ElectionBits";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container, EmptyState, PageHeader, Section } from "@/components/ui/layout";

export const metadata = { title: "Elections" };

/** A club's elections, for its members: what's open now and what's been decided. */
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
  const open = all.filter((e) => e.status === "NOMINATING" || e.status === "VOTING");
  const past = all.filter((e) => e.status !== "NOMINATING" && e.status !== "VOTING");

  return (
    <Container size="md">
      <PageHeader
        breadcrumbs={crumbs}
        title="Elections"
        description={`How ${club.name} chooses its leaders: ${SUCCESSION_LABEL[club.successionMethod].toLowerCase()}.`}
        actions={access?.capabilities.has("elections") ? <ButtonLink href={`/clubs/${club.slug}/manage/elections`} variant="outline">Manage elections</ButtonLink> : null}
      />
      {all.length === 0 ? (
        <EmptyState
          icon={<Vote />}
          title="No elections yet"
          description={
            electionsAllowed(club.successionMethod)
              ? "When leaders open an election, you'll get a notification and it will show up here."
              : "This club uses seniority succession: the President names their successor in the org chart."
          }
        />
      ) : (
        <div className="space-y-8">
          {open.length ? (
            <Section title="Open now">
              <ElectionList slug={club.slug} items={open} />
            </Section>
          ) : null}
          {past.length ? (
            <Section title="Past elections">
              <ElectionList slug={club.slug} items={past} />
            </Section>
          ) : null}
        </div>
      )}
    </Container>
  );
}

function ElectionList({ slug, items }: { slug: string; items: Awaited<ReturnType<typeof clubElections>> }) {
  return (
    <Card>
      <ul className="divide-y divide-line">
        {items.map((e) => (
          <li key={e.id}>
            <Link href={`/clubs/${slug}/elections/${e.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-brand">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">{e.title}</span>
                <span className="block text-sm text-ink-3">
                  {e.position.name} · {e._count.candidates} candidate{e._count.candidates === 1 ? "" : "s"} ·{" "}
                  {e.status === "NOMINATING" ? `voting opens ${fmtWhen(e.votingOpensAt)}` : e.status === "VOTING" ? `closes ${fmtWhen(e.votingClosesAt)}` : `closed ${fmtWhen(e.votingClosesAt)}`}
                </span>
              </span>
              <ElectionStatusBadge status={e.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
