import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ExternalLink, Info } from "lucide-react";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/authz";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { currentLeaderIds, electionResults, eligibleVoterIds, syncElection } from "@/lib/domain/elections";
import { electionCandidates, resultRows } from "@/lib/roles/election-queries";
import { activeStudentMembers } from "@/lib/roles/queries";
import { ElectionResultsView, ElectionStatusBadge, ElectionTimeline } from "@/components/elections/ElectionBits";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState, PageHeader, ProgressBar } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { ApplyResultPanel, CancelElectionButton, CloseVotingButton, NominateDialog, OpenVotingButton, RemoveCandidateButton } from "../_components/ElectionControls";

export const metadata = { title: "Manage election" };

export default async function ManageElectionPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { club, access, allowed } = await loadClubWorkspace(slug, "elections");
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Election" />
        <NoPermission what="elections" suspended={access.suspended} />
      </div>
    );
  }
  const e = await syncElection(id);
  if (!e || e.clubId !== club.id) notFound();

  const candidates = await electionCandidates(e.id);
  const [voters, results, members, leaders, holders] = await Promise.all([
    eligibleVoterIds(e.clubId, e.method),
    electionResults(e.id),
    e.status === "NOMINATING" ? activeStudentMembers(club.id) : Promise.resolve([]),
    e.status === "NOMINATING" && e.method === "LEADERSHIP_VOTE" ? currentLeaderIds(club.id) : Promise.resolve(null),
    db.roleAssignment.findMany({ where: { positionId: e.position.id, endedAt: null }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  const onBallot = new Set(candidates.map((c) => c.userId));
  const leaderSet = leaders ? new Set(leaders) : null;
  const nominees = members
    .filter((m) => !leaderSet || leaderSet.has(m.id))
    .map((m) => (onBallot.has(m.id) ? { ...m, disabledReason: "Already on the ballot" } : m));
  const canApply = access.assignableRoles.includes(e.position.role);
  const live = e.status === "NOMINATING" || e.status === "VOTING" || e.status === "CLOSED";

  const rows = results ? resultRows(results, candidates, e.winnerId) : [];
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const leadersRows = results ? results.leaders.map((cid) => ({ id: cid, name: byId.get(cid)?.name ?? "Candidate", avatarUrl: byId.get(cid)?.avatarUrl ?? null, avatarColor: byId.get(cid)?.avatarColor ?? "#77707f", votes: results.rows.find((r) => r.candidateId === cid)?.votes ?? 0 })) : [];
  const clearWinner = leadersRows.length === 1 ? leadersRows[0] : null;
  const winnerUserId = clearWinner ? byId.get(clearWinner.id)?.userId : null;
  const replacing = holders.filter((h) => h.user.id !== winnerUserId).map((h) => h.user.name);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ href: `/clubs/${club.slug}/manage/elections`, label: "Elections" }, { label: e.title }]}
        title={e.title}
        description={`Fills ${e.position.name} (${ROLE_LABEL[e.position.role]}) · ${e.method === "MEMBER_VOTE" ? "member vote" : "leadership vote"}`}
        actions={
          <>
            <ElectionStatusBadge status={e.status} />
            <ButtonLink href={`/clubs/${club.slug}/elections/${e.id}`} variant="outline" size="sm">
              Member view <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </ButtonLink>
          </>
        }
      />

      <ElectionTimeline status={e.status} createdAt={e.createdAt} votingOpensAt={e.votingOpensAt} votingClosesAt={e.votingClosesAt} appliedAt={e.appliedAt} />

      {e.status === "NOMINATING" ? (
        <Card>
          <CardHeader title="Nominations are open" description="Voting opens automatically at the scheduled time, or now if you're ready." />
          <CardBody className="flex flex-wrap items-center gap-3">
            <OpenVotingButton slug={club.slug} electionId={e.id} disabled={candidates.length === 0} />
            {candidates.length === 0 ? <span className="text-sm text-ink-3">Add at least one candidate first.</span> : null}
            <div className="ml-auto">
              <CancelElectionButton slug={club.slug} electionId={e.id} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {e.status === "VOTING" ? (
        <Card>
          <CardHeader title="Voting is open" description="Counts stay hidden until voting closes, so no one is swayed by early results." />
          <CardBody className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm text-ink-2">
                <strong className="tabular-nums text-ink">{e._count.votes}</strong> of {voters.length} eligible voter{voters.length === 1 ? "" : "s"} have voted
              </p>
              <ProgressBar value={e._count.votes} max={Math.max(1, voters.length)} />
            </div>
            {candidates.length === 0 ? <Callout tone="warning">No one is on the ballot. Cancel this election and start a new one with candidates.</Callout> : null}
            <div className="flex flex-wrap items-center gap-3">
              <CloseVotingButton slug={club.slug} electionId={e.id} />
              <div className="ml-auto">
                <CancelElectionButton slug={club.slug} electionId={e.id} />
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {results && (e.status === "CLOSED" || e.status === "APPLIED") ? (
        <Card>
          <CardHeader title="Results" />
          <CardBody className="space-y-6">
            {rows.length ? (
              <ElectionResultsView rows={rows} totalVotes={results.totalVotes} eligibleVoters={results.eligibleVoters} turnout={results.turnout} />
            ) : (
              <p className="text-sm text-ink-3">No one ran in this election.</p>
            )}
            {e.status === "CLOSED" ? (
              rows.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <p className="text-sm text-ink-2">There&apos;s nothing to apply.</p>
                  <CancelElectionButton slug={club.slug} electionId={e.id} />
                </div>
              ) : canApply ? (
                <div className="border-t border-line pt-4">
                  <ApplyResultPanel slug={club.slug} electionId={e.id} seatName={e.position.name} winner={clearWinner} tied={clearWinner ? [] : leadersRows} replacing={replacing} />
                </div>
              ) : (
                <Callout tone="info" icon={<Info />}>
                  Only someone who can assign the {ROLE_LABEL[e.position.role]} role — {e.position.role === "PRESIDENT" || e.position.role === "VP" ? "the President, the advisor or a WSUSA administrator" : "the President, a Vice President, the advisor or an administrator"} — can apply this result.
                </Callout>
              )
            ) : (
              <Callout tone="success" icon={<CheckCircle2 />} title="Result applied">
                The winner holds {e.position.name} now.{" "}
                <Link href={`/clubs/${club.slug}/manage/org-chart`} className="underline">
                  See the org chart
                </Link>
              </Callout>
            )}
          </CardBody>
        </Card>
      ) : null}

      {e.status === "CANCELLED" ? <Callout tone="info">This election was cancelled. No result was applied.</Callout> : null}

      <Card>
        <CardHeader
          title={`Candidates (${candidates.length})`}
          description={e.method === "LEADERSHIP_VOTE" ? "Candidates must be current club leaders." : "Candidates must be active student members."}
          action={e.status === "NOMINATING" ? <NominateDialog slug={club.slug} electionId={e.id} people={nominees} /> : null}
        />
        {candidates.length === 0 ? (
          <CardBody>
            <EmptyState className="border-0 py-8" title="No candidates yet" description="Members can run from the election page, or you can nominate someone." />
          </CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-5 py-4">
                <Avatar name={c.name} src={c.avatarUrl} color={c.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link href={`/u/${c.handle}`} className="text-sm font-medium text-ink hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-xs text-ink-3">{c.nominatedBy.id === c.userId ? "Self-nominated" : `Nominated by ${c.nominatedBy.name}`}</p>
                  {c.statement ? <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-sm text-ink-2">{c.statement}</p> : <p className="mt-1.5 text-sm italic text-ink-3">No statement yet.</p>}
                </div>
                {e.status === "NOMINATING" ? <RemoveCandidateButton slug={club.slug} candidateId={c.id} name={c.name} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {live && holders.length ? (
        <p className="text-sm text-ink-3">
          {e.position.name} is held by {holders.map((h) => h.user.name).join(" and ")} today. Applying the result replaces them unless they win.
        </p>
      ) : null}
    </div>
  );
}
