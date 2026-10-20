import "server-only";
import { Prisma, type FileItem, type FileVisibility } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, isAdmin, type ClubAccess } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { notify } from "@/lib/domain/notify";
import { assertSignedIn, conflict, DomainError, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { deleteBytes, guessMime, MAX_UPLOAD_BYTES, putBytes } from "@/lib/files/storage";
import { cleanName, nameProblem, uniqueName } from "@/lib/files/names";
import { matchesAccept, sortRows } from "@/lib/files/listing";
import { audienceIncludes, canSee, resolveVisibility, TOP_LEVEL_DEFAULT, type ViewerFacts } from "@/lib/files/visibility";
import type { AcceptKind, Crumb, FileRow, FileScopeKind, FolderNode, ListResult, ListView, PersonOption, ScopeRef, SharingInfo, Vis } from "@/lib/files/types";
import * as drive from "@/lib/integrations/google-drive";

/**
 * Club Files — the one write path and permission check for files and folders.
 * Every place that shows or links a file (explorer, picker, resources, editor
 * embeds, events, projects, policies, constitutions) checks canViewFile() here.
 *
 * Visibility (INHERIT walks up to the folder; a top-level item defaults to MEMBERS):
 *   Club files       PUBLIC anyone · MEMBERS club members · LEADERS officers+, advisors
 *   Personal files   PUBLIC anyone · MEMBERS any signed-in account · LEADERS owner only
 *   University files PUBLIC anyone · MEMBERS any signed-in account · LEADERS admins only
 * Admins see everything; uploaders always see their own uploads. A FileGrant on
 * an item — or on any folder above it — adds a viewer (or an editor).
 *
 * Who changes what:
 *   manage  = the club's `files` capability · the owner (personal) · admins (university).
 *             Uploads, folders, moves, renames, trash, sharing, featuring, delete forever.
 *   edit    = manage, or an edit grant on the item or a folder above it.
 *             Uploads into, folders, renames, moves and trash within what they can edit.
 * Retired and rejected clubs are read-only (admins excepted).
 *
 * Trash: trashing stamps the item and everything inside it with the same
 * trashedAt, so every other query's `trashedAt: null` filter hides the whole
 * folder at once, and restoring brings back exactly what went in together.
 *
 * Google Drive: when sync is on, writes are mirrored by lib/integrations/google-drive
 * after the response is sent (never blocking, never throwing). Platform storage
 * is the source of truth.
 */

type FileLike = Pick<FileItem, "id" | "clubId" | "ownerId" | "parentId" | "visibility" | "createdById" | "trashedAt">;

const VisibilitySchema = z.enum(["INHERIT", "PUBLIC", "MEMBERS", "LEADERS"]);
const IdList = z.array(z.string().min(1).max(64)).min(1, "Choose at least one item.").max(500, "That's too many items at once.");

// ─── Lineage (one query for any depth) ───────────────────────────────────────

type LineageRow = { id: string; parentId: string | null; visibility: FileVisibility };

/** The item (when it exists) followed by every folder above it, nearest first. */
async function lineage(id: string): Promise<LineageRow[]> {
  return db.$queryRaw<LineageRow[]>`
    WITH RECURSIVE chain AS (
      SELECT id, "parentId", visibility, 0 AS depth FROM "FileItem" WHERE id = ${id}
      UNION ALL
      SELECT f.id, f."parentId", f.visibility, c.depth + 1 FROM "FileItem" f JOIN chain c ON f.id = c."parentId" WHERE c.depth < 32
    )
    SELECT id, "parentId", visibility::text AS visibility FROM chain ORDER BY depth`;
}

function firstSet(rows: { visibility: FileVisibility }[]): Vis {
  for (const r of rows) if (r.visibility !== "INHERIT") return r.visibility;
  return TOP_LEVEL_DEFAULT;
}

type SubtreeRow = { id: string; parentId: string | null; isFolder: boolean; name: string; storageKey: string | null; driveFileId: string | null; trashedAt: Date | null };

/** The items and everything inside them (any depth), in one query. */
async function subtree(ids: string[]): Promise<SubtreeRow[]> {
  if (ids.length === 0) return [];
  return db.$queryRaw<SubtreeRow[]>`
    WITH RECURSIVE sub AS (
      SELECT id, "parentId", "isFolder", name, "storageKey", "driveFileId", "trashedAt", 0 AS depth FROM "FileItem" WHERE id IN (${Prisma.join(ids)})
      UNION ALL
      SELECT f.id, f."parentId", f."isFolder", f.name, f."storageKey", f."driveFileId", f."trashedAt", s.depth + 1 FROM "FileItem" f JOIN sub s ON f."parentId" = s.id WHERE s.depth < 32
    )
    SELECT DISTINCT id, "parentId", "isFolder", name, "storageKey", "driveFileId", "trashedAt" FROM sub`;
}

// ─── Single-item checks (used everywhere a file is shown) ────────────────────

export async function effectiveVisibility(file: FileLike): Promise<Exclude<FileVisibility, "INHERIT">> {
  if (file.visibility !== "INHERIT") return file.visibility;
  if (!file.parentId) return TOP_LEVEL_DEFAULT;
  return firstSet(await lineage(file.parentId));
}

function scopeKindOf(file: { clubId: string | null; ownerId: string | null }): FileScopeKind {
  return file.clubId ? "club" : file.ownerId ? "user" : "university";
}

async function factsFor(actor: Actor | null, clubId: string | null): Promise<ViewerFacts> {
  const access = actor && clubId ? await getClubAccess(actor, clubId) : null;
  return { userId: actor?.id ?? null, admin: isAdmin(actor), member: Boolean(access?.isMember), leader: Boolean(access?.isLeader) };
}

export async function canViewFile(actor: Actor | null, file: FileLike): Promise<boolean> {
  if (isAdmin(actor)) return true;
  if (file.trashedAt) return Boolean(actor && (await canEditFile(actor, file)));
  let chain: LineageRow[] | null = null;
  const above = async () => (chain ??= file.parentId ? await lineage(file.parentId) : []);
  const vis = file.visibility !== "INHERIT" ? file.visibility : firstSet(await above());
  if (vis === "PUBLIC") return true;
  if (!actor) return false;
  if (file.createdById === actor.id) return true;
  if (audienceIncludes(vis, scopeKindOf(file), await factsFor(actor, file.clubId), file.ownerId)) return true;
  const ids = [file.id, ...(await above()).map((r) => r.id)];
  return (await db.fileGrant.count({ where: { userId: actor.id, fileId: { in: ids } } })) > 0;
}

/** Full control over a space: the club's `files` capability, the owner of personal files, admins. */
async function managesSpace(actor: Actor | null, file: { clubId: string | null; ownerId: string | null }): Promise<boolean> {
  if (!actor || actor.status === "DEACTIVATED") return false;
  if (isAdmin(actor)) return true;
  if (file.clubId) return Boolean((await getClubAccess(actor, file.clubId))?.capabilities.has("files"));
  if (file.ownerId) return file.ownerId === actor.id;
  return false;
}

async function clubReadOnly(clubId: string | null): Promise<boolean> {
  if (!clubId) return false;
  const club = await db.club.findUnique({ where: { id: clubId }, select: { status: true } });
  return !club || club.status === "RETIRED" || club.status === "REJECTED";
}

export async function canEditFile(actor: Actor | null, file: Pick<FileItem, "id" | "clubId" | "ownerId">): Promise<boolean> {
  if (!actor || actor.status === "DEACTIVATED") return false;
  if (isAdmin(actor)) return true;
  if (await managesSpace(actor, file)) return true;
  if (await clubReadOnly(file.clubId)) return false;
  const ids = (await lineage(file.id)).map((r) => r.id);
  return (await db.fileGrant.count({ where: { userId: actor.id, canEdit: true, fileId: { in: ids.length ? ids : [file.id] } } })) > 0;
}

export function fileUrl(id: string, download = false) {
  return `/api/files/${id}${download ? "?download=1" : ""}`;
}

// ─── Space context (one load per request, then pure checks per row) ──────────

function scopeWhere(ref: ScopeRef): Prisma.FileItemWhereInput {
  if (ref.kind === "club") return { clubId: ref.clubId };
  if (ref.kind === "user") return { clubId: null, ownerId: ref.userId };
  return { clubId: null, ownerId: null };
}

function scopeOfItem(item: { clubId: string | null; ownerId: string | null }): ScopeRef {
  if (item.clubId) return { kind: "club", clubId: item.clubId };
  if (item.ownerId) return { kind: "user", userId: item.ownerId };
  return { kind: "university" };
}

function sameScope(a: { clubId: string | null; ownerId: string | null }, b: { clubId: string | null; ownerId: string | null }) {
  return a.clubId === b.clubId && (a.clubId ? true : a.ownerId === b.ownerId);
}

type FolderRow = { id: string; name: string; parentId: string | null; visibility: FileVisibility; createdById: string; trashedAt: Date | null };

type Space = {
  ref: ScopeRef;
  kind: FileScopeKind;
  clubId: string | null;
  ownerId: string | null;
  club: { id: string; name: string; slug: string; status: string } | null;
  ownerName: string | null;
  actor: Actor | null;
  facts: ViewerFacts;
  access: ClubAccess | null;
  /** Full control (see the header). False in read-only clubs. */
  manage: boolean;
  writable: boolean;
  /** Every folder in the space, trashed ones included (for names and visibility). */
  folders: Map<string, FolderRow>;
  /** The viewer's grants in this space: item id → can edit. */
  grants: Map<string, boolean>;
  memo: Map<string, Vis>;
};

async function loadSpace(actor: Actor | null, ref: ScopeRef, opts: { foreign?: boolean } = {}): Promise<Space> {
  const admin = isAdmin(actor);
  let club: Space["club"] = null;
  let access: ClubAccess | null = null;
  let ownerName: string | null = null;
  let manage = false;
  let writable = true;

  if (ref.kind === "club") {
    club = await db.club.findUnique({ where: { id: ref.clubId }, select: { id: true, name: true, slug: true, status: true } });
    if (!club) throw notFound("Club");
    access = actor ? await getClubAccess(actor, club.id) : null;
    // Founding clubs are private to their leaders (same rule as their pages).
    const isPublic = club.status === "APPROVED" || club.status === "RETIRED";
    if (!isPublic && !access?.isLeader && !opts.foreign) throw notFound("Club");
    writable = admin || !(club.status === "RETIRED" || club.status === "REJECTED");
    manage = Boolean(access?.capabilities.has("files")) && writable;
  } else if (ref.kind === "user") {
    if (!actor) throw new DomainError("UNAUTHENTICATED", "Please sign in first.");
    if (ref.userId !== actor.id && !admin && !opts.foreign) throw forbidden("Those are someone else's files.");
    manage = ref.userId === actor.id || admin;
    if (ref.userId !== actor.id) ownerName = (await db.user.findUnique({ where: { id: ref.userId }, select: { name: true } }))?.name ?? null;
  } else {
    if (!admin && !opts.foreign) throw forbidden("Only WSUSA administrators can browse university files.");
    manage = admin;
  }
  if (actor?.status === "DEACTIVATED") manage = writable = false;

  const where = scopeWhere(ref);
  const [folders, grants] = await Promise.all([
    db.fileItem.findMany({ where: { ...where, isFolder: true }, select: { id: true, name: true, parentId: true, visibility: true, createdById: true, trashedAt: true } }),
    actor ? db.fileGrant.findMany({ where: { userId: actor.id, file: where }, select: { fileId: true, canEdit: true } }) : Promise.resolve([]),
  ]);

  return {
    ref,
    kind: ref.kind,
    clubId: ref.kind === "club" ? ref.clubId : null,
    ownerId: ref.kind === "user" ? ref.userId : null,
    club,
    ownerName,
    actor,
    facts: { userId: actor?.id ?? null, admin, member: Boolean(access?.isMember), leader: Boolean(access?.isLeader) },
    access,
    manage,
    writable,
    folders: new Map(folders.map((f) => [f.id, f])),
    grants: new Map(grants.map((g) => [g.fileId, g.canEdit])),
    memo: new Map(),
  };
}

function effOf(space: Space, item: { parentId: string | null; visibility: FileVisibility }): Vis {
  if (item.visibility !== "INHERIT") return item.visibility;
  if (!item.parentId) return TOP_LEVEL_DEFAULT;
  return resolveVisibility(item.parentId, (id) => space.folders.get(id), space.memo);
}

/** Grants on the item or any folder above it. */
function grantOn(space: Space, item: { id: string; parentId: string | null }): { view: boolean; edit: boolean } {
  if (space.grants.size === 0) return { view: false, edit: false };
  let view = false;
  let edit = false;
  let current: string | null = item.id;
  let parent: string | null = item.parentId;
  for (let depth = 0; current && depth < 64; depth++) {
    const g = space.grants.get(current);
    if (g !== undefined) {
      view = true;
      if (g) edit = true;
    }
    current = parent;
    parent = current ? (space.folders.get(current)?.parentId ?? null) : null;
  }
  return { view, edit };
}

type Checkable = { id: string; parentId: string | null; visibility: FileVisibility; createdById: string };

function visibleIn(space: Space, item: Checkable): boolean {
  return canSee({ vis: effOf(space, item), kind: space.kind, viewer: space.facts, scopeOwnerId: space.ownerId, createdById: item.createdById, granted: grantOn(space, item).view });
}

function editableIn(space: Space, item: { id: string; parentId: string | null }): boolean {
  if (!space.writable || !space.actor) return false;
  return space.manage || grantOn(space, item).edit;
}

/** Can add to a folder (null = the top level, which needs full control). */
function canAddTo(space: Space, folderId: string | null): boolean {
  if (!folderId) return space.manage;
  const folder = space.folders.get(folderId);
  return Boolean(folder && !folder.trashedAt && editableIn(space, folder));
}

function liveFolder(space: Space, id: string): FolderRow | null {
  const f = space.folders.get(id);
  return f && !f.trashedAt ? f : null;
}

/** Visible folders above (and including) `folderId`, top first. Hidden ones are skipped rather than named. */
function pathTo(space: Space, folderId: string | null): Crumb[] {
  const out: Crumb[] = [];
  let current: string | null = folderId;
  for (let depth = 0; current && depth < 64; depth++) {
    const f = space.folders.get(current);
    if (!f) break;
    if (visibleIn(space, f)) out.unshift({ id: f.id, name: f.name });
    current = f.parentId;
  }
  return out;
}

function spaceLabel(space: Space): string {
  if (space.kind === "club") return space.club?.name ?? "Club files";
  if (space.kind === "user") return space.ownerName ? `${space.ownerName}'s files` : "My files";
  return "University files";
}

function rootCrumb(space: Space): Crumb {
  return { id: null, name: space.kind === "club" ? "Club files" : space.kind === "user" ? (space.ownerName ? `${space.ownerName}'s files` : "My files") : "University files" };
}

function writeGuard(space: Space) {
  assertSignedIn(space.actor);
  if (!space.writable) throw forbidden("This club is retired, so its files are read-only.");
}

// ─── Rows ────────────────────────────────────────────────────────────────────

const ROW_SELECT = {
  id: true,
  name: true,
  isFolder: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  updatedAt: true,
  trashedAt: true,
  parentId: true,
  visibility: true,
  featured: true,
  createdById: true,
  clubId: true,
  ownerId: true,
  driveFileId: true,
  createdBy: { select: { id: true, name: true } },
  _count: { select: { grants: true } },
} satisfies Prisma.FileItemSelect;

type RawRow = Prisma.FileItemGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(space: Space, r: RawRow, extra: Partial<FileRow> = {}): FileRow {
  return {
    id: r.id,
    name: r.name,
    isFolder: r.isFolder,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    trashedAt: r.trashedAt?.toISOString() ?? null,
    // Names of people are for signed-in university accounts only.
    createdBy: space.actor ? r.createdBy : null,
    parentId: r.parentId,
    visibility: r.visibility,
    effective: effOf(space, r),
    featured: r.featured,
    sharedWith: space.manage ? r._count.grants : 0,
    canEdit: editableIn(space, r),
    url: r.isFolder ? null : fileUrl(r.id),
    childCount: null,
    location: null,
    source: null,
    sourceHref: null,
    inDrive: Boolean(r.driveFileId),
    ...extra,
  };
}

function folderLocation(space: Space, parentId: string | null): string {
  const names = pathTo(space, parentId).map((c) => c.name);
  return names.length ? names.join(" / ") : rootCrumb(space).name;
}

/** Items directly inside each folder (managers only — everyone else would be counting things they can't see). */
async function childCounts(space: Space, rows: RawRow[]): Promise<Map<string, number>> {
  const ids = rows.filter((r) => r.isFolder).map((r) => r.id);
  if (!space.manage || ids.length === 0) return new Map();
  const groups = await db.fileItem.groupBy({ by: ["parentId"], where: { parentId: { in: ids }, trashedAt: null }, _count: { _all: true } });
  return new Map(groups.map((g) => [g.parentId as string, g._count._all]));
}

function treeOf(space: Space): FolderNode[] {
  const nodes: FolderNode[] = [];
  for (const f of space.folders.values()) {
    if (f.trashedAt || !visibleIn(space, f)) continue;
    nodes.push({ id: f.id, name: f.name, parentId: f.parentId, effective: effOf(space, f), visibility: f.visibility, canEdit: editableIn(space, f) });
  }
  // A folder whose parent the viewer can't see hangs off the top level instead.
  const shown = new Set(nodes.map((n) => n.id));
  for (const n of nodes) if (n.parentId && !shown.has(n.parentId)) n.parentId = null;
  return nodes;
}

async function topTrashCount(space: Space): Promise<number> {
  if (!space.manage) return 0;
  const rows = await db.fileItem.findMany({ where: { ...scopeWhere(space.ref), trashedAt: { not: null } }, select: { id: true, parentId: true, trashedAt: true } });
  return rows.filter((r) => isTopTrashed(space, r)).length;
}

/** In the trash on its own (not just because its folder was trashed with it). */
function isTopTrashed(space: Space, r: { parentId: string | null; trashedAt: Date | null }) {
  if (!r.trashedAt) return false;
  const parent = r.parentId ? space.folders.get(r.parentId) : null;
  return !parent?.trashedAt || parent.trashedAt.getTime() !== r.trashedAt.getTime();
}

async function availableSpaces(actor: Actor | null, contextClubId: string | null | undefined): Promise<ListResult["available"]> {
  let club = false;
  if (contextClubId) {
    const row = await db.club.findUnique({ where: { id: contextClubId }, select: { status: true } });
    const access = actor ? await getClubAccess(actor, contextClubId) : null;
    club = Boolean(row && (row.status === "APPROVED" || row.status === "RETIRED" || access?.isLeader));
  }
  return { club, user: Boolean(actor), university: isAdmin(actor) };
}

// ─── Browsing ────────────────────────────────────────────────────────────────

export type BrowseRequest = {
  /** "auto" opens a folder wherever it lives (used for folders shared with you). */
  scope: ScopeRef | "auto";
  parentId?: string | null;
  view?: ListView;
  q?: string | null;
  accept?: AcceptKind | null;
  tree?: boolean;
  /** The club a picker was opened for, so it knows whether to offer "Club files". */
  contextClubId?: string | null;
};

const SEARCH_LIMIT = 200;

/** One entry point for the explorer and the picker. Returns only what the viewer may see. */
export async function browseFiles(actor: Actor | null, req: BrowseRequest): Promise<ListResult> {
  const view: ListView = req.view ?? (req.q?.trim() ? "search" : "folder");
  if (view === "shared") return listShared(actor, req);

  let ref: ScopeRef;
  let foreign = false;
  if (req.scope === "auto") {
    if (!req.parentId) throw invalid("Choose a folder to open.");
    const folder = await db.fileItem.findUnique({ where: { id: req.parentId }, select: { clubId: true, ownerId: true } });
    if (!folder) throw notFound("Folder");
    ref = scopeOfItem(folder);
    foreign = true;
  } else {
    ref = req.scope;
  }
  const space = await loadSpace(actor, ref, { foreign });
  const scope = { kind: space.kind, clubId: space.clubId, label: spaceLabel(space) };
  const base = {
    scope,
    view,
    tree: req.tree ? treeOf(space) : null,
    canManage: space.manage,
    trashCount: await topTrashCount(space),
    available: await availableSpaces(actor, req.contextClubId ?? space.clubId),
    truncated: false,
  };

  if (view === "trash") {
    if (!space.manage) throw forbidden("Only people who manage these files can open the trash.");
    const rows = await db.fileItem.findMany({ where: { ...scopeWhere(ref), trashedAt: { not: null } }, select: ROW_SELECT, orderBy: { trashedAt: "desc" } });
    const items = rows.filter((r) => isTopTrashed(space, r)).map((r) => toRow(space, r, { location: folderLocation(space, r.parentId) }));
    return { ...base, folder: null, path: [rootCrumb(space)], items, canUpload: false, q: null };
  }

  if (view === "search") {
    const q = (req.q ?? "").trim().slice(0, 100);
    if (!q) return { ...base, view: "folder", folder: null, path: [rootCrumb(space)], items: [], canUpload: space.manage, q: null };
    const rows = await db.fileItem.findMany({
      where: { ...scopeWhere(ref), trashedAt: null, name: { contains: q, mode: "insensitive" } },
      select: ROW_SELECT,
      orderBy: { updatedAt: "desc" },
      take: SEARCH_LIMIT + 1,
    });
    const visible = rows.filter((r) => visibleIn(space, r) && matchesAccept(r, req.accept));
    const items = visible.slice(0, SEARCH_LIMIT).map((r) => toRow(space, r, { location: folderLocation(space, r.parentId) }));
    return { ...base, folder: null, path: [rootCrumb(space)], items: sortRows(items, "name", "asc"), canUpload: false, q, truncated: rows.length > SEARCH_LIMIT };
  }

  // A folder (or the top level).
  const parentId = req.parentId ?? null;
  if (foreign && !parentId) throw forbidden();
  let folder: ListResult["folder"] = null;
  if (parentId) {
    const f = liveFolder(space, parentId);
    if (!f || !visibleIn(space, f)) throw notFound("Folder");
    folder = { id: f.id, name: f.name, visibility: f.visibility, effective: effOf(space, f), canEdit: editableIn(space, f) };
  }
  const rows = await db.fileItem.findMany({ where: { ...scopeWhere(ref), parentId, trashedAt: null }, select: ROW_SELECT, orderBy: { name: "asc" } });
  const visible = rows.filter((r) => visibleIn(space, r) && matchesAccept(r, req.accept));
  const counts = await childCounts(space, visible);
  const items = visible.map((r) => toRow(space, r, { childCount: r.isFolder ? (counts.get(r.id) ?? (space.manage ? 0 : null)) : null }));
  const path = foreign ? pathTo(space, parentId) : [rootCrumb(space), ...pathTo(space, parentId)];
  return { ...base, folder, path, items, canUpload: canAddTo(space, parentId), q: null };
}

export function listFolder(actor: Actor | null, scope: ScopeRef, parentId: string | null, opts: { accept?: AcceptKind | null; tree?: boolean } = {}) {
  return browseFiles(actor, { scope, parentId, view: "folder", ...opts });
}

export function searchFiles(actor: Actor | null, scope: ScopeRef, q: string, opts: { accept?: AcceptKind | null } = {}) {
  return browseFiles(actor, { scope, q, view: "search", ...opts });
}

/** Everything someone shared with the viewer by name (not in the trash). */
async function listShared(actor: Actor | null, req: BrowseRequest): Promise<ListResult> {
  assertSignedIn(actor);
  const grants = await db.fileGrant.findMany({
    where: { userId: actor.id, file: { trashedAt: null } },
    select: {
      canEdit: true,
      file: { select: { ...ROW_SELECT, club: { select: { name: true, slug: true } }, owner: { select: { name: true } } } },
    },
    take: 300,
  });
  // Nested grants (a folder and something inside it) show once, at the top.
  const granted = new Set(grants.map((g) => g.file.id));
  const items: FileRow[] = [];
  for (const g of grants) {
    const f = g.file;
    const above = f.parentId ? await lineage(f.parentId) : [];
    if (above.some((a) => granted.has(a.id))) continue;
    if (!matchesAccept(f, req.accept)) continue;
    const effective = f.visibility !== "INHERIT" ? f.visibility : firstSet(above);
    const source = f.club ? f.club.name : f.owner ? `${f.owner.name}'s files` : "University files";
    items.push({
      id: f.id,
      name: f.name,
      isFolder: f.isFolder,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
      trashedAt: null,
      createdBy: f.createdBy,
      parentId: f.parentId,
      visibility: f.visibility,
      effective,
      featured: f.featured,
      sharedWith: 0,
      canEdit: g.canEdit && !(await clubReadOnly(f.clubId)),
      url: f.isFolder ? null : fileUrl(f.id),
      childCount: null,
      location: null,
      source,
      sourceHref: f.club ? `/files/clubs/${f.club.slug}` : null,
      inDrive: Boolean(f.driveFileId),
      spaceKind: scopeKindOf(f),
    });
  }
  return {
    scope: { kind: "user", clubId: null, label: "Shared with me" },
    view: "shared",
    folder: null,
    path: [{ id: null, name: "Shared with me" }],
    items: sortRows(items, "name", "asc"),
    tree: null,
    canManage: false,
    canUpload: false,
    trashCount: 0,
    q: null,
    available: await availableSpaces(actor, req.contextClubId),
    truncated: grants.length >= 300,
  };
}

// ─── Default folders ─────────────────────────────────────────────────────────

/** The starting tree every club gets. Names that already exist (or close variants) are left alone. */
export const DEFAULT_CLUB_FOLDERS: { name: string; visibility: FileVisibility; matches: RegExp }[] = [
  { name: "Meeting Minutes", visibility: "INHERIT", matches: /^meeting minutes$/i },
  { name: "Flyers", visibility: "INHERIT", matches: /^flyers\b/i },
  { name: "Resources", visibility: "INHERIT", matches: /^resources$/i },
  { name: "Constitution & Bylaws", visibility: "PUBLIC", matches: /^constitution( & | and )bylaws$/i },
  { name: "Officer Notes", visibility: "LEADERS", matches: /^officer notes$/i },
];

const DEFAULTS_MARKER = "file.default_folders";

/**
 * Creates the club's default folders the first time its files are opened.
 * Runs once per club (an activity row marks it), so folders people delete on
 * purpose don't come back. Retired and rejected clubs are left as they are.
 */
export async function ensureClubFolders(clubId: string): Promise<{ created: string[] }> {
  const club = await db.club.findUnique({ where: { id: clubId }, select: { id: true, status: true, createdById: true } });
  if (!club || club.status === "RETIRED" || club.status === "REJECTED") return { created: [] };
  const done = await db.activityLog.findFirst({ where: { action: DEFAULTS_MARKER, entityType: "club", entityId: clubId }, select: { id: true } });
  if (done) return { created: [] };

  const created = await db.$transaction(async (tx) => {
    // Two leaders opening Files at the same moment shouldn't both create the tree.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`files:${clubId}`}))`;
    const again = await tx.activityLog.findFirst({ where: { action: DEFAULTS_MARKER, entityType: "club", entityId: clubId }, select: { id: true } });
    if (again) return [] as { id: string; name: string }[];
    const existing = await tx.fileItem.findMany({ where: { clubId, parentId: null, isFolder: true }, select: { name: true } });
    const made: { id: string; name: string }[] = [];
    for (const d of DEFAULT_CLUB_FOLDERS) {
      if (existing.some((e) => d.matches.test(e.name.trim()))) continue;
      made.push(await tx.fileItem.create({ data: { clubId, name: d.name, isFolder: true, visibility: d.visibility, createdById: club.createdById }, select: { id: true, name: true } }));
    }
    // The marker only joins the club's feed when it actually made something.
    await logActivity({ actorId: null, action: DEFAULTS_MARKER, entityType: "club", entityId: clubId, clubId: made.length ? clubId : null, data: { created: made.map((m) => m.name) } }, tx);
    return made;
  });
  await drive.mirrorCreated(clubId, created.map((c) => c.id));
  return { created: created.map((c) => c.name) };
}

/** Lazy work when a club's Files opens: default folders, then a small Drive catch-up when sync is on. */
export async function prepareClubFiles(clubId: string) {
  await ensureClubFolders(clubId);
  await drive.backfillClubDrive(clubId);
}

// ─── Writes ──────────────────────────────────────────────────────────────────

async function siblingNames(where: Prisma.FileItemWhereInput, parentId: string | null, exceptIds: string[] = []): Promise<string[]> {
  const rows = await db.fileItem.findMany({ where: { ...where, parentId, trashedAt: null, id: { notIn: exceptIds } }, select: { name: true } });
  return rows.map((r) => r.name);
}

function validName(raw: string): string {
  const problem = nameProblem(raw);
  if (problem) throw invalid(problem);
  return cleanName(raw);
}

/** Loads items for a write: all must exist and share one space. */
async function loadForWrite(actor: Actor | null, ids: string[], opts: { trashed?: boolean } = {}) {
  assertSignedIn(actor);
  const unique = [...new Set(parse(IdList, ids))];
  const items = await db.fileItem.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, isFolder: true, parentId: true, clubId: true, ownerId: true, visibility: true, createdById: true, trashedAt: true, featured: true, driveFileId: true },
  });
  if (items.length !== unique.length) throw notFound(unique.length === 1 ? "That file" : "One of those files");
  const first = items[0];
  if (!items.every((i) => sameScope(i, first))) throw invalid("Those items are in different places. Choose items from one folder area at a time.");
  if (opts.trashed !== undefined && items.some((i) => Boolean(i.trashedAt) !== opts.trashed)) {
    throw invalid(opts.trashed ? "Only items in the trash can be restored or deleted for good." : "Restore it from the trash first.");
  }
  const space = await loadSpace(actor, scopeOfItem(first), { foreign: true });
  writeGuard(space);
  for (const i of items) {
    if (!visibleIn(space, i) && !space.manage) throw notFound("That file");
  }
  return { items, space };
}

function assertEditable(space: Space, item: { id: string; parentId: string | null; name: string }) {
  if (!editableIn(space, item)) throw forbidden(`You can open “${item.name}” but not change it. Ask a club leader with the Files permission.`);
}

export type CreateFolderInput = { scope: ScopeRef; parentId?: string | null; name?: string | null };

export async function createFolder(actor: Actor | null, input: CreateFolderInput) {
  assertSignedIn(actor);
  const parentId = input.parentId || null;
  let ref = input.scope;
  if (ref.kind === "user") ref = { kind: "user", userId: actor.id };
  if (parentId) {
    const parent = await db.fileItem.findUnique({ where: { id: parentId }, select: { clubId: true, ownerId: true, isFolder: true } });
    if (!parent?.isFolder) throw notFound("Folder");
    ref = scopeOfItem(parent);
  }
  const space = await loadSpace(actor, ref, { foreign: Boolean(parentId) });
  writeGuard(space);
  if (!canAddTo(space, parentId)) throw forbidden(parentId ? "You can't add folders here." : "Only people who manage these files can add folders at the top level.");
  const name = uniqueName(validName(input.name?.trim() || "New folder"), await siblingNames(scopeWhere(ref), parentId), true);
  const folder = await db.fileItem.create({
    data: { clubId: space.clubId, ownerId: space.ownerId, parentId, name, isFolder: true, visibility: "INHERIT", createdById: actor.id },
    select: { id: true, name: true },
  });
  await logActivity({ actorId: actor.id, action: "file.folder_created", entityType: "file", entityId: folder.id, clubId: space.clubId, data: { name } });
  await drive.mirrorCreated(space.clubId, [folder.id]);
  return folder;
}

export async function renameItem(actor: Actor | null, id: string, rawName: string) {
  const { items, space } = await loadForWrite(actor, [id], { trashed: false });
  const item = items[0];
  assertEditable(space, item);
  const name = validName(rawName);
  if (name === item.name) return { id: item.id, name };
  const taken = await siblingNames(scopeWhere(space.ref), item.parentId, [item.id]);
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) {
    throw conflict(`There's already something named “${name}” in this folder. Pick another name.`);
  }
  await db.fileItem.update({ where: { id: item.id }, data: { name } });
  await logActivity({ actorId: actor!.id, action: "file.renamed", entityType: "file", entityId: item.id, clubId: space.clubId, data: { from: item.name, to: name } });
  await drive.mirrorRenamed(space.clubId, item.id);
  return { id: item.id, name };
}

export async function moveItems(actor: Actor | null, ids: string[], targetId: string | null) {
  const { items, space } = await loadForWrite(actor, ids, { trashed: false });
  const target = targetId ? liveFolder(space, targetId) : null;
  if (targetId && !target) throw invalid("You can only move items to a folder in the same club or space.");
  if (!canAddTo(space, targetId)) throw forbidden(targetId ? `You can't add items to “${target?.name}”.` : "Only people who manage these files can move items to the top level.");
  for (const item of items) assertEditable(space, item);

  // No folder may go inside itself.
  const above = new Set<string>();
  for (let current = targetId; current; current = space.folders.get(current)?.parentId ?? null) {
    if (above.has(current)) break;
    above.add(current);
  }
  const cycle = items.find((i) => i.isFolder && above.has(i.id));
  if (cycle) throw invalid(`“${cycle.name}” can't go inside itself.`);

  const moving = items.filter((i) => i.parentId !== targetId);
  if (moving.length === 0) return { moved: 0, renamed: [] as { from: string; to: string }[] };
  const taken = await siblingNames(scopeWhere(space.ref), targetId, moving.map((m) => m.id));
  const renamed: { from: string; to: string }[] = [];
  const updates = moving.map((m) => {
    const name = uniqueName(m.name, taken, m.isFolder);
    taken.push(name);
    if (name !== m.name) renamed.push({ from: m.name, to: name });
    return db.fileItem.update({ where: { id: m.id }, data: { parentId: targetId, name } });
  });
  await db.$transaction(updates);
  await logActivity({
    actorId: actor!.id,
    action: "file.moved",
    entityType: "file",
    entityId: moving[0].id,
    clubId: space.clubId,
    data: { ids: moving.map((m) => m.id), names: moving.map((m) => m.name).slice(0, 20), to: target?.name ?? null },
  });
  await drive.mirrorMoved(space.clubId, moving.map((m) => m.id));
  return { moved: moving.length, renamed };
}

export async function setVisibility(actor: Actor | null, id: string, visibility: FileVisibility) {
  const v = parse(VisibilitySchema, visibility);
  const { items, space } = await loadForWrite(actor, [id], { trashed: false });
  const item = items[0];
  if (!space.manage) throw forbidden("Only people who manage these files can change who sees them.");
  if (item.visibility === v) return { id, visibility: v };
  await db.fileItem.update({ where: { id }, data: { visibility: v } });
  await logActivity({ actorId: actor!.id, action: "file.visibility_set", entityType: "file", entityId: id, clubId: space.clubId, data: { name: item.name, from: item.visibility, to: v } });
  await drive.mirrorSharing(space.clubId, id);
  return { id, visibility: v };
}

export async function setFeatured(actor: Actor | null, id: string, featured: boolean) {
  const { items, space } = await loadForWrite(actor, [id], { trashed: false });
  const item = items[0];
  if (space.kind !== "club") throw invalid("Only club files can be shown on a club page.");
  if (item.isFolder) throw invalid("Choose a file to show on the club page — folders can't be featured.");
  if (!space.manage) throw forbidden("Only people who manage club files can change the club page's Resources.");
  if (item.featured === featured) return { id, featured };
  await db.fileItem.update({ where: { id }, data: { featured } });
  await logActivity({ actorId: actor!.id, action: "file.featured_set", entityType: "file", entityId: id, clubId: space.clubId, data: { name: item.name, featured } });
  return { id, featured, effective: effOf(space, item) };
}

export async function grantAccess(actor: Actor | null, fileId: string, input: { userId: string; canEdit: boolean }) {
  const v = parse(z.object({ userId: z.string().min(1), canEdit: z.boolean() }), input);
  const { items, space } = await loadForWrite(actor, [fileId], { trashed: false });
  const item = items[0];
  if (!space.manage) throw forbidden("Only people who manage these files can share them.");
  const person = await db.user.findUnique({ where: { id: v.userId }, select: { id: true, name: true, status: true } });
  if (!person || person.status === "DEACTIVATED") throw notFound("That person");
  if (person.id === space.ownerId) throw invalid(`${person.name} owns these files already.`);
  const existing = await db.fileGrant.findUnique({ where: { fileId_userId: { fileId, userId: person.id } } });
  await db.fileGrant.upsert({
    where: { fileId_userId: { fileId, userId: person.id } },
    create: { fileId, userId: person.id, canEdit: v.canEdit },
    update: { canEdit: v.canEdit },
  });
  await logActivity({ actorId: actor!.id, action: existing ? "file.share_changed" : "file.shared", entityType: "file", entityId: fileId, clubId: space.clubId, data: { name: item.name, userId: person.id, canEdit: v.canEdit } });
  if (!existing) {
    const where = space.club ? ` in ${space.club.name}'s files` : "";
    await notify({
      userIds: [person.id],
      exceptUserId: actor!.id,
      kind: "file.shared",
      title: `${actor!.name} shared “${item.name}” with you`,
      body: `You can ${v.canEdit ? "view and edit" : "view"} this ${item.isFolder ? "folder" : "file"}${where}. Find it under Shared with me in My files.`,
      href: "/files?view=shared",
    });
  }
  await drive.mirrorSharing(space.clubId, fileId);
  return { userId: person.id, canEdit: v.canEdit };
}

export async function revokeAccess(actor: Actor | null, fileId: string, userId: string) {
  const { items, space } = await loadForWrite(actor, [fileId], { trashed: false });
  if (!space.manage) throw forbidden("Only people who manage these files can change sharing.");
  const removed = await db.fileGrant.deleteMany({ where: { fileId, userId } });
  if (removed.count === 0) return { removed: false };
  await logActivity({ actorId: actor!.id, action: "file.unshared", entityType: "file", entityId: fileId, clubId: space.clubId, data: { name: items[0].name, userId } });
  await drive.mirrorSharing(space.clubId, fileId);
  return { removed: true };
}

/** Files other records depend on stay put until those records change. */
async function protectedReason(ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const [doc, policy] = await Promise.all([
    // Current and pending documents only; superseded versions can be cleaned up.
    db.clubDocument.findFirst({ where: { fileId: { in: ids }, status: { in: ["ACTIVE", "PENDING_APPROVAL"] } }, select: { kind: true, file: { select: { name: true } } } }),
    db.policy.findFirst({ where: { documentFileId: { in: ids } }, select: { title: true, documentFile: { select: { name: true } } } }),
  ]);
  if (doc) {
    const what = doc.kind === "OTHER" ? "the club's profile documents" : "the club's constitution and bylaws record";
    return `“${doc.file?.name ?? "A file"}” is part of ${what}, so it can't be trashed or deleted. You can still rename or move it.`;
  }
  if (policy) return `“${policy.documentFile?.name ?? "A file"}” is the document for the policy “${policy.title}”. Change the policy first, then try again.`;
  return null;
}

export async function trashItems(actor: Actor | null, ids: string[]) {
  const { items, space } = await loadForWrite(actor, ids, { trashed: false });
  for (const item of items) assertEditable(space, item);
  const all = (await subtree(items.map((i) => i.id))).filter((r) => !r.trashedAt);
  const reason = await protectedReason(all.filter((r) => !r.isFolder).map((r) => r.id));
  if (reason) throw conflict(reason);
  const at = new Date();
  await db.fileItem.updateMany({ where: { id: { in: all.map((r) => r.id) } }, data: { trashedAt: at } });
  await logActivity({
    actorId: actor!.id,
    action: "file.trashed",
    entityType: "file",
    entityId: items[0].id,
    clubId: space.clubId,
    data: { ids: items.map((i) => i.id), names: items.map((i) => i.name).slice(0, 20), total: all.length },
  });
  await drive.mirrorTrashed(space.clubId, items.map((i) => i.id));
  return { trashed: items.map((i) => i.id), count: items.length };
}

export async function restoreItems(actor: Actor | null, ids: string[]) {
  const { items, space } = await loadForWrite(actor, ids, { trashed: true });
  for (const item of items) assertEditable(space, item);
  const toTop: string[] = [];
  const restored: string[] = [];
  for (const item of items) {
    const parent = item.parentId ? space.folders.get(item.parentId) : null;
    // If its folder is gone or still in the trash, it comes back at the top level.
    const parentId = parent && !parent.trashedAt ? parent.id : null;
    if (item.parentId && !parentId) toTop.push(item.name);
    const together = (await subtree([item.id])).filter((r) => r.trashedAt && item.trashedAt && r.trashedAt.getTime() === item.trashedAt.getTime());
    const name = uniqueName(item.name, await siblingNames(scopeWhere(space.ref), parentId, [item.id]), item.isFolder);
    await db.$transaction([
      db.fileItem.updateMany({ where: { id: { in: together.map((r) => r.id) } }, data: { trashedAt: null } }),
      db.fileItem.update({ where: { id: item.id }, data: { parentId, name } }),
    ]);
    restored.push(item.id);
  }
  await logActivity({ actorId: actor!.id, action: "file.restored", entityType: "file", entityId: items[0].id, clubId: space.clubId, data: { ids: restored, names: items.map((i) => i.name).slice(0, 20) } });
  await drive.mirrorRestored(space.clubId, restored);
  return { restored: restored.length, movedToTop: toTop };
}

/** Deletes trashed items and everything inside them, bytes included. Can't be undone. */
export async function deleteForever(actor: Actor | null, ids: string[]) {
  const { items, space } = await loadForWrite(actor, ids, { trashed: true });
  if (!space.manage) throw forbidden("Only people who manage these files can delete them for good.");
  return purge(actor!, space, items.map((i) => i.id));
}

/** Empties the space's trash, keeping anything other records still depend on. */
export async function emptyTrash(actor: Actor | null, scope: ScopeRef) {
  assertSignedIn(actor);
  const ref: ScopeRef = scope.kind === "user" ? { kind: "user", userId: actor.id } : scope;
  const space = await loadSpace(actor, ref);
  writeGuard(space);
  if (!space.manage) throw forbidden("Only people who manage these files can empty the trash.");
  const rows = await db.fileItem.findMany({ where: { ...scopeWhere(ref), trashedAt: { not: null } }, select: { id: true, parentId: true, trashedAt: true } });
  const top = rows.filter((r) => isTopTrashed(space, r)).map((r) => r.id);
  if (top.length === 0) return { deleted: 0, kept: 0 };
  // Keep protected items (and the folders holding them) instead of failing the whole batch.
  const all = await subtree(top);
  const protectedIds = new Set<string>();
  const docs = await db.clubDocument.findMany({ where: { fileId: { in: all.map((r) => r.id) }, status: { in: ["ACTIVE", "PENDING_APPROVAL"] } }, select: { fileId: true } });
  const policies = await db.policy.findMany({ where: { documentFileId: { in: all.map((r) => r.id) } }, select: { documentFileId: true } });
  for (const d of docs) if (d.fileId) protectedIds.add(d.fileId);
  for (const p of policies) if (p.documentFileId) protectedIds.add(p.documentFileId);
  const byId = new Map(all.map((r) => [r.id, r]));
  const blockedTop = new Set<string>();
  for (const id of protectedIds) {
    let current: string | null = id;
    while (current) {
      if (top.includes(current)) blockedTop.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
  }
  const deletable = top.filter((id) => !blockedTop.has(id));
  const result = deletable.length ? await purge(actor, space, deletable) : { deleted: 0 };
  return { deleted: result.deleted, kept: blockedTop.size };
}

async function purge(actor: Actor, space: Space, topIds: string[]) {
  const all = await subtree(topIds);
  const reason = await protectedReason(all.filter((r) => !r.isFolder).map((r) => r.id));
  if (reason) throw conflict(reason);
  const names = all.filter((r) => topIds.includes(r.id)).map((r) => r.name);
  await db.fileItem.deleteMany({ where: { id: { in: all.map((r) => r.id) } } });
  // Bytes go too, unless another row still points at the same stored copy.
  const keys = [...new Set(all.map((r) => r.storageKey).filter((k): k is string => Boolean(k)))];
  const stillUsed = keys.length
    ? new Set((await db.fileItem.findMany({ where: { storageKey: { in: keys } }, select: { storageKey: true } })).map((r) => r.storageKey))
    : new Set<string | null>();
  await Promise.all(keys.filter((k) => !stillUsed.has(k)).map((k) => deleteBytes(k)));
  await logActivity({ actorId: actor.id, action: "file.deleted", entityType: "file", entityId: topIds[0], clubId: space.clubId, data: { names: names.slice(0, 20), total: all.length } });
  await drive.mirrorDeleted(space.clubId, all.filter((r) => r.driveFileId).map((r) => r.driveFileId!));
  return { deleted: topIds.length };
}

// ─── Sharing details ─────────────────────────────────────────────────────────

/** What the "Share & permissions" dialog shows. Managers only. */
export async function sharingInfo(actor: Actor | null, id: string): Promise<SharingInfo> {
  const { items, space } = await loadForWrite(actor, [id], { trashed: false });
  const item = items[0];
  if (!space.manage) throw forbidden("Only people who manage these files can see and change sharing.");
  const grants = await db.fileGrant.findMany({
    where: { fileId: id },
    select: { canEdit: true, user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } } },
    orderBy: { user: { name: "asc" } },
  });
  let inheritedFrom: string | null = null;
  for (let current = item.parentId; current; current = space.folders.get(current)?.parentId ?? null) {
    const f = space.folders.get(current);
    if (!f) break;
    if (f.visibility !== "INHERIT") {
      inheritedFrom = f.name;
      break;
    }
  }
  return {
    id: item.id,
    name: item.name,
    isFolder: item.isFolder,
    scopeKind: space.kind,
    visibility: item.visibility,
    effective: effOf(space, item),
    inherited: item.parentId ? resolveVisibility(item.parentId, (k) => space.folders.get(k), space.memo) : TOP_LEVEL_DEFAULT,
    inheritedFrom,
    featured: item.featured,
    canFeature: space.kind === "club" && !item.isFolder,
    grants: grants.map((g) => ({ userId: g.user.id, name: g.user.name, email: g.user.email, avatarUrl: g.user.avatarUrl, avatarColor: g.user.avatarColor, canEdit: g.canEdit })),
    url: item.isFolder ? "" : fileUrl(item.id),
  };
}

/** People to share an item with: club members first for club files. Managers only. */
export async function searchPeopleToShare(actor: Actor | null, fileId: string, rawQ: string): Promise<PersonOption[]> {
  const { space } = await loadForWrite(actor, [fileId]);
  if (!space.manage) throw forbidden();
  const q = rawQ.trim().slice(0, 80);
  if (q.length < 2) return [];
  const people = await db.user.findMany({
    where: { status: { not: "DEACTIVATED" }, id: { not: actor!.id }, OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] },
    select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true, kind: true },
    orderBy: { name: "asc" },
    take: 25,
  });
  let notes = new Map<string, string>();
  if (space.clubId && people.length) {
    const [members, roles] = await Promise.all([
      db.membership.findMany({ where: { clubId: space.clubId, status: "ACTIVE", userId: { in: people.map((p) => p.id) } }, select: { userId: true } }),
      db.roleAssignment.findMany({ where: { clubId: space.clubId, endedAt: null, userId: { in: people.map((p) => p.id) } }, select: { userId: true, role: true } }),
    ]);
    notes = new Map(members.map((m) => [m.userId, "Member"]));
    for (const r of roles) notes.set(r.userId, r.role === "ADVISOR" ? "Advisor" : r.role === "MEMBER" ? "Member" : "Leader");
  }
  const ranked = [...people].sort((a, b) => Number(notes.has(b.id)) - Number(notes.has(a.id)));
  return ranked.slice(0, 8).map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    avatarUrl: p.avatarUrl,
    avatarColor: p.avatarColor,
    note: notes.get(p.id) ?? (space.clubId ? "Not in this club" : p.kind === "STUDENT" ? "Student" : "Faculty & staff"),
  }));
}

// ─── Uploads ─────────────────────────────────────────────────────────────────

export type UploadInput = {
  /** Its extension sets the stored type (lib/files/storage guessMime); the browser's claimed type is not used. */
  name: string;
  bytes: Buffer;
  /** "club" needs clubId; "user" = the uploader's own files; "university" = admins only. */
  scope: "club" | "user" | "university";
  clubId?: string | null;
  parentId?: string | null;
  visibility?: FileVisibility;
};

/**
 * Upload a file into a scope. Club uploads need the `files` capability — except
 * logo uploads, which callers make with `profile`, and event cover images,
 * made with `events` (opts.capability; the upload route allows only images). People with
 * an edit grant on a folder may upload into that folder. Same-named files in a
 * folder get " (2)" added rather than replacing each other.
 */
export async function uploadFile(actor: Actor | null, input: UploadInput, opts: { capability?: "files" | "profile" | "events" } = {}) {
  assertSignedIn(actor);
  const visibility = parse(VisibilitySchema.optional(), input.visibility ?? undefined) ?? "INHERIT";
  if (input.bytes.length === 0) throw invalid("That file is empty.");
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw invalid("Files can be up to 25 MB.");
  const baseName = cleanName(input.name) || "Untitled";

  let clubId: string | null = null;
  let ownerId: string | null = null;
  let parentId: string | null = input.parentId || null;
  let allowed = false;

  if (input.scope === "club") {
    if (!input.clubId) throw invalid("Missing club.");
    const access = await getClubAccess(actor, input.clubId);
    if (!access) throw notFound("Club");
    clubId = input.clubId;
    allowed = access.capabilities.has(opts.capability ?? "files");
    if (!allowed && access.suspended && !parentId) throw forbidden("Your leadership permissions are paused until you finish your overdue WSUSA requirement.");
  } else if (input.scope === "user") {
    ownerId = actor.id;
    allowed = true;
  } else {
    allowed = isAdmin(actor);
  }

  if (parentId) {
    const parent = await db.fileItem.findUnique({ where: { id: parentId }, select: { id: true, isFolder: true, clubId: true, ownerId: true, trashedAt: true } });
    if (!parent?.isFolder || parent.trashedAt) throw invalid("That folder isn't available anymore. Refresh and try again.");
    // A grant editor uploading into someone else's personal folder: the file joins that space.
    if (input.scope === "user" && parent.ownerId && parent.ownerId !== actor.id && !parent.clubId) ownerId = parent.ownerId;
    if (parent.clubId !== clubId || parent.ownerId !== ownerId) throw invalid("That folder isn't in the same place.");
    const foreignPersonal = ownerId !== null && ownerId !== actor.id;
    if (!allowed || foreignPersonal) allowed = await canEditFile(actor, { id: parent.id, clubId: parent.clubId, ownerId: parent.ownerId });
  }
  if (!allowed) throw forbidden(clubId ? "You don't have permission to add club files here." : "You don't have permission to add files here.");
  if (clubId && !isAdmin(actor) && (await clubReadOnly(clubId))) throw forbidden("This club is retired, so its files are read-only.");

  const where: Prisma.FileItemWhereInput = clubId ? { clubId } : { clubId: null, ownerId };
  const name = uniqueName(baseName, await siblingNames(where, parentId), false);
  const storageKey = await putBytes(name, input.bytes);
  const file = await db.fileItem.create({
    data: {
      clubId,
      ownerId,
      parentId,
      name,
      mimeType: guessMime(name),
      sizeBytes: input.bytes.length,
      storageKey,
      visibility,
      createdById: actor.id,
    },
  });
  await logActivity({ actorId: actor.id, action: "file.uploaded", entityType: "file", entityId: file.id, clubId, data: { name: file.name } });
  await drive.mirrorCreated(clubId, [file.id]);
  return file;
}
