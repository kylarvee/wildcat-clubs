import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewFile } from "@/lib/domain/files";
import { getBytes } from "@/lib/files/storage";

/** Serves a file's bytes after the permission check. ?download=1 forces a download. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await db.fileItem.findUnique({ where: { id } });
  if (!file || file.isFolder || !file.storageKey) return new Response("Not found", { status: 404 });
  const actor = await getCurrentUser();
  if (!(await canViewFile(actor, file))) return new Response(actor ? "Forbidden" : "Sign in to view this file", { status: actor ? 403 : 401 });
  const bytes = await getBytes(file.storageKey).catch(() => null);
  if (!bytes) return new Response("File missing from storage", { status: 410 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const type = file.mimeType ?? "application/octet-stream";
  // Never let uploaded HTML run in our origin; SVG renders as an image but is sandboxed.
  const risky = type.includes("html");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": risky && !download ? "text/plain; charset=utf-8" : type,
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(file.name)}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      ...(type.includes("svg") ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
    },
  });
}
