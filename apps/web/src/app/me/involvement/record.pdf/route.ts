import { getCurrentUser } from "@/lib/auth/session";
import { downloadInvolvementRecord } from "@/lib/domain/involvement";
import { pdfResponse, signInFirst } from "@/lib/documents/http";

const PATH = "/me/involvement/record.pdf";

/**
 * GET /me/involvement/record.pdf[?inline=1]
 * Your involvement record as a PDF, built now so it's always current, with a
 * verification QR code. Signed-out visitors (the phone app opens this in its
 * browser) sign in first and land back here.
 */
export async function GET(req: Request) {
  const actor = await getCurrentUser();
  if (!actor) return signInFirst(req, PATH);
  return pdfResponse(req, () => downloadInvolvementRecord(actor, actor.id));
}
