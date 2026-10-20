import { getCurrentUser } from "@/lib/auth/session";
import { downloadInvolvementRecord } from "@/lib/domain/involvement";
import { pdfResponse, signInFirst } from "@/lib/documents/http";

/**
 * GET /admin/users/:id/record.pdf[?inline=1]
 * Someone's involvement record as a PDF, for WSUSA staff on the People page
 * (admin.users; lib/domain/involvement decides and logs the download).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentUser();
  if (!actor) return signInFirst(req, `/admin/users/${encodeURIComponent(id)}/record.pdf`);
  return pdfResponse(req, () => downloadInvolvementRecord(actor, id));
}
