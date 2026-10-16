import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute, invalid } from "@/lib/domain/kit";
import { fileUrl, uploadFile } from "@/lib/domain/files";
import type { FileVisibility } from "@prisma/client";

/** POST multipart: file, scope (club|user|university), clubId?, parentId?, visibility?, purpose? ("logo" uses the profile capability). */
export async function POST(req: Request) {
  return apiRoute(async () => {
    const actor = await getCurrentUser();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw invalid("No file was attached.");
    const scope = (form.get("scope") as "club" | "user" | "university") ?? "club";
    const saved = await uploadFile(
      actor,
      {
        name: file.name,
        mimeType: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
        scope,
        clubId: (form.get("clubId") as string) || null,
        parentId: (form.get("parentId") as string) || null,
        visibility: ((form.get("visibility") as FileVisibility) || undefined) ?? undefined,
      },
      { capability: form.get("purpose") === "logo" ? "profile" : "files" },
    );
    return { id: saved.id, name: saved.name, mimeType: saved.mimeType, url: fileUrl(saved.id) };
  });
}
