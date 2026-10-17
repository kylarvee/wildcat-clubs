import "server-only";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Local file bytes (the mock Google Drive). Metadata lives in FileItem; this
 * only stores and returns bytes. When Drive sync is on, the Drive adapter
 * mirrors uploads and FileItem.driveFileId is set.
 */
export const STORAGE_ROOT = path.join(process.cwd(), "storage");
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function putBytes(name: string, bytes: Buffer): Promise<string> {
  const now = new Date();
  const dir = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"));
  const safe = name.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  const key = path.join(dir, `${randomUUID()}-${safe}`);
  await mkdir(path.join(STORAGE_ROOT, dir), { recursive: true });
  await writeFile(path.join(STORAGE_ROOT, key), bytes);
  return key;
}

export async function getBytes(storageKey: string): Promise<Buffer> {
  const full = path.join(STORAGE_ROOT, storageKey);
  if (!full.startsWith(STORAGE_ROOT)) throw new Error("Bad storage key");
  return readFile(full);
}

export async function deleteBytes(storageKey: string) {
  const full = path.join(STORAGE_ROOT, storageKey);
  if (!full.startsWith(STORAGE_ROOT)) return;
  await unlink(full).catch(() => undefined);
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

/**
 * A file's stored type comes from its extension only. The browser-reported type
 * (`_clientType`) is ignored: a client can claim anything, and the stored type
 * decides how /api/files serves the bytes.
 */
export function guessMime(name: string, _clientType?: string | null) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Types a browser may show in place, and nothing else: an HTML, XHTML or XML
 * file opened on our origin could run script as the viewer.
 */
const INLINE_TYPES = new Set([
  "application/pdf",
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml",
  "video/mp4", "video/quicktime", "video/webm",
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg",
]);

/**
 * The content type /api/files serves a stored type as, or null when the file
 * may only be downloaded (as opaque bytes). Text of any kind shows as plain text.
 * Checked at serve time, so files stored before a rule changed are covered too.
 */
export function servedType(stored: string | null | undefined): string | null {
  const type = (stored ?? "").split(";")[0].trim().toLowerCase();
  if (INLINE_TYPES.has(type)) return type;
  if (type.startsWith("text/") || type === "application/json") return "text/plain; charset=utf-8";
  return null;
}
