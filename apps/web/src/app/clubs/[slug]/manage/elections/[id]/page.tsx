import Link from "next/link";
import { notFound } from "next/navigation";
import type { SuccessionMethod } from "@prisma/client";
import { CheckCircle2, ExternalLink, Info } from "lucide-react";
import { db } from "@/lib/db";
import { ALL_CAPABILITIES, CAPABILITIES, ROLE_LABEL } from "@/lib/authz";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { officeForClub } from "@/lib/offices";
import { electionResults, keyHolders, nextInLineOutcome, runoffFor, syncElection, voteOutcome, voterRoll } from "@/lib/domain/elections";
import { candidateSource, electionCandidates, resultRows } from "@/lib/roles/election-queries";
import { activeStudentMembers } from "@/lib/roles/queries";
import { selectionSetup } from "@/lib/roles/selection-setup";
import { confirmersFor, earliestVotingOpen, isKeyHolder, leadersBelow, organizersAddCandidates, readSelectionRules, usesBallots } from "@/lib/roles/pipeline";
import { SUCCESSION_NAME, SUCCESSION_STEPS } from "@/lib/roles/labels";
import { ElectionResultsView, ElectionStatusBadge, ElectionTimeline, fmtWhen, MethodBadge } from "@/components/elections/ElectionBits";
import { MemberVoteRules, VoterRollCard } from "@/components/elections/VoteRules";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState, PageHeader, ProgressBar } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { CreateElectionDialog } from "../_components/CreateElectionDialog";
import {
  ApplyResultPanel,
  CancelElectionButton,
  CloseVotingButton,
  ConfirmProposalPanel,
  NominateDialog,
  OpenVotingButton,
  ProposePanel,
  RemoveCandidateButton,
  RunoffButton,
  WithdrawProposalButton,
} from "../_components/ElectionControls";

export const metadata = { title: "Fill a seat" };

/** "Pat" / "Pat and Sam" / "Pat, Sam and Lee". */
function names(list: string[]) {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

export default async function ManageElectionPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { user, club, access, allowed } = await loadClubWorkspace(slug, "elections");
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Fill a seat" />
        <NoPermission what="elections" suspended={access.suspended} />
      </div>
    );
  }
  const e = await syncElection(id);
  if (!e || e.clubId !== club.id) notFound();

  const open = e.status === "NOMINATING" || (e.method === "NEXT_IN_LINE" && e.status === "VOTING");
  const [candidates, setup, holders] = await Promise.all([
    electionCandidates(e.id),
    selectionSetup(club.id),
    db.roleAssignment.findMany({ where: { positionId: e.position.id, endedAt: null }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  const [roll, results, outcome, keys, members] = await Promise.all([
    usesBallots(e.method) ? voterRoll(e) : Promise.resolve(null),
    electionResults(e.id),
    e.method === "NEXT_IN_LINE" ? nextInLineOutcome(e.id) : Promise.resolve(null),
    e.method === "ADVISOR_PRESIDENT" ? keyHolders(club.id) : Promise.resolve(null),
    e.status === "NOMINATING" && organizersAddCandidates(e.method) ? activeStudentMembers(club.id) : Promise.resolve([]),
  ]);
  const voters = roll?.eligibleIds ?? [];

  // ─── The bylaw rules a member vote froze: who votes and why, quorum, ties, notice ───
  const memberVote = e.method === "MEMBER_VOTE";
  const rules = readSelectionRules(e.rules);
  const [rollPeople, runoffParent, runoffChild, vote] = await Promise.all([
    roll?.basis === "attendance" ? db.user.findMany({ where: { id: { in: roll.rows.map((r) => r.userId) } }, select: { id: true, name: true, handle: true, avatarUrl: true, avatarColor: true } }) : Promise.resolve([]),
    rules.runoffOf ? db.election.findUnique({ where: { id: rules.runoffOf }, select: { id: true, title: true } }) : Promise.resolve(null),
    memberVote && e.status === "CANCELLED" ? runoffFor(e.id) : Promise.resolve(null),
    results && e.status === "CLOSED" ? voteOutcome(e, results, candidates) : Promise.resolve(null),
  ]);
  const personById = new Map(rollPeople.map((p) => [p.id, p]));
  const rollRows = (roll?.rows ?? []).flatMap((r) => {
    const p = personById.get(r.userId);
    return p ? [{ ...r, name: p.name, handle: p.handle, avatarUrl: p.avatarUrl, avatarColor: p.avatarColor }] : [];
  });
  const opensFrom = memberVote ? earliestVotingOpen(e.createdAt, rules.noticeDays) : null;
  const noticeUntil = opensFrom && opensFrom > new Date() ? opensFrom : null;
  // A tie the bylaws settle by choosing: only the people they name (or an administrator) choose.
  const tie = vote?.kind === "tie" ? vote : null;
  const choosers = tie?.resolution.kind === "choose" ? tie.resolution : null;
  const chooserNames = choosers?.userIds.length ? (await db.user.findMany({ where: { id: { in: choosers.userIds } }, select: { name: true } })).map((u) => u.name) : [];
  // When nobody in the club can settle it, the club's office does (lib/offices).
  const officeName = choosers?.by === "wsusa" ? (await officeForClub(club.id)).name : "WSUSA";
  const mayChoose = !tie || (choosers ? (choosers.by === "organizer" ? true : access.viaPlatform !== null || choosers.userIds.includes(user.id)) : false);
  const tieNote = !choosers
    ? undefined
    : choosers.by === "advisor"
      ? `${rules.runoffOf ? "The runoff tied too, so under" : "Under"} your bylaws the advisor casts the deciding vote: choose who takes the seat`
      : choosers.by === "president"
        ? "Under your bylaws the President casts the deciding vote: choose who takes the seat"
        : choosers.by === "wsusa"
          ? `Nobody in the club can settle it under its bylaws, so as ${officeName} staff, choose who takes the seat`
          : undefined;

  const canApply = access.assignableRoles.includes(e.position.role);
  const admin = access.viaPlatform !== null;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const onList = new Set(candidates.map((c) => c.userId));
  const nominees = members.map((m) => (onList.has(m.id) ? { ...m, disabledReason: "Already a candidate" } : m));
  // Where each candidate sits now, and the seat they'd leave by moving up.
  const below = leadersBelow(setup.pipeline.seats, e.position.id, setup.pipeline.clubType);
  const movingFrom = Object.fromEntries(candidates.flatMap((c) => {
    const p = below.find((x) => x.userId === c.userId);
    return p ? [[c.id, p.seatName] as const] : [];
  }));
  const seatOf = (userId: string) => below.find((p) => p.userId === userId)?.seatName ?? (holders.some((h) => h.user.id === userId) ? e.position.name : null);
  const replacingFor = (userId: string | null | undefined) => holders.filter((h) => h.user.id !== userId).map((h) => h.user.name);
  const sittingIds = candidates.filter((c) => holders.some((h) => h.user.id === c.userId)).map((c) => c.id);
  // Officer and ambassador seats get the same permissions step as assigning them in the org chart.
  const permSetup =
    e.position.role === "OFFICER" || e.position.role === "AMBASSADOR"
      ? { options: ALL_CAPABILITIES.map((k) => ({ key: k, label: CAPABILITIES[k].label, description: CAPABILITIES[k].description })), defaults: e.position.defaultPermissions }
      : null;
  const seatForRestart = setup.seats.filter((s) => s.id === e.position.id).map((s) => ({ ...s, busy: false }));
  const restart = (label: string, method: SuccessionMethod, variant: "primary" | "outline" = "outline") =>
    seatForRestart.length ? (
      <CreateElectionDialog
        slug={club.slug}
        clubId={club.id}
        seats={seatForRestart}
        primary={club.successionMethod}
        defaults={setup.defaults}
        termLabel={setup.termLabel}
        fixedSeatId={e.position.id}
        initialMethod={method}
        restartElectionId={e.id}
        triggerLabel={label}
        triggerVariant={variant}
      />
    ) : null;
  const otherMode: SuccessionMethod = club.successionMethod !== e.method ? club.successionMethod : e.method === "ADVISOR_PRESIDENT" ? "MEMBER_VOTE" : "ADVISOR_PRESIDENT";

  // ─── Advisor & President ───
  const people = new Map((await db.user.findMany({ where: { id: { in: [...(keys?.presidentIds ?? []), ...(keys?.advisorIds ?? []), e.proposedById ?? "", e.confirmedById ?? ""] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const proposed = e.proposedCandidateId ? (byId.get(e.proposedCandidateId) ?? null) : null;
  const confirmers = keys && proposed ? confirmersFor({ ...keys, proposerId: e.proposedById ?? "", candidateUserId: proposed.userId, seatRole: e.position.role }) : [];
  const mayPropose = Boolean(keys && canApply && (admin || isKeyHolder(user.id, keys)));
  const mayConfirm = Boolean(proposed && canApply && (admin || confirmers.includes(user.id)) && !(e.position.role === "PRESIDENT" && proposed.userId === user.id));
  const isProposer = Boolean(e.proposedById && e.proposedById === user.id);
  const wouldConfirm = keys ? confirmersFor({ ...keys, proposerId: user.id, candidateUserId: "", seatRole: e.position.role }) : [];
  const proposeNext = wouldConfirm.length === 0 ? "A WSUSA administrator confirms it next." : wouldConfirm.includes(user.id) && wouldConfirm.length === 1 ? `You confirm it yourself next: ${club.name} has ${keys?.advisorIds.length ? "no President" : "no advisor"} to do it.` : `${names(wouldConfirm.filter((x) => x !== user.id).map((x) => people.get(x) ?? "The other side"))} confirms it next.`;

  // ─── Ballots ───
  const rows = results ? resultRows(results, candidates, e.winnerId, e.method) : [];
  const leadersRows = results ? results.leaders.map((cid) => ({ id: cid, name: byId.get(cid)?.name ?? "Candidate", avatarUrl: byId.get(cid)?.avatarUrl ?? null, avatarColor: byId.get(cid)?.avatarColor ?? "#77707f", votes: results.rows.find((r) => r.candidateId === cid)?.votes ?? 0 })) : [];
  const unanimous = results?.unanimousCandidateId ? (leadersRows.find((r) => r.id === results.unanimousCandidateId) ?? { id: results.unanimousCandidateId, name: byId.get(results.unanimousCandidateId)?.name ?? "Candidate", avatarUrl: null, avatarColor: "#77707f", votes: 0 }) : null;
  const clearWinner = e.method === "SELF_SELECT" ? unanimous : leadersRows.length === 1 ? leadersRows[0] : null;
  const firstYes = outcome?.firstYesId ? (byId.get(outcome.firstYesId) ?? null) : null;
  const saidYes = candidates.filter((c) => c.acceptedAt).length;
  const winnerName = e.winnerId ? (candidates.find((c) => c.userId === e.winnerId)?.name ?? null) : null;
  const cannotApply = (
    <Callout tone="info" icon={<Info />}>
      Only someone who can assign the {ROLE_LABEL[e.position.role]} role — {e.position.role === "PRESIDENT" || e.position.role === "VP" ? "the President, the advisor or a WSUSA administrator" : "the President, a Vice President, the advisor or an administrator"} — can fill this seat.
    </Callout>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ href: `/clubs/${club.slug}/manage/elections`, label: "Elections" }, { label: e.title }]}
        title={e.title}
        description={
          <>
            Fills {e.position.name}
            {e.position.name !== ROLE_LABEL[e.position.role] ? ` (${ROLE_LABEL[e.position.role]})` : ""} · <strong>{SUCCESSION_NAME[e.method]}</strong>
            {e.method === club.successionMethod ? " (the club's primary method)" : " (chosen for this seat)"}. {SUCCESSION_STEPS[e.method]}
          </>
        }
        actions={
          <>
            <ElectionStatusBadge status={e.status} method={e.method} proposedCandidateId={e.proposedCandidateId} wentToRunoff={Boolean(runoffChild)} />
            <ButtonLink href={`/clubs/${club.slug}/elections/${e.id}`} variant="outline" size="sm">
              Member view <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </ButtonLink>
          </>
        }
      />

      <ElectionTimeline status={e.status} method={e.method} createdAt={e.createdAt} votingOpensAt={e.votingOpensAt} votingClosesAt={e.votingClosesAt} appliedAt={e.appliedAt} proposedAt={e.proposedAt} />

      {/* ─── Member vote: the bylaw rules it runs under, and who can vote ─── */}
      {memberVote && roll ? (
        <MemberVoteRules
          rules={rules}
          basis={roll.basis}
          eligible={results ? results.eligibleVoters : voters.length}
          members={roll.basis === "attendance" ? roll.rows.length : null}
          termName={roll.termName}
          final={roll.final}
          votingOpensAt={e.votingOpensAt}
          votes={e.status === "NOMINATING" ? null : e._count.votes}
          closed={e.status !== "NOMINATING" && e.status !== "VOTING"}
          opensFrom={opensFrom}
          runoffOf={runoffParent ? { href: `/clubs/${club.slug}/manage/elections/${runoffParent.id}`, title: runoffParent.title } : null}
        />
      ) : null}
      {memberVote && roll?.basis === "attendance" && roll.minEvents && e.status !== "CANCELLED" ? (
        <VoterRollCard people={rollRows} minEvents={roll.minEvents} final={roll.final} showCounts={access.capabilities.has("attendance")} />
      ) : null}

      {/* ─── Advisor & President ─── */}
      {e.method === "ADVISOR_PRESIDENT" && e.status === "NOMINATING" ? (
        <Card>
          <CardHeader
            title={proposed ? `${proposed.name} is proposed` : "Propose someone"}
            description={`The President and the advisor decide together: one proposes, the other confirms. Decide by ${fmtWhen(e.votingClosesAt)}${e.votingClosesAt < new Date() ? " (that date has passed, but you can still decide)" : ""}.`}
          />
          <CardBody className="space-y-4">
            {proposed ? (
              <>
                <div className="flex items-center gap-3 rounded-xl border border-line bg-muted/40 p-3">
                  <Avatar name={proposed.name} src={proposed.avatarUrl} color={proposed.avatarColor} />
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-ink">{proposed.name}</p>
                    <p className="text-ink-2">
                      Proposed by {people.get(e.proposedById ?? "") ?? "a club leader"}
                      {e.proposedAt ? ` ${fmtWhen(e.proposedAt)}` : ""}
                      {seatOf(proposed.userId) ? ` · now ${seatOf(proposed.userId)}` : ""}
                    </p>
                  </div>
                </div>
                {mayConfirm ? (
                  <ConfirmProposalPanel
                    slug={club.slug}
                    electionId={e.id}
                    seatName={e.position.name}
                    candidate={{ name: proposed.name }}
                    replacing={replacingFor(proposed.userId)}
                    movingFrom={movingFrom[proposed.id] ?? null}
                    setup={permSetup}
                    sitting={sittingIds.includes(proposed.id)}
                    canSendBack={!isProposer}
                  />
                ) : (
                  <p className="text-sm text-ink-2">
                    {confirmers.length ? `Waiting for ${names(confirmers.map((x) => people.get(x) ?? "the other side"))} to confirm.` : "Nobody in the club can confirm this one, so a WSUSA administrator will."}
                    {e.position.role === "PRESIDENT" && proposed.userId === user.id ? " You can't confirm your own appointment as President." : ""}
                  </p>
                )}
                {isProposer || (admin && !mayConfirm) ? <WithdrawProposalButton slug={club.slug} electionId={e.id} name={proposed.name} /> : null}
              </>
            ) : mayPropose ? (
              <ProposePanel
                slug={club.slug}
                electionId={e.id}
                seatName={e.position.name}
                candidates={candidates.map((c) => ({ id: c.id, name: c.name, avatarUrl: c.avatarUrl, avatarColor: c.avatarColor, detail: seatOf(c.userId) ?? candidateSource(c) }))}
                nextStep={proposeNext}
              />
            ) : (
              <p className="flex items-start gap-2 text-sm text-ink-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                {canApply ? "Waiting for the President or an advisor to propose someone." : `Waiting for the President or an advisor to propose someone. You can add candidates; they make the choice.`}
              </p>
            )}
            <div className="flex justify-end border-t border-line pt-3">
              <CancelElectionButton slug={club.slug} electionId={e.id} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ─── Next in line ─── */}
      {e.method === "NEXT_IN_LINE" && e.status === "VOTING" ? (
        <Card>
          <CardHeader title="Waiting for answers" description={`Answers are due ${fmtWhen(e.votingClosesAt)}. The first in line who says yes moves up.`} />
          <CardBody className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm text-ink-2">
                <strong className="tabular-nums text-ink">{saidYes}</strong> of {candidates.length} still in line said yes
              </p>
              <ProgressBar value={saidYes} max={Math.max(1, candidates.length)} />
            </div>
            {candidates.length === 0 ? <Callout tone="warning">Everyone who was asked said no. Start over with another way to fill the seat.</Callout> : null}
            <div className="flex flex-wrap items-center gap-3">
              <CloseVotingButton slug={club.slug} electionId={e.id} answers />
              {candidates.length === 0 ? restart("Use another way", otherMode, "primary") : null}
              <div className="ml-auto">
                <CancelElectionButton slug={club.slug} electionId={e.id} />
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {e.method === "NEXT_IN_LINE" && e.status === "CLOSED" ? (
        <Card>
          <CardHeader title="Answers are in" />
          <CardBody>
            {firstYes ? (
              canApply ? (
                <ApplyResultPanel
                  slug={club.slug}
                  electionId={e.id}
                  seatName={e.position.name}
                  winner={{ id: firstYes.id, name: firstYes.name, avatarUrl: firstYes.avatarUrl, avatarColor: firstYes.avatarColor, votes: 0 }}
                  tied={[]}
                  replacing={replacingFor(firstYes.userId)}
                  setup={permSetup}
                  sittingIds={sittingIds}
                  movingFrom={movingFrom}
                  kind="nextInLine"
                />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-ink">
                    <strong>{firstYes.name}</strong> is the first in line who said yes.
                  </p>
                  {cannotApply}
                </div>
              )
            ) : (
              <div className="space-y-3">
                <Callout tone="warning" title="Nobody said yes">
                  No one next in line wants to move up to {e.position.name} right now. Fill it another way: the people below it stay candidates.
                </Callout>
                <div className="flex flex-wrap items-center gap-2">
                  {restart("Use another way", otherMode, "primary")}
                  <CancelElectionButton slug={club.slug} electionId={e.id} />
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* ─── Ballots ─── */}
      {usesBallots(e.method) && e.status === "NOMINATING" ? (
        <Card>
          <CardHeader
            title={e.method === "MEMBER_VOTE" ? "Nominations are open" : "Gathering candidates"}
            description={noticeUntil ? `Voting opens automatically ${fmtWhen(e.votingOpensAt)}. Your bylaws give members ${rules.noticeDays} days' notice, so it can't open before ${fmtWhen(noticeUntil)}.` : `Voting opens automatically ${fmtWhen(e.votingOpensAt)}, or now if you're ready.`}
          />
          <CardBody className="flex flex-wrap items-center gap-3">
            <OpenVotingButton slug={club.slug} electionId={e.id} disabled={candidates.length === 0 || Boolean(noticeUntil)} />
            {candidates.length === 0 ? <span className="text-sm text-ink-3">Add at least one candidate first.</span> : noticeUntil ? <span className="text-sm text-ink-3">You can open it early from {fmtWhen(noticeUntil)}.</span> : null}
            <div className="ml-auto">
              <CancelElectionButton slug={club.slug} electionId={e.id} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {usesBallots(e.method) && e.status === "VOTING" ? (
        <Card>
          <CardHeader title="Voting is open" description={e.method === "SELF_SELECT" ? "Counts stay hidden until voting closes. It counts only if every leader votes for the same person." : "Counts stay hidden until voting closes, so no one is swayed by early results."} />
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

      {results && (e.status === "CLOSED" || e.status === "APPLIED" || e.status === "CANCELLED") ? (
        <Card>
          <CardHeader title="Results" />
          <CardBody className="space-y-6">
            {rows.length ? (
              <ElectionResultsView rows={rows} totalVotes={results.totalVotes} eligibleVoters={results.eligibleVoters} turnout={results.turnout} quorum={results.quorum} />
            ) : (
              <p className="text-sm text-ink-3">No one ran in this election.</p>
            )}
            {e.status === "CLOSED" ? (
              rows.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <p className="text-sm text-ink-2">There&apos;s nothing to apply.</p>
                  {restart("Start again", e.method)}
                  <CancelElectionButton slug={club.slug} electionId={e.id} />
                </div>
              ) : vote?.kind === "noQuorum" ? (
                <div className="space-y-3 border-t border-line pt-4">
                  <Callout tone="warning" title="No quorum">
                    Only {results.totalVotes} of the {results.eligibleVoters} eligible voters voted, and your bylaws need {vote.quorum.needed} ({vote.quorum.percent}%) for the result to count, so nobody takes {e.position.name} from this vote. Start again, or fill the seat another way.
                  </Callout>
                  <div className="flex flex-wrap items-center gap-2">
                    {restart("Start again", "MEMBER_VOTE", "primary")}
                    {restart("Use another way", otherMode)}
                  </div>
                </div>
              ) : tie?.resolution.kind === "runoff" ? (
                <div className="space-y-3 border-t border-line pt-4">
                  <Callout tone="info" title="It's a tie, and your bylaws call for a runoff">
                    {names(leadersRows.map((r) => r.name))} tied at {leadersRows[0]?.votes ?? 0} vote{leadersRows[0]?.votes === 1 ? "" : "s"}. A runoff puts just them on a new ballot that opens right away, under the same rules.
                  </Callout>
                  <div className="flex flex-wrap items-center gap-2">
                    <RunoffButton slug={club.slug} electionId={e.id} tied={leadersRows.map((r) => r.name)} defaultCloses={setup.defaults.runoffCloses ?? setup.defaults.closes} />
                    {restart("Use another way", otherMode)}
                  </div>
                </div>
              ) : tie && !mayChoose ? (
                <div className="space-y-3 border-t border-line pt-4">
                  <Callout tone="info" icon={<Info />} title="It's a tie">
                    {choosers?.by === "wsusa"
                      ? `Nobody in the club can settle it under its bylaws, so ${officeName} chooses who takes the seat.`
                      : `Under your bylaws, ${chooserNames.length ? names(chooserNames) : `the ${choosers?.by === "president" ? "President" : "advisor"}`} ${chooserNames.length === 1 || !chooserNames.length ? "casts" : "cast"} the deciding vote. They choose who takes ${e.position.name} from this page.`}
                  </Callout>
                </div>
              ) : e.method === "SELF_SELECT" && !unanimous ? (
                <div className="space-y-3 border-t border-line pt-4">
                  <Callout tone="warning" title="No unanimous choice">
                    A self-select counts only when every leader votes, all for the same person, so this result can&apos;t be applied. Start again, or fill {e.position.name} another way.
                  </Callout>
                  <div className="flex flex-wrap items-center gap-2">
                    {restart("Start again", "SELF_SELECT", "primary")}
                    {restart("Use another way", otherMode)}
                  </div>
                </div>
              ) : canApply ? (
                <div className="border-t border-line pt-4">
                  <ApplyResultPanel
                    slug={club.slug}
                    electionId={e.id}
                    seatName={e.position.name}
                    winner={clearWinner}
                    tied={clearWinner ? [] : leadersRows}
                    replacing={replacingFor(clearWinner ? byId.get(clearWinner.id)?.userId : null)}
                    setup={permSetup}
                    sittingIds={sittingIds}
                    movingFrom={movingFrom}
                    kind={e.method === "SELF_SELECT" ? "unanimous" : "vote"}
                    tieNote={tieNote}
                  />
                </div>
              ) : (
                <div className="space-y-3 border-t border-line pt-4">
                  {e.method === "SELF_SELECT" && unanimous ? (
                    <p className="flex items-center gap-2 text-sm text-ink">
                      <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                      <span>
                        Unanimous: every other leader chose <strong>{unanimous.name}</strong>.
                      </span>
                    </p>
                  ) : null}
                  {cannotApply}
                </div>
              )
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {e.status === "APPLIED" ? (
        <Callout tone="success" icon={<CheckCircle2 />} title="Seat filled">
          {winnerName ?? "The winner"} holds {e.position.name} now
          {e.method === "ADVISOR_PRESIDENT" && e.confirmedById ? ` — proposed by ${people.get(e.proposedById ?? "") ?? "a club leader"} and confirmed by ${people.get(e.confirmedById) ?? "the other side"}` : ""}.{" "}
          <Link href={`/clubs/${club.slug}/manage/org-chart`} className="underline">
            See the org chart
          </Link>
        </Callout>
      ) : null}

      {e.status === "CANCELLED" ? (
        runoffChild ? (
          <Callout tone="info" title="This vote tied, so it went to a runoff">
            The tied candidates are on a new ballot:{" "}
            <Link href={`/clubs/${club.slug}/manage/elections/${runoffChild.id}`} className="underline">
              {runoffChild.title}
            </Link>
            .
          </Callout>
        ) : (
          <Callout tone="info">This was called off. Nobody took the seat from it.</Callout>
        )
      ) : null}

      <Card>
        <CardHeader
          title={e.method === "NEXT_IN_LINE" ? `Next in line (${candidates.length})` : `Candidates (${candidates.length})`}
          description={
            e.method === "NEXT_IN_LINE"
              ? "In pipeline order. Anyone who said no came off the list."
              : e.method === "MEMBER_VOTE"
                ? "Everyone on the org chart below the seat starts on the ballot. Active members can also run, and you can add anyone."
                : "Everyone on the org chart below the seat starts on the list, and you can add any active member. Anyone can withdraw."
          }
          action={e.status === "NOMINATING" && organizersAddCandidates(e.method) ? <NominateDialog slug={club.slug} electionId={e.id} people={nominees} /> : null}
        />
        {candidates.length === 0 ? (
          <CardBody>
            <EmptyState className="border-0 py-8" title="No candidates yet" description={e.method === "MEMBER_VOTE" ? "Members can run from the election page, or you can add someone." : "Add an active member to the list."} />
          </CardBody>
        ) : (
          <ol className="divide-y divide-line">
            {candidates.map((c, i) => (
              <li key={c.id} className="flex items-start gap-3 px-5 py-4">
                {e.method === "NEXT_IN_LINE" ? <span className="mt-1.5 w-5 shrink-0 text-right text-xs tabular-nums text-ink-3">{i + 1}.</span> : null}
                <Avatar name={c.name} src={c.avatarUrl} color={c.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/u/${c.handle}`} className="text-sm font-medium text-ink hover:underline">
                      {c.name}
                    </Link>
                    {e.method === "NEXT_IN_LINE" ? (
                      c.acceptedAt ? (
                        <Badge tone="success">Said yes</Badge>
                      ) : (
                        <Badge tone="neutral">{e.status === "VOTING" ? "Hasn't answered" : "Didn't answer"}</Badge>
                      )
                    ) : null}
                    {firstYes?.id === c.id && e.status !== "APPLIED" ? <Badge tone="brand">First in line who said yes</Badge> : null}
                    {proposed?.id === c.id && e.status === "NOMINATING" ? <Badge tone="brand">Proposed</Badge> : null}
                  </div>
                  <p className="text-xs text-ink-3">
                    {[seatOf(c.userId), candidateSource(c), c.acceptedAt ? `said yes ${fmtWhen(c.acceptedAt)}` : null].filter(Boolean).join(" · ")}
                  </p>
                  {usesBallots(e.method) ? c.statement ? <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-sm text-ink-2">{c.statement}</p> : <p className="mt-1.5 text-sm italic text-ink-3">No statement yet.</p> : null}
                </div>
                {open ? <RemoveCandidateButton slug={club.slug} candidateId={c.id} name={c.name} /> : null}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {e.status !== "APPLIED" && e.status !== "CANCELLED" && holders.length ? (
        <p className="text-sm text-ink-3">
          {e.position.name} is held by {names(holders.map((h) => h.user.name))} today. Filling it replaces them unless they&apos;re chosen again.
        </p>
      ) : null}
      {e.method !== club.successionMethod && e.status !== "APPLIED" && e.status !== "CANCELLED" ? (
        <p className="text-sm text-ink-3">
          <MethodBadge method={club.successionMethod} primary /> is {club.name}&apos;s primary method; this seat uses {SUCCESSION_NAME[e.method]} this time.
        </p>
      ) : null}
    </div>
  );
}
