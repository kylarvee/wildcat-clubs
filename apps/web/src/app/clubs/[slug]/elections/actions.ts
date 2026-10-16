"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as elections from "@/lib/domain/elections";

function refresh(slug: string) {
  revalidatePath(`/clubs/${slug}`, "layout");
}

export async function runForSeat(slug: string, electionId: string, statement: string) {
  const r = await act(async (actor) => {
    await elections.nominateCandidate(actor, electionId, { statement });
  });
  refresh(slug);
  return r;
}

export async function saveStatement(slug: string, candidateId: string, statement: string) {
  const r = await act((actor) => elections.updateCandidateStatement(actor, candidateId, statement));
  refresh(slug);
  return r;
}

export async function withdraw(slug: string, candidateId: string) {
  const r = await act((actor) => elections.withdrawCandidate(actor, candidateId));
  refresh(slug);
  return r;
}

export async function vote(slug: string, electionId: string, candidateId: string) {
  const r = await act((actor) => elections.castVote(actor, electionId, candidateId));
  refresh(slug);
  return r;
}
