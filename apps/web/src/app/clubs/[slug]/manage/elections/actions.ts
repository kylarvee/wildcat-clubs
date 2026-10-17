"use server";

import { revalidatePath } from "next/cache";
import { act, invalid } from "@/lib/domain/kit";
import * as elections from "@/lib/domain/elections";
import { parseCampusLocal } from "@/lib/roles/datetime";

function refresh(slug: string) {
  revalidatePath(`/clubs/${slug}`, "layout");
}

/** Times arrive as campus wall-clock strings from datetime-local inputs. */
export async function createElection(slug: string, input: { clubId: string; positionId: string; title: string; votingOpensAt: string; votingClosesAt: string }) {
  const r = await act(async (actor) => {
    const opens = parseCampusLocal(input.votingOpensAt);
    const closes = parseCampusLocal(input.votingClosesAt);
    if (!opens) throw invalid("Choose when voting opens.");
    if (!closes) throw invalid("Choose when voting closes.");
    const e = await elections.createElection(actor, { clubId: input.clubId, positionId: input.positionId, title: input.title, votingOpensAt: opens, votingClosesAt: closes });
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
  const r = await act((actor) => elections.applyElectionResult(actor, electionId, { winnerCandidateId, permissions }));
  refresh(slug);
  return r;
}
