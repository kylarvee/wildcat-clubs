import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Info, Trophy, Vote } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { loadVisibleClub } from "@/lib/clubs/context";
import { candidateEligibility, canSeeElections, electionResults, hasVoted, syncElection, voterEligibility } from "@/lib/domain/elections";
import { electionCandidates, resultRows } from "@/lib/roles/election-queries";
import { ElectionResultsView, ElectionStatusBadge, ElectionTimeline, fmtWhen } from "@/components/elections/ElectionBits";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, Container, EmptyState, PageHeader, Section } from "@/components/ui/layout";
import { BallotForm, CandidacyControls, RunForm, VotedNotice } from "../_components/MemberElectionForms";

export const metadata = { title: "Election" };

const METHOD_NOTE = {
  MEMBER_VOTE: "Member vote: the club's active members elect this seat.",
  LEADERSHIP_VOTE: "Leadership vote: current club leaders elect this seat, and no one can vote for themselves.",
  SENIORITY: "",
} as const;

export default async function ElectionPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const viewer = await requireUser(`/clubs/${slug}/elections/${id}`);
  const { club, access } = await loadVisibleClub(slug);
  const e = await syncElection(id);
  if (!e || e.clubId !== club.id) notFound();
  const crumbs = [{ href: `/clubs/${club.slug}`, label: club.name }, { href: `/clubs/${club.slug}/elections`, label: "Elections" }, { label: e.title }];

  if (!canSeeElections(access)) {
    return (
      <Container size="md">
        <PageHeader breadcrumbs={crumbs} title={e.title} />
        <EmptyState icon={<Vote />} title={`This election is for members of ${club.name}`} action={<ButtonLink href={`/clubs/${club.slug}`}>Go to the club page</ButtonLink>} />
      </Container>
    );
  }

  const candidates = await electionCandidates(e.id);
  const mine = candidates.find((c) => c.userId === viewer.id) ?? null;
  const [runElig, voteElig, voted, results] = await Promise.all([
    e.status === "NOMINATING" && !mine ? candidateEligibility(viewer.id, e.clubId, e.method) : Promise.resolve(null),
    e.status === "VOTING" ? voterEligibility(viewer.id, e) : Promise.resolve(null),
    e.status === "VOTING" ? hasVoted(e.id, viewer.id) : Promise.resolve(false),
    electionResults(e.id),
  ]);
  const winner = e.winnerId ? candidates.find((c) => c.userId === e.winnerId) : null;

  return (
    <Container size="md">
      <PageHeader
        breadcrumbs={crumbs}
        title={e.title}
        description={
          <>
            Fills the <strong>{e.position.name}</strong> seat. {METHOD_NOTE[e.method]}
          </>
        }
        actions={
          <>
            <ElectionStatusBadge status={e.status} />
            {access?.capabilities.has("elections") ? (
              <ButtonLink href={`/clubs/${club.slug}/manage/elections/${e.id}`} variant="outline" size="sm">
                Manage
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <div className="space-y-6">
        <ElectionTimeline status={e.status} createdAt={e.createdAt} votingOpensAt={e.votingOpensAt} votingClosesAt={e.votingClosesAt} appliedAt={e.appliedAt} />

        {e.status === "CANCELLED" ? (
          <Callout tone="info" icon={<Ban />} title="This election was cancelled">
            No result was applied. Club leaders may start a new election for {e.position.name}.
          </Callout>
        ) : null}

        {e.status === "NOMINATING" ? (
          <Card>
            <CardHeader title={mine ? "You're on the ballot" : `Run for ${e.position.name}`} description={`Nominations close when voting opens, ${fmtWhen(e.votingOpensAt)}.`} />
            <CardBody>
              {mine ? (
                <CandidacyControls slug={club.slug} candidateId={mine.id} statement={mine.statement} />
              ) : runElig?.eligible ? (
                <RunForm slug={club.slug} electionId={e.id} seatName={e.position.name} />
              ) : (
                <p className="flex items-start gap-2 text-sm text-ink-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                  {runElig?.reason ?? "You can't run in this election."}
                </p>
              )}
            </CardBody>
          </Card>
        ) : null}

        {e.status === "VOTING" ? (
          <Card>
            <CardHeader title="Your ballot" description={`Voting closes ${fmtWhen(e.votingClosesAt)}. One vote each; ballots are secret.`} />
            <CardBody>
              {voted ? (
                <VotedNotice />
              ) : !voteElig?.eligible ? (
                <p className="flex items-start gap-2 text-sm text-ink-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                  {voteElig?.reason}
                </p>
              ) : candidates.length === 0 ? (
                <p className="text-sm text-ink-3">No one is on the ballot. The organizers will follow up.</p>
              ) : (
                <BallotForm
                  slug={club.slug}
                  electionId={e.id}
                  seatName={e.position.name}
                  selfBlocked={e.method === "LEADERSHIP_VOTE"}
                  candidates={candidates.map((c) => ({ id: c.id, name: c.name, avatarUrl: c.avatarUrl, avatarColor: c.avatarColor, self: c.userId === viewer.id }))}
                />
              )}
            </CardBody>
          </Card>
        ) : null}

        {results && (e.status === "CLOSED" || e.status === "APPLIED") ? (
          <Card>
            <CardHeader
              title="Results"
              description={
                e.status === "APPLIED" && winner ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Trophy className="h-4 w-4 text-success" aria-hidden /> {winner.name} is now {e.position.name}.
                  </span>
                ) : (
                  "Voting has closed. The result goes on the org chart once a club leader applies it."
                )
              }
            />
            <CardBody>
              {results.rows.length ? (
                <ElectionResultsView rows={resultRows(results, candidates, e.winnerId)} totalVotes={results.totalVotes} eligibleVoters={results.eligibleVoters} turnout={results.turnout} />
              ) : (
                <p className="text-sm text-ink-3">No one ran in this election.</p>
              )}
            </CardBody>
          </Card>
        ) : null}

        <Section title={`Candidates (${candidates.length})`} description={e.status === "NOMINATING" ? "More people may join the ballot until voting opens." : undefined}>
          {candidates.length === 0 ? (
            <EmptyState title="No candidates yet" description={e.status === "NOMINATING" ? "Be the first to run." : undefined} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {candidates.map((c) => (
                <li key={c.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
                  <div className="flex items-center gap-3">
                    <Avatar name={c.name} src={c.avatarUrl} color={c.avatarColor} />
                    <div className="min-w-0">
                      <Link href={`/u/${c.handle}`} className="block truncate font-medium text-ink hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-ink-3">{c.nominatedBy.id === c.userId ? "Self-nominated" : `Nominated by ${c.nominatedBy.name}`}</p>
                    </div>
                  </div>
                  {c.statement ? <p className="mt-3 whitespace-pre-line text-sm text-ink-2">{c.statement}</p> : <p className="mt-3 text-sm italic text-ink-3">No statement yet.</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {e.position.responsibilities.length ? (
          <Section title={`What the ${e.position.name} does`}>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
              {e.position.responsibilities.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </Container>
  );
}
