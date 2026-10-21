import { getCurrentUser } from "@/lib/auth/session";
import { downloadOfficersLetter } from "@/lib/domain/officers";
import { pdfResponse, signInFirst } from "@/lib/documents/http";

/**
 * GET /clubs/:slug/manage/org-chart/officers.pdf[?inline=1]
 * The club's officers of record as a one-page letter, built now with a
 * verification QR code. The org chart and the admin club page link here;
 * lib/domain/officers decides who may download it and logs each download.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getCurrentUser();
  if (!actor) return signInFirst(req, `/clubs/${encodeURIComponent(slug)}/manage/org-chart/officers.pdf`);
  return pdfResponse(req, () => downloadOfficersLetter(actor, slug));
}
