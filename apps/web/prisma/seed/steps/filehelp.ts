import type { FileVisibility } from "@prisma/client";
import type { Ctx } from "../ctx";
import { makePdf, safeFileName, writeSeedFile, type PdfBlock } from "../lib/assets";

/** FileItem rows plus their bytes on disk (storage/seed/<scope>/…). */

type Scope = { clubId?: string | null; ownerId?: string | null; dir: string };

export function addFolder(ctx: Ctx, scope: Scope, name: string, opts: { parentId?: string | null; visibility?: FileVisibility; createdById: string; createdAt: Date }) {
  const id = ctx.id();
  ctx.rows.files.push({
    id,
    clubId: scope.clubId ?? null,
    ownerId: scope.ownerId ?? null,
    parentId: opts.parentId ?? null,
    isFolder: true,
    name,
    visibility: opts.visibility ?? "INHERIT",
    createdById: opts.createdById,
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
  });
  return id;
}

export function addFile(
  ctx: Ctx,
  scope: Scope,
  name: string,
  bytes: Buffer | string,
  mimeType: string,
  opts: { parentId?: string | null; visibility?: FileVisibility; featured?: boolean; createdById: string; createdAt: Date; diskName?: string },
) {
  const id = ctx.id();
  const disk = opts.diskName ?? safeFileName(name);
  const { storageKey, sizeBytes } = writeSeedFile(`${scope.dir}/${disk}`, bytes);
  ctx.rows.files.push({
    id,
    clubId: scope.clubId ?? null,
    ownerId: scope.ownerId ?? null,
    parentId: opts.parentId ?? null,
    isFolder: false,
    name,
    mimeType,
    sizeBytes,
    storageKey,
    visibility: opts.visibility ?? "INHERIT",
    featured: Boolean(opts.featured),
    createdById: opts.createdById,
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
  });
  return id;
}

export function addPdf(
  ctx: Ctx,
  scope: Scope,
  name: string,
  doc: { title: string; subtitle?: string | null; blocks: PdfBlock[]; footer?: string },
  opts: Parameters<typeof addFile>[5],
) {
  return addFile(ctx, scope, name, makePdf(doc.title, doc.subtitle ?? null, doc.blocks, doc.footer), "application/pdf", opts);
}
