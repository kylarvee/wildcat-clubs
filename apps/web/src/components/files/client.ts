"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_UPLOAD_MB } from "@/lib/rich/embeds";
import type { AcceptKind, ApiResponse, ListResult, ListView, UploadedFile } from "@/lib/files/types";
import type { ClientScope } from "@/components/files/actions";

/** Browser helpers for Club Files: list fetching and uploads with progress. */

export type ListQuery = {
  scope: ClientScope | "auto";
  parentId: string | null;
  view: ListView;
  q: string | null;
  accept?: AcceptKind | null;
  tree?: boolean;
  /** For the picker: the club it was opened for. */
  contextClubId?: string | null;
};

export function listUrl(query: ListQuery): string {
  const p = new URLSearchParams();
  if (query.scope === "auto") p.set("scope", "auto");
  else {
    p.set("scope", query.scope.kind);
    if (query.scope.kind === "club") p.set("clubId", query.scope.clubId);
  }
  if (query.contextClubId && !p.has("clubId")) p.set("clubId", query.contextClubId);
  if (query.parentId) p.set("parentId", query.parentId);
  if (query.view !== "folder") p.set("view", query.view);
  if (query.q) p.set("q", query.q);
  if (query.accept && query.accept !== "any") p.set("accept", query.accept);
  if (query.tree) p.set("tree", "1");
  return `/api/files/list?${p.toString()}`;
}

export async function fetchList(query: ListQuery, signal?: AbortSignal): Promise<ListResult> {
  let res: Response;
  try {
    res = await fetch(listUrl(query), { signal, cache: "no-store" });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new Error("We couldn't reach the server. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => null)) as ApiResponse<ListResult> | null;
  if (!json) throw new Error("Something went wrong loading these files. Please try again.");
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

/**
 * Loads a listing for `query` and reloads when it changes. `initial` (from the
 * server render) is used when it matches the first query, so pages don't flash.
 */
export function useFileList(query: ListQuery, initial?: ListResult | null) {
  const key = listUrl(query);
  const [state, setState] = useState<{ key: string; data: ListResult | null; error: string | null }>(() => ({ key: initial ? key : "", data: initial ?? null, error: null }));
  const [loading, setLoading] = useState(!initial);
  const [nonce, setNonce] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const firstKey = useRef(initial ? key : null);

  useEffect(() => {
    // The server already rendered the first listing.
    if (firstKey.current === key && nonce === 0) {
      firstKey.current = null;
      return;
    }
    firstKey.current = null;
    const ctrl = new AbortController();
    setLoading(true);
    fetchList(queryRef.current, ctrl.signal)
      .then((data) => setState({ key, data, error: null }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState((s) => ({ key, data: s.key === key ? s.data : null, error: e.message }));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, stale: state.key !== key, error: state.error, loading, reload };
}

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export type UploadTarget = { scope: ClientScope; parentId: string | null; visibility?: "INHERIT" | "PUBLIC" | "MEMBERS" | "LEADERS" };

/** Why a file can't be uploaded, before sending it. */
export function uploadProblem(file: File): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is larger than ${MAX_UPLOAD_MB} MB. Try a smaller file, or share a Google Drive link instead.`;
  return null;
}

/** Uploads through /api/files/upload, reporting progress (0–1). XHR because fetch can't report upload progress. */
export function uploadWithProgress(file: File, target: UploadTarget, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const problem = uploadProblem(file);
    if (problem) return reject(new Error(problem));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files/upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      const json = xhr.response as ApiResponse<UploadedFile> | null;
      if (json?.ok) resolve(json.data);
      else if (xhr.status === 413) reject(new Error(`${file.name} is too large to upload.`));
      else reject(new Error(json && !json.ok ? json.error : "That upload didn't go through. Please try again."));
    };
    xhr.onerror = () => reject(new Error("We couldn't reach the server. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    const body = new FormData();
    body.set("file", file);
    body.set("scope", target.scope.kind);
    if (target.scope.kind === "club") body.set("clubId", target.scope.clubId);
    if (target.parentId) body.set("parentId", target.parentId);
    if (target.visibility && target.visibility !== "INHERIT") body.set("visibility", target.visibility);
    xhr.send(body);
  });
}

/** Files from a drop, skipping folders (the browser hands them over as empty "files"). */
export function filesFromDrop(dt: DataTransfer): { files: File[]; skippedFolders: number } {
  const files: File[] = [];
  let skippedFolders = 0;
  const items = Array.from(dt.items ?? []);
  if (items.length) {
    for (const item of items) {
      if (item.kind !== "file") continue;
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }).webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        skippedFolders++;
        continue;
      }
      const f = item.getAsFile();
      if (f) files.push(f);
    }
    return { files, skippedFolders };
  }
  return { files: Array.from(dt.files ?? []), skippedFolders };
}

export const INTERNAL_DRAG_TYPE = "application/x-wildcat-files";

export function isInternalDrag(dt: DataTransfer | null) {
  return Boolean(dt && Array.from(dt.types).includes(INTERNAL_DRAG_TYPE));
}

export function isFileDrag(dt: DataTransfer | null) {
  return Boolean(dt && Array.from(dt.types).includes("Files") && !isInternalDrag(dt));
}

/** Per-viewer conveniences (view mode, sort). Storage can be missing or blocked, so every access is guarded. */
export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage: the setting just won't stick.
  }
}
