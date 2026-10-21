import "server-only";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/lake/activity";
import { officeForClub } from "@/lib/offices";
import { assertSignedIn, conflict, forbidden, notFound } from "@/lib/domain/kit";
import { currentRenewalWindow } from "@/lib/domain/renewals";
import { loadOfficersRecord, officersFileName, type OfficersRecord } from "@/lib/documents/officers";
import { renderOfficersPdf } from "@/lib/documents/officers-pdf";
import { issueDocumentToken, verifyDocumentToken, verifyUrl } from "@/lib/documents/tokens";

/**
 * THE OFFICERS OF RECORD as a document (lib/documents/officers): a one-page
 * letter of who leads an approved club, for a bank, a room booking or a
 * sponsor. Who may download it is who may open the club's workspace
 * (lib/authz ClubAccess.isLeader): its leaders from Ambassador up, its
 * advisors, and the admins or office staff for the club. Members and
 * everyone else are refused (a founding club's letter is "not found", as the
 * club itself is). Each download is built fresh, so it's always current,
 * carries a newly signed verification link (kind "officers", subject the
 * club) and leaves a private activity row (officers.downloaded).
 */

/** The officers of record as they stand now, with this academic year's renewal window. Checks nothing. */
export async function officersRecord(clubId: string, now: Date = new Date()): Promise<OfficersRecord | null> {
  const { window } = await currentRenewalWindow(now);
  return loadOfficersRecord(db, clubId, { window, now });
}

/** May this person download the club's officers of record? The same people who open its workspace. */
export function mayDownloadOfficers(access: { isLeader: boolean } | null): boolean {
  return Boolean(access?.isLeader);
}

export async function downloadOfficersLetter(actor: Actor | null, slug: string, now: Date = new Date()): Promise<{ pdf: Buffer; fileName: string }> {
  assertSignedIn(actor);
  const club = await db.club.findUnique({ where: { slug: String(slug) }, select: { id: true, name: true, status: true } });
  if (!club) throw notFound("That club");
  const access = await getClubAccess(actor, club.id);
  if (!mayDownloadOfficers(access)) {
    // Founding clubs are private to their own leaders, so to anyone else they don't exist.
    if (club.status !== "APPROVED" && club.status !== "RETIRED") throw notFound("That club");
    const office = await officeForClub(club.id);
    throw forbidden(`Only ${club.name}'s leaders, its advisors and ${office.name} can download its officers of record.`);
  }
  if (club.status === "RETIRED") throw conflict(`${club.name} has retired, so it has no officers of record. Its role history stays on the club page.`);
  if (club.status !== "APPROVED") throw conflict(`Officers of record are for approved clubs. ${club.name} can download one once it's approved.`);
  const record = await officersRecord(club.id, now);
  if (!record) throw notFound("That club");
  const token = issueDocumentToken("officers", club.id, record.generatedAt);
  const pdf = await renderOfficersPdf(record, { url: verifyUrl(token), issuedAt: record.generatedAt });
  await logActivity({ actorId: actor.id, action: "officers.downloaded", entityType: "club", entityId: club.id, clubId: club.id, data: { via: access?.viaPlatform ?? null }, isPublic: false });
  return { pdf, fileName: officersFileName(record) };
}

export type VerifiedOfficers =
  | { state: "valid"; record: OfficersRecord; issuedAt: Date }
  /** Signed by us, but the club has retired since: no current officers to show. */
  | { state: "retired"; record: OfficersRecord; issuedAt: Date }
  /** Signed by us, but the club is gone or no longer public. */
  | { state: "closed"; issuedAt: Date }
  | { state: "invalid" };

/**
 * What an officers-of-record /verify link shows: the club's officers as they
 * stand now, when the link is one we signed for a club that's still approved.
 * Public (the link is the permission): only what the letter itself prints.
 */
export async function verifiedOfficers(token: string, now: Date = new Date()): Promise<VerifiedOfficers> {
  const claim = verifyDocumentToken(token, now);
  if (!claim || claim.kind !== "officers") return { state: "invalid" };
  const record = await officersRecord(claim.subjectId, now);
  if (!record || (record.club.status !== "APPROVED" && record.club.status !== "RETIRED")) return { state: "closed", issuedAt: claim.issuedAt };
  if (record.club.status === "RETIRED") return { state: "retired", record, issuedAt: claim.issuedAt };
  return { state: "valid", record, issuedAt: claim.issuedAt };
}
