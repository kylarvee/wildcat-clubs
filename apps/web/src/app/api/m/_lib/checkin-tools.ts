import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";
import { assertSignedIn, parse } from "@/lib/domain/kit";
import { addManual, canManageOccurrence, checkinScreen, liveOccurrencesForClub, searchCheckinCandidates } from "@/lib/domain/attendance";
import { occurrenceById, toOccurrenceSummary } from "@/lib/attendance/queries";
import { codeClubsPhrase, METHOD_LABEL } from "@/lib/attendance/rules";
import { qrRows } from "./qr";
import { toMOccurrence } from "./serialize";
import type { MCheckinCandidates, MCheckinQr, MLeaderCheckin, MManualCheckinResult } from "../_types";

/**
 * Leader check-in tools on the phone: the rotating QR and adding someone by
 * hand. Who may run check-in is lib/domain/attendance's rule (the Attendance
 * permission in the host club; admins at university events), and every call
 * here goes through it: canManageOccurrence decides whether the buttons
 * show, and checkinScreen, searchCheckinCandidates and addManual check again.
 */

const OccurrenceId = z.string().trim().min(1, "Which event?").max(64);

/** The tools for one meeting: only while its check-in window is open, and only for people who can run it. */
export async function leaderCheckinFor(actor: Actor | null, occurrenceId: string): Promise<MLeaderCheckin | null> {
  if (!actor) return null;
  const occ = await occurrenceById(occurrenceId);
  if (!occ) return null;
  const summary = toOccurrenceSummary(occ, await getConfig(), new Date());
  if (summary.cancelled || summary.windowState !== "OPEN") return null;
  if (!(await canManageOccurrence(actor, occ))) return null;
  const checkedIn = await db.attendance.count({ where: { occurrenceId: occ.id } });
  return { occurrence: toMOccurrence(summary), checkedIn };
}

/** A club's meetings (hosted or co-hosted) with check-in open now that this person can run. */
export async function leaderCheckinsForClub(actor: Actor | null, clubId: string): Promise<MLeaderCheckin[]> {
  if (!actor) return [];
  const live = await liveOccurrencesForClub(clubId);
  const out: MLeaderCheckin[] = [];
  for (const o of live) {
    const occ = await occurrenceById(o.id);
    if (occ && (await canManageOccurrence(actor, occ))) out.push({ occurrence: toMOccurrence(o), checkedIn: o.checkedIn });
  }
  return out;
}

/** The rotating QR, the event code and the head count: the web live screen's data (attendance.checkinScreen). */
export async function checkinQrView(actor: Actor | null, occurrenceId: string): Promise<MCheckinQr> {
  assertSignedIn(actor);
  const { occurrence, token, feed } = await checkinScreen(actor, parse(OccurrenceId, occurrenceId));
  return {
    occurrence: toMOccurrence(occurrence),
    url: token.url,
    qr: qrRows(token.url),
    code: token.code,
    codeClubs: codeClubsPhrase(occurrence.club?.name ?? null, occurrence.cohosts.map((c) => c.name)),
    rotateSeconds: token.rotateSeconds,
    refreshInMs: token.expiresInMs,
    refreshAt: new Date(Date.now() + token.expiresInMs).toISOString(),
    windowState: token.windowState,
    checkedIn: feed.count,
  };
}

/** People a leader can add: the host club's members first, then any account (attendance.searchCheckinCandidates). */
export async function checkinCandidatesView(actor: Actor | null, occurrenceId: string, query: string | null): Promise<MCheckinCandidates> {
  assertSignedIn(actor);
  const rows = await searchCheckinCandidates(actor, parse(OccurrenceId, occurrenceId), query ?? "");
  return {
    items: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, avatarColor: u.avatarColor, isMember: u.isMember, alreadyIn: u.alreadyIn })),
  };
}

/** Records someone who was there but couldn't scan, as "Added by a leader" (attendance.addManual). */
export async function manualCheckin(actor: Actor | null, occurrenceId: string, input: unknown): Promise<MManualCheckinResult> {
  assertSignedIn(actor);
  const id = parse(OccurrenceId, occurrenceId);
  const { userId } = parse(z.object({ userId: z.string().trim().min(1, "Choose who to add.").max(64) }), input);
  const r = await addManual(actor, id, userId);
  const checkedIn = await db.attendance.count({ where: { occurrenceId: id } });
  return { attendanceId: r.attendanceId, name: r.name, method: "MANUAL", methodLabel: METHOD_LABEL.MANUAL, requirementsMet: r.requirementsMet, checkedIn };
}
