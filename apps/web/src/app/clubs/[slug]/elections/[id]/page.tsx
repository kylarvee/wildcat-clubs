import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Info, Trophy, Vote } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { loadVisibleClub } from "@/lib/clubs/context";
import { candidateEligibility, canSeeElections, electionResults, hasVoted, nextInLineOutcome, syncElection, voterEligibility } from "@/lib/domain/elections";
import { candidateSource, electionCandidates, resultRows } from "@/lib/roles/election-queries";
import { canSelfNominate, usesBallots } from "@/lib/roles/pipeline";
import { SUCCESSION_NAME, SUCCESSION_STEPS } from "@/lib/roles/labels";
import { ElectionResultsView, ElectionStatusBadge, ElectionTimeline, fmtWhen } from "@/components/elections/ElectionBits";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, Container, EmptyState, PageHeader, Section } from "@/components/ui/layout";
import { BallotForm, CandidacyControls, MoveUpPrompt, RunForm, VotedNotice } from "../_components/MemberElectionForms";

export const metadata = { title: "Election" };

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
        <EmptyState icon={<Vote />} title={`This is for members of ${club.name}`} action={<ButtonLink href={`/clubs/${club.slug}`}>Go to the club page</ButtonLink>} />
      </Container>
    );
  }

  const candidates = await electionCandidates(e.id);
  const mine = candidates.find((c) => c.userId === viewer.id) ?? null;
  const [runElig, voteElig, voted, results, outcome] = await Promise.all([
    e.status === "NOMINATING" && !mine && canSelfNominate(e.method) ? candidateEligibility(viewer.id, e.clubId) : Promise.resolve(null),
    e.status === "VOTING" && usesBallots(e.method) ? voterEligibility(viewer.id, e) : Promise.resolve(null),
    e.status === "VOTING" && usesBallots(e.method) ? hasVoted(e.id, viewer.id) : Promise.resolve(false),
    electionResults(e.id),
    e.method === "NEXT_IN_LINE" ? nextInLineOutcome(e.id) : Promise.resolve(null),
  ]);
  const winner = e.winnerId ? candidates.find((c) => c.userId === e.winnerId) : null;
  const firstYes = outcome?.firstYesId ? candidates.find((c) => c.id === outcome.firstYesId) : null;
  const myPlace = mine ? candidates.indexOf(mine) : -1;
  const aheadSaidYes = myPlace > 0 && candidates.slice(0, myPlace).some((c) => c.acceptedAt);
  // Who's been proposed is for the club's leaders and the person proposed; members see that a choice is being made.
  const proposed = e.proposedCandidateId ? candidates.find((c) => c.id === e.proposedCandidateId) : null;
  const seesProposal = Boolean(proposed && (access?.isLeader || proposed.userId === viewer.id));

  return (
    <Container size="md">
      <PageHeader
        breadcrumbs={crumbs}
        title={e.title}
        description={
          <>
            Fills the <strong>{e.position.name}</strong> seat · <strong>{SUCCESSION_NAME[e.method]}</strong>
            {e.method === club.successionMethod ? " (the club's primary method)" : ""}. {SUCCESSION_STEPS[e.method]}
          </>
        }
        actions={
          <>
            <ElectionStatusBadge status={e.status} method={e.method} proposedCandidateId={e.proposedCandidateId} />
            {access?.capabilities.has("elections") ? (
              <ButtonLink href={`/clubs/${club.slug}/manage/elections/${e.id}`} variant="outline" size="sm">
                Manage
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <div className="space-y-6">
        <ElectionTimeline status={e.status} method={e.method} createdAt={e.createdAt} votingOpensAt={e.votingOpensAt} votingClosesAt={e.votingClosesAt} appliedAt={e.appliedAt} proposedAt={e.proposedAt} />

        {e.status === "CANCELLED" ? (
          <Callout tone="info" icon={<Ban />} title="This was called off">
            Nobody took the seat from it. Club leaders may start again for {e.position.name}.
          </Callout>
        ) : null}

        {e.status === "APPLIED" && winner && !usesBallots(e.method) ? (
          <Callout tone="success" icon={<Trophy />} title={`${winner.name} is now ${e.position.name}`}>
            {e.method === "NEXT_IN_LINE" ? "They were the first in line who said yes." : "The President and the advisor chose them together."}
          </Callout>
        ) : null}

        {/* Member vote: run for the seat. */}
        {e.status === "NOMINATING" && e.method === "MEMBER_VOTE" ? (
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

        {/* Self-select and Advisor & President: candidates come from the org chart (and the organizers). */}
        {e.status === "NOMINATING" && (e.method === "SELF_SELECT" || e.method === "ADVISOR_PRESIDENT") ? (
          <Card>
            <CardHeader
              title={mine ? "You're a candidate" : e.method === "SELF_SELECT" ? "The leaders will choose" : "The President and the advisor are choosing"}
              description={
                e.method === "SELF_SELECT"
                  ? `The club's current leaders vote from ${fmtWhen(e.votingOpensAt)}. It counts only if it's unanimous.`
                  : `They aim to decide by ${fmtWhen(e.votingClosesAt)}.`
              }
            />
            <CardBody className="space-y-3">
              {e.proposedCandidateId ? (
                <p className="text-sm text-ink-2">
                  {seesProposal && proposed ? (proposed.userId === viewer.id ? "You've been proposed" : `${proposed.name} has been proposed`) : "Someone has been proposed"} and it&apos;s waiting to be confirmed.
                </p>
              ) : null}
              {mine ? (
                <CandidacyControls
                  slug={club.slug}
                  candidateId={mine.id}
                  statement={mine.statement}
                  selfNominated={false}
                  lockNote={e.method === "SELF_SELECT" ? "You can edit this until voting opens." : "You can edit this until the seat is filled."}
                />
              ) : (
                <p className="flex items-start gap-2 text-sm text-ink-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                  Candidates start with everyone on the org chart below {e.position.name}, and the organizers can add any active member. Interested? Talk to a club leader.
                </p>
              )}
            </CardBody>
          </Card>
        ) : null}

        {/* Next in line: the prompt for the people asked. */}
        {e.status === "VOTING" && e.method === "NEXT_IN_LINE" ? (
          <Card>
            <CardHeader title={mine ? `Move up to ${e.position.name}?` : "The people next in line are being asked"} description={`Answers are due ${fmtWhen(e.votingClosesAt)}.`} />
            <CardBody>
              {mine ? (
                <MoveUpPrompt slug={club.slug} candidateId={mine.id} seatName={e.position.name} accepted={Boolean(mine.acceptedAt)} dueText={fmtWhen(e.votingClosesAt)} aheadSaidYes={aheadSaidYes} />
              ) : (
                <p className="text-sm text-ink-2">The first person in line who says yes moves up to {e.position.name}.</p>
              )}
            </CardBody>
          </Card>
        ) : null}

        {e.status === "CLOSED" && e.method === "NEXT_IN_LINE" ? (
          <Callout tone={firstYes ? "info" : "warning"} title="Answers are in">
            {firstYes
              ? `${firstYes.name} is the first in line who said yes. They move up once a club leader confirms it in the org chart.`
              : `Nobody next in line said yes, so the club's leaders will fill ${e.position.name} another way.`}
          </Callout>
        ) : null}

        {/* Ballots. */}
        {e.status === "VOTING" && usesBallots(e.method) ? (
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
                  selfBlocked={e.method === "SELF_SELECT"}
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
                ) : e.method === "SELF_SELECT" ? (
                  results.unanimousCandidateId ? (
                    "The leaders chose unanimously. It goes on the org chart once a club leader applies it."
                  ) : (
                    "No unanimous choice, so the leaders will choose again or fill the seat another way."
                  )
                ) : (
                  "Voting has closed. The result goes on the org chart once a club leader applies it."
                )
              }
            />
            <CardBody>
              {results.rows.length ? (
                <ElectionResultsView rows={resultRows(results, candidates, e.winnerId, e.method)} totalVotes={results.totalVotes} eligibleVoters={results.eligibleVoters} turnout={results.turnout} />
              ) : (
                <p className="text-sm text-ink-3">No one ran in this election.</p>
              )}
            </CardBody>
          </Card>
        ) : null}

        <Section
          title={e.method === "NEXT_IN_LINE" ? `Next in line (${candidates.length})` : `Candidates (${candidates.length})`}
          description={
            e.method === "NEXT_IN_LINE"
              ? "In order: the first who says yes moves up."
              : e.status === "NOMINATING"
                ? e.method === "MEMBER_VOTE"
                  ? "More people may join the ballot until voting opens."
                  : "Everyone on the org chart below the seat starts here, and anyone can withdraw."
                : undefined
          }
        >
          {candidates.length === 0 ? (
            <EmptyState title="No candidates yet" description={e.status === "NOMINATING" && e.method === "MEMBER_VOTE" ? "Be the first to run." : undefined} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {candidates.map((c, i) => (
                <li key={c.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
                  <div className="flex items-center gap-3">
                    {e.method === "NEXT_IN_LINE" ? <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-3">{i + 1}.</span> : null}
                    <Avatar name={c.name} src={c.avatarUrl} color={c.avatarColor} />
                    <div className="min-w-0">
                      <Link href={`/u/${c.handle}`} className="block truncate font-medium text-ink hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-ink-3">{candidateSource(c)}</p>
                    </div>
                    {e.method === "NEXT_IN_LINE" ? <Badge tone={c.acceptedAt ? "success" : "neutral"} className="ml-auto shrink-0">{c.acceptedAt ? "Said yes" : e.status === "VOTING" ? "Hasn't answered" : "Didn't answer"}</Badge> : null}
                  </div>
                  {c.statement ? <p className="mt-3 whitespace-pre-line text-sm text-ink-2">{c.statement}</p> : usesBallots(e.method) ? <p className="mt-3 text-sm italic text-ink-3">No statement yet.</p> : null}
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
