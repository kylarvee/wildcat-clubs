import type { ClubStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/session";
import type { ClubAccess } from "@/lib/authz";
import { isFounding, isListedForming } from "@/lib/founding/rules";

/**
 * Who may do what while a club is being founded (part of THE permission
 * authority, lib/authz). Type imports only, so pages and tests can use it.
 *
 *   Founders    whoever holds President while the club is being founded,
 *               and the person who started it while they still hold a role
 *               in it (a faculty founder is its advisor). They invite
 *               co-founders and list the club as forming.
 *   Forming     a listed forming club's minimal page and the Forming section
 *               are for signed-in accounts only; signed-out visitors see
 *               nothing of it.
 *   Revival     only students may ask to bring a retired club back, since
 *               approving it makes them its President.
 */

export function isFounder(access: ClubAccess | null, club: { createdById: string; status: ClubStatus }, actorId: string | null | undefined): boolean {
  if (!access || !actorId || !isFounding(club.status) || access.suspended) return false;
  if (access.role === "PRESIDENT") return true;
  return club.createdById === actorId && access.rank >= 1;
}

/** May this viewer see a forming club's page (name, short description, founders' names, Follow)? */
export function canSeeFormingClub(viewer: Actor | null, club: { status: ClubStatus; listedAsForming: boolean }): boolean {
  return Boolean(viewer && viewer.status !== "DEACTIVATED") && isListedForming(club);
}

/** Students with an active account may ask to revive a retired club (they'd lead it). */
export function canAskToRevive(viewer: Pick<Actor, "kind" | "status"> | null): boolean {
  return Boolean(viewer && viewer.kind === "STUDENT" && viewer.status === "ACTIVE");
}
