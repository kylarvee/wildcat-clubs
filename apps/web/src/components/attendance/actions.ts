"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { addManual, checkIn, removeAttendance, searchCheckinCandidates, type CheckInVia } from "@/lib/domain/attendance";

/**
 * Server actions for the Attendance Tool's shared components (check-in
 * button, live prompt, manual add, remove). They live beside the components
 * because the same components appear on several routes (/c/<code>, club
 * pages, the club workspace).
 */

function refreshAttendanceViews() {
  revalidatePath("/me/attendance");
  revalidatePath("/clubs/[slug]/manage/attendance", "layout");
}

export async function checkInAction(input: { code: string; token?: string | null; via?: CheckInVia }) {
  const res = await act((actor) => checkIn(actor, { code: input.code, token: input.token ?? null, via: input.via ?? "web" }));
  if (res.ok) refreshAttendanceViews();
  return res;
}

export async function addManualAction(occurrenceId: string, userId: string) {
  const res = await act((actor) => addManual(actor, occurrenceId, userId));
  if (res.ok) refreshAttendanceViews();
  return res;
}

export async function removeAttendanceAction(attendanceId: string) {
  const res = await act((actor) => removeAttendance(actor, attendanceId));
  if (res.ok) refreshAttendanceViews();
  return res;
}

export async function searchCandidatesAction(occurrenceId: string, query: string) {
  return act((actor) => searchCheckinCandidates(actor, occurrenceId, query));
}
