"use server";

import { act } from "@/lib/domain/kit";
import { createClub, type CreateClubInput } from "@/lib/domain/clubs";

export async function createClubAction(input: CreateClubInput) {
  return act((actor) => createClub(actor, input));
}
