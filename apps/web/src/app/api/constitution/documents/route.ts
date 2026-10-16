import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute } from "@/lib/domain/kit";
import { addClubDocument } from "@/lib/domain/clubs";
import { submitCustomDocument } from "@/lib/domain/constitution";

/**
 * POST multipart — club document uploads (route handler, so files aren't
 * capped by the server-action body limit).
 *   kind=OTHER                 clubId, title, visibility (PUBLIC|MEMBERS), file → profile "Additional documents"
 *   kind=CONSTITUTION|BYLAWS   clubId, title?, successionMethod, joinPolicy, note?, file → custom upload for WSUSA approval
 */
export async function POST(req: Request) {
  return apiRoute(async () => {
    const actor = await getCurrentUser();
    const form = await req.formData();
    const raw = form.get("file");
    const file = raw instanceof File && raw.size > 0 ? { name: raw.name, mimeType: raw.type, bytes: Buffer.from(await raw.arrayBuffer()) } : { name: "", mimeType: null, bytes: Buffer.alloc(0) };
    const text = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : undefined;
    };
    if (text("kind") === "OTHER") {
      const doc = await addClubDocument(actor, { clubId: text("clubId") ?? "", title: text("title") ?? "", visibility: text("visibility") ?? "PUBLIC", file });
      return { id: doc.id };
    }
    const doc = await submitCustomDocument(actor, {
      clubId: text("clubId"),
      kind: text("kind"),
      title: text("title"),
      successionMethod: text("successionMethod"),
      joinPolicy: text("joinPolicy"),
      note: text("note"),
      file,
    });
    return { id: doc.id };
  });
}
