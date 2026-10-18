import "server-only";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, isAdmin } from "@/lib/authz";

/**
 * THE rule for who sees a person's member details (lib/domain/details reads
 * and writes them; nothing else touches the table):
 *
 *   the person and admins      everything
 *   a club's roster holders    contact basics (phone, personal email, year in
 *   and advisors               school) for that club's members and requests
 *   the same people            the emergency contact, only on purpose — each
 *                              opening is logged (lib/domain/details)
 *   everyone else              nothing (student ID, birth date, gender and
 *                              address never leave the person and admins)
 */

/** The person themself, or WSUSA staff. */
export function seesAllDetails(viewer: Actor | null, subjectId: string): boolean {
  return Boolean(viewer && (viewer.id === subjectId || isAdmin(viewer)));
}

/** May this viewer see contact basics and open emergency contacts for the club's members (roster capability or advisor)? */
export async function canSeeMemberContacts(viewer: Actor | null, clubId: string): Promise<boolean> {
  if (!viewer) return false;
  const access = await getClubAccess(viewer, clubId);
  return Boolean(access && (access.capabilities.has("roster") || access.isAdvisor || access.viaPlatform));
}

/** Is the subject a current member of (or requesting to join) the club — the only people whose details its roster holders see? */
export async function isClubMemberOrRequest(subjectId: string, clubId: string): Promise<boolean> {
  const m = await db.membership.findUnique({ where: { userId_clubId: { userId: subjectId, clubId } }, select: { status: true } });
  return m?.status === "ACTIVE" || m?.status === "PENDING";
}
