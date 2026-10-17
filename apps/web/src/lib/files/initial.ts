import "server-only";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { browseFiles } from "@/lib/domain/files";
import { DomainError } from "@/lib/domain/kit";
import type { ListResult, ScopeRef } from "@/lib/files/types";

type SearchParams = Record<string, string | string[] | undefined>;

function str(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

/**
 * The first listing for an explorer page, read from the same URL params the
 * explorer keeps in sync (?folder=, ?view=trash|shared, ?shared=1, ?q=).
 * A folder that's gone or hidden sends the page back to the top with
 * ?missing=1, so the server's first listing always matches the URL.
 */
export async function initialListing(actor: Actor | null, scope: ScopeRef, sp: SearchParams, basePath: string): Promise<{ initial: ListResult; missing: boolean }> {
  const view = str(sp, "view");
  const folder = str(sp, "folder");
  const shared = str(sp, "shared") === "1";
  const q = (str(sp, "q") ?? "").trim().slice(0, 100);
  const missing = str(sp, "missing") === "1";

  try {
    if (view === "shared" && scope.kind === "user") return { initial: await browseFiles(actor, { scope, view: "shared" }), missing };
    if (view === "trash") return { initial: await browseFiles(actor, { scope, view: "trash", tree: true }), missing };
    if (folder && shared) return { initial: await browseFiles(actor, { scope: "auto", parentId: folder, view: "folder" }), missing };
    if (folder && scope.kind === "user") {
      // A link to someone else's folder (shared with this viewer) opens it where it lives.
      const row = await db.fileItem.findUnique({ where: { id: folder }, select: { clubId: true, ownerId: true } });
      if (row && (row.clubId || row.ownerId !== scope.userId)) redirect(`${basePath}?folder=${encodeURIComponent(folder)}&shared=1`);
    }
    if (q) return { initial: await browseFiles(actor, { scope, view: "search", q, parentId: folder, tree: true }), missing };
    return { initial: await browseFiles(actor, { scope, view: "folder", parentId: folder, tree: true }), missing };
  } catch (e) {
    const lost = e instanceof DomainError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN");
    if (lost && (folder || view === "trash")) redirect(`${basePath}?missing=1`);
    throw e;
  }
}
