import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute, assertSignedIn, invalid } from "@/lib/domain/kit";
import { fileUrl, uploadFile } from "@/lib/domain/files";
import { readUploadForm } from "@/lib/files/upload";
import { z } from "zod";

const Visibility = z.enum(["INHERIT", "PUBLIC", "MEMBERS", "LEADERS"]).optional();
const Scope = z.enum(["club", "user", "university"]).default("club");

/**
 * POST multipart: file, scope (club|user|university), clubId?, parentId?, visibility?, purpose? ("logo" uses the profile capability).
 * Returns { id, name, mimeType, url, sizeBytes, parentId }. A same-named file in the folder gets " (2)" added.
 */
export async function POST(req: Request) {
  return apiRoute(async () => {
    const actor = await getCurrentUser();
    // Before reading the body, so signed-out requests can't make us buffer it.
    assertSignedIn(actor);
    const form = await readUploadForm(req);
    const file = form.get("file");
    if (!(file instanceof File)) throw invalid("No file was attached.");
    const scope = Scope.catch("club").parse(form.get("scope") ?? undefined);
    const visibility = Visibility.safeParse(form.get("visibility") || undefined);
    if (!visibility.success) throw invalid("Unknown visibility.");
    const saved = await uploadFile(
      actor,
      {
        name: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
        scope,
        clubId: (form.get("clubId") as string) || null,
        parentId: (form.get("parentId") as string) || null,
        visibility: visibility.data,
      },
      { capability: form.get("purpose") === "logo" ? "profile" : "files" },
    );
    return { id: saved.id, name: saved.name, mimeType: saved.mimeType, url: fileUrl(saved.id), sizeBytes: saved.sizeBytes, parentId: saved.parentId };
  });
}
