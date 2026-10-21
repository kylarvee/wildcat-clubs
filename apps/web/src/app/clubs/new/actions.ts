"use server";

import { act, assertSignedIn } from "@/lib/domain/kit";
import { createClub, type CreateClubInput } from "@/lib/domain/clubs";
import { similarClubs } from "@/lib/search/similar";

export async function createClubAction(input: CreateClubInput) {
  return act((actor) => createClub(actor, input));
}

/** "Similar clubs already exist", as the founder types (the wizard debounces). Reads only: approved and retired clubs. */
export async function findSimilarClubsAction(input: { name: string; description: string }) {
  return act(async (actor) => {
    assertSignedIn(actor);
    return similarClubs({ name: String(input?.name ?? "").slice(0, 100), description: String(input?.description ?? "").slice(0, 200), viewerId: actor.id });
  });
}
