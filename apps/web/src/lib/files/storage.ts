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
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

export function guessMime(name: string, fallback?: string | null) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? fallback ?? "application/octet-stream";
}
