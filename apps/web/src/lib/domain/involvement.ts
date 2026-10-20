import "server-only";
import type { Actor } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { fmtDate } from "@/lib/time";
import { assertSignedIn, notFound } from "@/lib/domain/kit";
import { loadInvolvementRecord } from "@/lib/documents/involvement";
import { renderInvolvementPdf } from "@/lib/documents/involvement-pdf";
import { issueDocumentToken, verifyUrl } from "@/lib/documents/tokens";

/**
 * THE INVOLVEMENT RECORD as a document (lib/documents). The person may
 * download their own; WSUSA staff may download anyone's from People
 * (admin.users). Everyone else hears it wasn't found, so ids reveal nothing.
 * Each download is built fresh, so it's always current, carries a newly
 * signed verification link, and leaves a private activity row saying who
 * downloaded whose (record.downloaded).
 */
export async function downloadInvolvementRecord(actor: Actor | null, userId: string): Promise<{ pdf: Buffer; fileName: string }> {
  assertSignedIn(actor);
  const self = actor.id === userId;
  if (!self && !can(actor, "admin.users")) throw notFound("That record");
  const record = await loadInvolvementRecord(userId);
  if (!record) throw notFound("That record");
  const token = issueDocumentToken("involvement", userId, record.generatedAt);
  const pdf = await renderInvolvementPdf(record, { url: verifyUrl(token), issuedAt: record.generatedAt });
  await logActivity({ actorId: actor.id, action: "record.downloaded", entityType: "user", entityId: userId, data: { userId, self }, isPublic: false });
  return { pdf, fileName: `involvement-record-${record.person.handle}-${fmtDate(record.generatedAt, "yyyy-MM-dd")}.pdf` };
}
