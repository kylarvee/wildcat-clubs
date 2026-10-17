"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { leaveClub } from "@/lib/domain/memberships";
import { dismissAppPrompt } from "@/lib/domain/profiles";

/** Club page actions that aren't shared with the clubs list. */

export async function leaveClubAction(clubId: string) {
  const result = await act((actor) => leaveClub(actor, clubId));
  if (result.ok) {
    revalidatePath("/clubs");
    revalidatePath("/clubs/[slug]", "page");
    revalidatePath("/dashboard");
  }
  return result;
}

/** "Not now" on the get-the-app prompt. */
export async function dismissAppPromptAction() {
  return act((actor) => dismissAppPrompt(actor));
}
