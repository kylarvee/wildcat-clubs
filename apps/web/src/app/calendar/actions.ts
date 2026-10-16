"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { setUniversityCalendar, subscribeCalendar, unsubscribeCalendar } from "@/lib/domain/memberships";

/** Calendar subscription toggles on the united calendar. */

export async function setClubSubscriptionAction(clubId: string, on: boolean) {
  const r = await act((a) => (on ? subscribeCalendar(a, clubId) : unsubscribeCalendar(a, clubId)));
  if (r.ok) {
    revalidatePath("/calendar");
    revalidatePath("/clubs/[slug]", "page");
  }
  return r;
}

export async function setUniversityCalendarAction(on: boolean) {
  const r = await act((a) => setUniversityCalendar(a, on));
  if (r.ok) revalidatePath("/calendar");
  return r;
}
