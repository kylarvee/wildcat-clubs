"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { requestClubRevival } from "@/lib/domain/clubs";
import { joinClub, subscribeCalendar, unsubscribeCalendar } from "@/lib/domain/memberships";

/**
 * Register and Subscribe — used by club cards on /clubs, the club page hero
 * and the landing page. Both go through lib/domain/memberships, so the club's
 * join gate applies the same way as the mobile app and QR check-in.
 */

function refreshClubPages() {
  revalidatePath("/clubs");
  revalidatePath("/clubs/[slug]", "page");
  revalidatePath("/dashboard");
}

export async function registerClub(clubId: string) {
  const result = await act((actor) => joinClub(actor, clubId, "REGISTER"));
  if (result.ok) refreshClubPages();
  return result;
}

export async function setClubSubscription(clubId: string, subscribed: boolean) {
  const result = await act((actor) => (subscribed ? subscribeCalendar(actor, clubId) : unsubscribeCalendar(actor, clubId)));
  if (result.ok) refreshClubPages();
  return result;
}

/** "Ask to revive it" (the Start a club wizard and a retired club's page): a student asks the club's office to bring it back. */
export async function requestClubRevivalAction(input: { clubId: string; note?: string }) {
  const result = await act((actor) => requestClubRevival(actor, input));
  if (result.ok) {
    revalidatePath("/clubs/[slug]", "page");
    revalidatePath("/admin", "layout");
  }
  return result;
}
