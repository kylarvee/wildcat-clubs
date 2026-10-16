import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { normalizeDraftData } from "@/lib/constitution/templates";
import { EMPTY_FACTS, renderDoc } from "@/lib/constitution/render";
import { renderConstitutionPdf } from "@/lib/constitution/pdf";
import { clubFacts } from "@/lib/domain/constitution";
import { slugify } from "@/lib/domain/clubs";

/**
 * GET /api/constitution/:draftId/pdf?doc=constitution|bylaws[&club=<id>][&download=1]
 * A draft preview PDF for the draft's owner. `club` (or the draft's preview
 * club) fills in the club's name/type when the viewer leads that club.
 * Adopted documents are club files and are served by /api/files/:id instead.
 */
export async function GET(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  const actor = await getCurrentUser();
  if (!actor) return new Response("Sign in to view this draft.", { status: 401 });
  const draft = await db.constitutionDraft.findUnique({ where: { id: draftId } });
  if (!draft || draft.ownerId !== actor.id) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("doc") === "bylaws" ? "bylaws" : "constitution";
  const data = normalizeDraftData(draft.data);
  const clubId = url.searchParams.get("club") || data.previewClubId;
  const facts = clubId && (await getClubAccess(actor, clubId))?.isLeader ? await clubFacts(clubId) : EMPTY_FACTS;

  try {
    const pdf = await renderConstitutionPdf(renderDoc(kind, data, facts));
    const filename = `${facts.name ? slugify(facts.name) : "draft"}-${kind}-draft.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("We couldn't build that PDF. Please try again.", { status: 500 });
  }
}
