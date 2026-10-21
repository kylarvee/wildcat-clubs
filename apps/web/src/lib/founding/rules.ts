import type { ClubStatus } from "@prisma/client";

/**
 * Founding a club: names and pure rules shared by the domain (lib/domain
 * cofounders, clubs), lib/authz/founding, pages, the seed and tests. Pure and
 * client-safe (type imports only).
 *
 * A club is being founded while it's a DRAFT, waiting for its office
 * (SUBMITTED) or back with its founders (CHANGES_REQUESTED).
 */

export const FOUNDING_STATUSES: readonly ClubStatus[] = ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED"];

export const isFounding = (status: ClubStatus) => FOUNDING_STATUSES.includes(status);

/**
 * Listed as forming: still being founded, and its founders chose "List this
 * club as forming". Only then is it in the clubs list's Forming section, with
 * a minimal page signed-in accounts can open and follow. The flag means
 * nothing once the club is decided (approval and rejection turn it off).
 */
export const isListedForming = (club: { status: ClubStatus; listedAsForming: boolean }) => club.listedAsForming && isFounding(club.status);

// ─── Co-founders ─────────────────────────────────────────────────────────────

/** Task source for a co-founder invitation in the invitee's inbox. sourceId = the CofounderInvite's id. */
export const COFOUNDER_INVITE = "cofounderInvite";

/** Invitations a club may have waiting at once. */
export const COFOUNDER_PENDING_CAP = 8;

export const cofounderInviteHref = (token: string) => `/cofounder/${token}`;

// ─── Reviving a retired club ─────────────────────────────────────────────────

/**
 * Task source for a student's request to bring a retired club back: an
 * APPROVAL task for the club's office. sourceId = the club's id (one open at a
 * time), createdById = the student, description = their note.
 */
export const CLUB_REVIVAL = "clubRevival";

export const REVIVAL_NOTE_MAX = 1000;

/** A revival task's description when the student added no note (the task says who'd lead it either way). */
export const revivalDefaultDescription = (studentName: string) => `${studentName} would lead it as President.`;

/** The student's own note on a revival task, or null when they didn't write one. */
export const revivalNote = (task: { description: string | null }, studentName: string) =>
  task.description && task.description !== revivalDefaultDescription(studentName) ? task.description : null;

/** Where the office decides a revival request: the club's page in Club approvals. */
export const revivalHref = (clubId: string) => `/admin/clubs/${clubId}#revival`;

// ─── What a forming club shows ───────────────────────────────────────────────

/** "Frank Okafor", "Frank Okafor and Sam Rivera", "Frank Okafor, Sam Rivera and 2 others". Names only, never contacts. */
export function foundersLine(names: readonly string[], max = 3): string {
  const list = [...new Set(names.filter(Boolean))];
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length <= max) return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  const rest = list.length - (max - 1);
  return `${list.slice(0, max - 1).join(", ")} and ${rest} others`;
}
