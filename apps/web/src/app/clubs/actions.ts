"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
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
