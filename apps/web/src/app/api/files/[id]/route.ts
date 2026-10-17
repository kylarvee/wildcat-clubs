import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewFile } from "@/lib/domain/files";
import { getBytes, servedType } from "@/lib/files/storage";

/** "Fall flyer (2).png" → a quoted ASCII fallback plus the exact UTF-8 name (RFC 6266). */
function disposition(kind: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Parses a single "bytes=start-end" range. Null means "send everything"; "invalid" means 416. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range or odd syntax: serve the whole file
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (!suffix) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

/**
 * Serves a file's bytes after the permission check. ?download=1 forces a
 * download. Byte ranges are supported so videos can seek (Safari needs it).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await db.fileItem.findUnique({ where: { id } });
  if (!file || file.isFolder || !file.storageKey) return new Response("Not found", { status: 404 });
  const actor = await getCurrentUser();
  if (!(await canViewFile(actor, file))) return new Response(actor ? "You don't have access to this file." : "Sign in to view this file.", { status: actor ? 403 : 401 });
  const bytes = await getBytes(file.storageKey).catch(() => null);
  if (!bytes) return new Response("This file is missing from storage.", { status: 410 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const shown = servedType(file.mimeType);
  const headers: Record<string, string> = {
    "content-type": shown ?? "application/octet-stream",
    "content-disposition": disposition(download || !shown ? "attachment" : "inline", file.name),
    // Public files may be cached by the browser a little longer; nothing is cached by shared caches.
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "last-modified": file.updatedAt.toUTCString(),
    // Anything opened directly runs sandboxed: no script, an opaque origin. PDFs are exempt
    // because browsers' PDF viewers won't render under a sandbox (they are not scriptable pages).
    ...(shown === "application/pdf" ? {} : { "content-security-policy": shown === "image/svg+xml" ? "default-src 'none'; style-src 'unsafe-inline'; sandbox" : "sandbox" }),
  };

  const range = parseRange(req.headers.get("range"), bytes.length);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${bytes.length}` } });
  }
  if (range) {
    const chunk = bytes.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${bytes.length}`, "content-length": String(chunk.length) },
    });
  }
  return new Response(new Uint8Array(bytes), { headers: { ...headers, "content-length": String(bytes.length) } });
}
