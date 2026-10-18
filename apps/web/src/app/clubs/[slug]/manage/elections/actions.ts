"use server";

import { revalidatePath } from "next/cache";
import type { SuccessionMethod } from "@prisma/client";
import { act, invalid } from "@/lib/domain/kit";
import * as elections from "@/lib/domain/elections";
import { parseCampusLocal } from "@/lib/roles/datetime";
import { usesBallots } from "@/lib/roles/pipeline";

function refresh(slug: string) {
  revalidatePath(`/clubs/${slug}`, "layout");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export type SelectionForm = { title: string; method: SuccessionMethod; votingOpensAt?: string | null; votingClosesAt: string };

/** Times arrive as campus wall-clock strings from datetime-local inputs; modes without ballots send only the one date. */
function datesFrom(input: SelectionForm) {
  const closes = parseCampusLocal(input.votingClosesAt);
  if (!closes) throw invalid(usesBallots(input.method) ? "Choose when voting closes." : input.method === "NEXT_IN_LINE" ? "Choose when answers are due." : "Choose a decide-by date.");
  if (!usesBallots(input.method)) return { votingClosesAt: closes };
  const opens = parseCampusLocal(input.votingOpensAt);
  if (!opens) throw invalid("Choose when voting opens.");
  return { votingOpensAt: opens, votingClosesAt: closes };
}

export async function createElection(slug: string, input: SelectionForm & { clubId: string; positionId: string }) {
  const r = await act(async (actor) => {
    const e = await elections.createElection(actor, { clubId: input.clubId, positionId: input.positionId, title: input.title, method: input.method, ...datesFrom(input) });
    return { id: e.id };
  });
  refresh(slug);
  return r;
}

/** "Start again" / "Use another mode" for the same seat. */
export async function startOver(slug: string, electionId: string, input: SelectionForm) {
  const r = await act(async (actor) => {
    const e = await elections.startOver(actor, electionId, { title: input.title, method: input.method, ...datesFrom(input) });
    return { id: e.id };
  });
  refresh(slug);
  return r;
}

export async function nominateMember(slug: string, electionId: string, userId: string) {
  const r = await act(async (actor) => {
    await elections.nominateCandidate(actor, electionId, { userId });
  });
  refresh(slug);
  return r;
}

export async function removeCandidate(slug: string, candidateId: string) {
  const r = await act((actor) => elections.withdrawCandidate(actor, candidateId));
  refresh(slug);
  return r;
}

export async function openVotingNow(slug: string, electionId: string) {
  const r = await act((actor) => elections.openVoting(actor, electionId));
  refresh(slug);
  return r;
}

export async function closeVotingNow(slug: string, electionId: string) {
  const r = await act((actor) => elections.closeVoting(actor, electionId));
  refresh(slug);
  return r;
}

export async function cancel(slug: string, electionId: string) {
  const r = await act((actor) => elections.cancelElection(actor, electionId));
  refresh(slug);
  return r;
}

/** `permissions`: what the winner may do in an officer / ambassador seat (omit to use the seat's defaults). */
export async function applyResult(slug: string, electionId: string, winnerCandidateId: string | null, permissions?: string[]) {
  const r = await act(async (actor) => {
    const res = await elections.applyElectionResult(actor, electionId, { winnerCandidateId, permissions });
    return { movedUpFrom: res.movedUpFrom };
  });
  refresh(slug);
  return r;
}

export async function propose(slug: string, electionId: string, candidateId: string) {
  const r = await act((actor) => elections.proposeCandidate(actor, electionId, candidateId));
  refresh(slug);
  return r;
}

/** The proposer withdraws it, or whoever would confirm it sends it back. */
export async function withdrawProposal(slug: string, electionId: string) {
  const r = await act((actor) => elections.withdrawProposal(actor, electionId));
  refresh(slug);
  return r;
}

export async function confirmProposal(slug: string, electionId: string, permissions?: string[]) {
  const r = await act(async (actor) => {
    const res = await elections.confirmProposal(actor, electionId, { permissions });
    return { movedUpFrom: res.movedUpFrom };
  });
  refresh(slug);
  return r;
}
