"use client";

import { MAX_UPLOAD_MB } from "@/lib/rich/embeds";

export type UploadScope = "club" | "user" | "university";

export type UploadedFile = { id: string; name: string; mimeType: string | null; url: string };

export type UploadOutcome = { file: UploadedFile; savedTo: UploadScope };

class UploadError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function post(file: File, scope: UploadScope, clubId: string | null, visibility: "PUBLIC" | "INHERIT"): Promise<UploadedFile> {
  const body = new FormData();
  body.set("file", file);
  body.set("scope", scope);
  if (scope === "club" && clubId) body.set("clubId", clubId);
  if (visibility !== "INHERIT") body.set("visibility", visibility);
  let res: Response;
  try {
    res = await fetch("/api/files/upload", { method: "POST", body });
  } catch {
    throw new UploadError("We couldn't reach the server. Check your connection and try again.", 0);
  }
  const json = (await res.json().catch(() => null)) as { ok: boolean; data?: UploadedFile; error?: string } | null;
  if (!res.ok || !json?.ok || !json.data) throw new UploadError(json?.error ?? "That upload didn't go through. Please try again.", res.status);
  return json.data;
}

/**
 * Uploads a file for the editor (images, attached documents) through the
 * normal files API. Files that go into rich text default to PUBLIC so
 * everyone who can read the text sees them. If the writer can't add club
 * files (no `files` capability), the file lands in their own files instead.
 */
export async function uploadForEditor(
  file: File,
  opts: { scope: UploadScope; clubId?: string | null; visibility?: "PUBLIC" | "INHERIT" },
): Promise<UploadOutcome> {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`${file.name} is larger than ${MAX_UPLOAD_MB} MB. Try a smaller file or share a Google Drive link instead.`);
  if (file.size === 0) throw new Error(`${file.name} is empty.`);
  const visibility = opts.visibility ?? "PUBLIC";
  try {
    return { file: await post(file, opts.scope, opts.clubId ?? null, visibility), savedTo: opts.scope };
  } catch (e) {
    if (e instanceof UploadError && e.status === 403 && opts.scope !== "user") {
      return { file: await post(file, "user", null, visibility), savedTo: "user" };
    }
    throw e;
  }
}
