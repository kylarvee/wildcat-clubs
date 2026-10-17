import { fileKind, FILE_KIND_LABEL, type FileKind } from "@/lib/rich/embeds";
import type { AcceptKind, FileRow } from "@/lib/files/types";

/** Sorting, filtering and labels for file lists. Client-safe. */

export type SortKey = "name" | "modified" | "size" | "type";
export type SortDir = "asc" | "desc";

export const SORT_LABEL: Record<SortKey, string> = { name: "Name", modified: "Date modified", size: "Size", type: "Kind" };

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

type Sortable = Pick<FileRow, "name" | "isFolder" | "mimeType" | "sizeBytes" | "updatedAt">;

export function kindOf(row: Pick<FileRow, "isFolder" | "mimeType" | "name">): FileKind | "folder" {
  return row.isFolder ? "folder" : fileKind(row.mimeType, row.name);
}

export function kindLabel(row: Pick<FileRow, "isFolder" | "mimeType" | "name">): string {
  const k = kindOf(row);
  return k === "folder" ? "Folder" : FILE_KIND_LABEL[k];
}

/** Folders first (like every desktop file manager), then by the chosen column; names break ties. */
export function sortRows<T extends Sortable>(rows: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    let c = 0;
    if (key === "modified") c = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    else if (key === "size") c = (a.sizeBytes ?? -1) - (b.sizeBytes ?? -1);
    else if (key === "type") c = collator.compare(kindLabel(a), kindLabel(b));
    if (c === 0) c = collator.compare(a.name, b.name);
    return c * sign;
  });
}

/** Whether a file fits what a picker asked for. Folders always pass. */
export function matchesAccept(row: Pick<FileRow, "isFolder" | "mimeType" | "name">, accept: AcceptKind | null | undefined): boolean {
  if (row.isFolder || !accept || accept === "any") return true;
  const k = fileKind(row.mimeType, row.name);
  if (accept === "image") return k === "image";
  if (accept === "video") return k === "video";
  return k !== "image" && k !== "video" && k !== "audio";
}

/** The HTML accept attribute for an upload input. */
export function acceptAttr(accept: AcceptKind | null | undefined): string | undefined {
  if (accept === "image") return "image/*";
  if (accept === "video") return "video/*";
  if (accept === "document") return ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md,.json,.zip,application/pdf,text/*";
  return undefined;
}

export const ACCEPT_NOUN: Record<AcceptKind, string> = { any: "files", image: "images", document: "documents", video: "videos" };

/** Type-ahead: the first row at or after `from` whose name starts with `prefix` (wrapping around). */
export function typeAheadIndex(names: string[], prefix: string, from: number): number {
  const p = prefix.toLowerCase();
  if (!p || names.length === 0) return -1;
  for (let i = 0; i < names.length; i++) {
    const idx = (Math.max(0, from) + i) % names.length;
    if (names[idx].toLowerCase().startsWith(p)) return idx;
  }
  return -1;
}
