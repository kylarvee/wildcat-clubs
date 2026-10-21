"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { approveEventReview, requestEventChanges } from "@/lib/domain/events";

/** A decision changes the queue counts, the club's calendars and the event page. */
function refresh(eventId: string) {
  revalidatePath("/admin", "layout");
  revalidatePath("/clubs/[slug]", "layout");
  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/dashboard");
}

export async function approveEventReviewAction(eventId: string, note: string | null) {
  const r = await act((actor) => approveEventReview(actor, eventId, { note }));
  if (r.ok) refresh(eventId);
  return r;
}

export async function requestEventChangesAction(eventId: string, note: string) {
  const r = await act((actor) => requestEventChanges(actor, eventId, { note }));
  if (r.ok) refresh(eventId);
  return r;
}
