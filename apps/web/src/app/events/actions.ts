"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as events from "@/lib/domain/events";
import { resetCalendarToken, setUniversityCalendar } from "@/lib/domain/memberships";

/**
 * Server actions for every event surface: the Events Builder (club and
 * university mode), the full editor, the event page, and the Events page's
 * Subscribe menu. One file so club and admin tools share the exact same calls.
 */

function refresh(eventId?: string) {
  revalidatePath("/clubs/[slug]", "layout");
  revalidatePath("/admin/trainings", "layout");
  revalidatePath("/events");
  if (eventId) revalidatePath(`/events/${eventId}`);
}

async function run<T>(fn: Parameters<typeof act<T>>[0], eventId?: string) {
  const r = await act(fn);
  if (r.ok) refresh(eventId);
  return r;
}

export async function createEventAction(input: events.CreateEventInput) {
  return run((a) => events.createEvent(a, input));
}

export async function updateEventAction(eventId: string, input: events.EventInput) {
  return run((a) => events.updateEvent(a, eventId, input), eventId);
}

export async function moveEventAction(eventId: string, input: { startsAt: string; durationMinutes?: number; allDay?: boolean }) {
  return run((a) => events.moveEvent(a, eventId, input), eventId);
}

export async function cancelEventAction(eventId: string, reason?: string | null) {
  return run((a) => events.cancelEvent(a, eventId, reason), eventId);
}

export async function restoreEventAction(eventId: string) {
  return run((a) => events.restoreEvent(a, eventId), eventId);
}

export async function deleteEventAction(eventId: string) {
  return run((a) => events.deleteEvent(a, eventId), eventId);
}

export async function cancelOccurrenceAction(occurrenceId: string, note?: string | null) {
  return run((a) => events.cancelOccurrence(a, occurrenceId, note));
}

export async function restoreOccurrenceAction(occurrenceId: string) {
  return run((a) => events.restoreOccurrence(a, occurrenceId));
}

export async function setOccurrenceRoomAction(occurrenceId: string, room: string | null) {
  return run((a) => events.setOccurrenceRoom(a, occurrenceId, room));
}

// ─── Subscribe menu (calendar feeds) ─────────────────────────────────────────

/** A new private calendar link; the old one stops working. */
export async function resetCalendarLinkAction() {
  const r = await act((a) => resetCalendarToken(a));
  if (r.ok) revalidatePath("/events");
  return r;
}

/** University events on your calendar ("Mine" and your private feed), or not. */
export async function setUniversityCalendarAction(on: boolean) {
  const r = await act((a) => setUniversityCalendar(a, on));
  if (r.ok) revalidatePath("/events");
  return r;
}

export async function decideCohostAction(cohostId: string, approve: boolean) {
  return run(async (a) => {
    const c = await events.decideCohost(a, cohostId, approve);
    return { id: c.id, status: c.status };
  });
}
