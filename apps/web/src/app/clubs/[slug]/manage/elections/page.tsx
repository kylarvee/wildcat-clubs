import Link from "next/link";
import { TZDate } from "@date-fns/tz";
import { ArrowRight, Vote } from "lucide-react";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/authz";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { ELECTABLE_ROLES, eligibleVoterIds, electionsAllowed, syncClubElections } from "@/lib/domain/elections";
import { clubElections } from "@/lib/roles/election-queries";
import { toCampusLocal } from "@/lib/roles/datetime";
import { SUCCESSION_LABEL } from "@/lib/roles/labels";
import { budgetTermFor, getTerms } from "@/lib/terms";
import { campusDate, DAY_MS, TZ } from "@/lib/time";
import { ElectionStatusBadge, fmtWhen } from "@/components/elections/ElectionBits";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout, EmptyState, PageHeader, Section } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { CreateElectionDialog, type ElectableSeat } from "./_components/CreateElectionDialog";

export const metadata = { title: "Elections" };

/** A campus-time default: `days` from now at `hour`:00. */
function campusDefault(days: number, hour: number, from = Date.now()) {
  const d = new TZDate(from + days * DAY_MS, TZ);
  return campusDate(d.getFullYear(), d.getMonth() + 1, d.getDate(), hour, 0);
}

export default async function ManageElectionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club, access, allowed } = await loadClubWorkspace(slug, "elections");
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Elections" />
        <NoPermission what="elections" suspended={access.suspended} />
      </div>
    );
  }

  if (!electionsAllowed(club.successionMethod)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Elections" description={`Succession in ${club.name}: ${SUCCESSION_LABEL[club.successionMethod]}.`} />
        <EmptyState
          icon={<Vote />}
          title="Your bylaws use seniority succession"
          description="The President names their successor in the org chart — no election needed. To elect leaders instead, switch your constitution's succession bylaw to a member vote or a leadership vote."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href={`/clubs/${club.slug}/manage/org-chart`}>Go to the org chart</ButtonLink>
              <ButtonLink href={`/clubs/${club.slug}/manage/constitution`} variant="outline">
                Constitution & bylaws
              </ButtonLink>
            </div>
          }
        />
      </div>
    );
  }

  await syncClubElections(club.id);
  const [elections, positions, voters, terms] = await Promise.all([
    clubElections(club.id),
    db.position.findMany({ where: { clubId: club.id, archivedAt: null, role: { in: ELECTABLE_ROLES } }, orderBy: [{ sortOrder: "asc" }] }),
    eligibleVoterIds(club.id, club.successionMethod),
    getTerms(),
  ]);
  const running = elections.filter((e) => e.status === "NOMINATING" || e.status === "VOTING" || e.status === "CLOSED");
  const past = elections.filter((e) => e.status === "APPLIED" || e.status === "CANCELLED");
  const busy = new Set(running.map((e) => e.positionId));
  const order: Record<string, number> = { PRESIDENT: 0, VP: 1, OFFICER: 2, AMBASSADOR: 3 };
  const seats: ElectableSeat[] = positions
    .sort((a, b) => order[a.role] - order[b.role] || a.sortOrder - b.sortOrder)
    .map((p) => ({ id: p.id, name: p.name, roleLabel: ROLE_LABEL[p.role], busy: busy.has(p.id) }));
  const opens = campusDefault(3, 9);
  const closes = campusDefault(2, 17, opens.getTime());
  const term = budgetTermFor(terms, opens);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Elections"
        description={`${SUCCESSION_LABEL[club.successionMethod]}. ${voters.length} ${voters.length === 1 ? "person" : "people"} can vote right now.`}
        actions={
          seats.length ? (
            <CreateElectionDialog slug={club.slug} clubId={club.id} seats={seats} defaultOpens={toCampusLocal(opens)} defaultCloses={toCampusLocal(closes)} termLabel={term?.name ?? null} />
          ) : null
        }
      />

      {seats.length === 0 ? (
        <Callout tone="warning" title="No seats to elect">
          Set up your org chart first — elections fill its seats. <Link href={`/clubs/${club.slug}/manage/org-chart`} className="underline">Open the org chart</Link>
        </Callout>
      ) : null}

      <Callout tone="info">
        {club.successionMethod === "MEMBER_VOTE"
          ? "Active members (attended in the last month or at one of the last two events) vote. If no one has checked in yet, every member can vote."
          : "Current club leaders vote, and no one can vote for themselves. Candidates must be current leaders too."}{" "}
        Ballots are secret: you&apos;ll see counts, never who voted for whom.
      </Callout>

      {elections.length === 0 ? (
        <EmptyState icon={<Vote />} title="No elections yet" description="Start one for any seat. Members who can run get a heads-up, and voters are notified when voting opens." />
      ) : null}

      {running.length ? (
        <Section title="In progress">
          <div className="grid gap-4 md:grid-cols-2">
            {running.map((e) => (
              <Link
                key={e.id}
                href={`/clubs/${club.slug}/manage/elections/${e.id}`}
                className="group flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] hover:border-brand-200 focus-visible:outline-2 focus-visible:outline-brand"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{e.title}</p>
                    <p className="text-sm text-ink-3">{e.position.name}</p>
                  </div>
                  <ElectionStatusBadge status={e.status} />
                </div>
                <p className="text-sm text-ink-2">
                  {e.status === "NOMINATING"
                    ? `Voting opens ${fmtWhen(e.votingOpensAt)}`
                    : e.status === "VOTING"
                      ? `Voting closes ${fmtWhen(e.votingClosesAt)}`
                      : "Voting closed — ready to apply"}
                </p>
                <div className="mt-auto flex items-center gap-2 text-xs text-ink-3">
                  <span>
                    {e._count.candidates} candidate{e._count.candidates === 1 ? "" : "s"}
                  </span>
                  {e.status !== "NOMINATING" ? (
                    <span>
                      · {e._count.votes} ballot{e._count.votes === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {e.status === "NOMINATING" && e._count.candidates === 0 ? <Badge tone="warning">No candidates yet</Badge> : null}
                  <ArrowRight className="ml-auto h-4 w-4 text-brand transition-transform group-hover:translate-x-0.5" aria-hidden />
                </div>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      {past.length ? (
        <Section title="Past elections">
          <Card>
            <ul className="divide-y divide-line">
              {past.map((e) => (
                <li key={e.id}>
                  <Link href={`/clubs/${club.slug}/manage/elections/${e.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-brand">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{e.title}</span>
                      <span className="block text-xs text-ink-3">
                        {e.position.name} · {e.status === "APPLIED" && e.appliedAt ? `applied ${fmtWhen(e.appliedAt)}` : `closed ${fmtWhen(e.votingClosesAt)}`}
                      </span>
                    </span>
                    <ElectionStatusBadge status={e.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      <PolicyNotices placement="OFFICER_ROLES" />
    </div>
  );
}
