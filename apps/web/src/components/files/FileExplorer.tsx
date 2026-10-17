"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  ArrowDownUp, Check, ChevronRight, Download, Eye, ExternalLink, Folder, FolderInput, FolderOpen, FolderPlus, FolderTree as FolderTreeIcon, Grid2x2, Keyboard,
  LayoutList, Link2, Loader2, MoreHorizontal, Pencil, RefreshCw, RotateCcw, Search, Share2, Trash2, Upload, Users, X, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { Callout, EmptyState, Skeleton } from "@/components/ui/layout";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/misc";
import { FolderTree, type TreeDrop } from "@/components/files/FolderTree";
import { GridItems, ListHeader, ListItems, type ItemHandlers } from "@/components/files/ExplorerItems";
import { IS_MAC, MenuEntries, modKey, type MenuEntry } from "@/components/files/ItemMenu";
import { MoveDialog } from "@/components/files/MoveDialog";
import { PreviewDialog } from "@/components/files/PreviewDialog";
import { ShareDialog } from "@/components/files/ShareDialog";
import { UploadPanel, useUploadQueue } from "@/components/files/UploadQueue";
import { acceptAttr, SORT_LABEL, sortRows, typeAheadIndex, type SortDir, type SortKey } from "@/lib/files/listing";
import { visCopy } from "@/lib/files/visibility";
import type { Crumb, FileRow, FolderNode, ListResult, ListView, ScopeInfo } from "@/lib/files/types";
import {
  createFolderAction, deleteForeverAction, emptyTrashAction, moveItemsAction, renameItemAction, restoreItemsAction, setFeaturedAction, trashItemsAction, type ClientScope,
} from "@/components/files/actions";
import { filesFromDrop, INTERNAL_DRAG_TYPE, isFileDrag, isInternalDrag, readPref, useFileList, writePref, type ListQuery, type UploadTarget } from "@/components/files/client";

/**
 * Club Files explorer: a desktop-style file manager over a club's files, a
 * person's own files or university files. Left folder tree, breadcrumbs,
 * toolbar, list or grid view, multi-select, drag and drop (upload from the
 * desktop, move onto folders), right-click menus and keyboard quick-nav.
 * Everything it shows comes from /api/files/list, which returns only what
 * the viewer may see; every change goes through lib/domain/files.
 *
 * The location lives in the URL (?folder=, ?view=trash|shared, ?q=), so the
 * browser's Back button and shared links work.
 */

export type ExplorerProps = {
  scope: ClientScope;
  /** The server-rendered first listing (must match the URL it was rendered for). */
  initial: ListResult;
  /** Where links to a folder point (for "Copy link"): `${folderLinkBase}?folder=<id>`. */
  folderLinkBase: string;
  /** Other file areas to jump to (My files ↔ University files). */
  links?: { label: string; href: string; icon: "home" | "university" | "club" }[];
  /** Shown under the sidebar (e.g. the Google Drive status). */
  sidebarNote?: ReactNode;
  /** Shown above the items when the viewer can't change anything here. */
  readOnlyNote?: ReactNode;
};

type Loc = { view: ListView; parentId: string | null; shared: boolean; q: string };

function readLoc(sp: URLSearchParams | null): Loc {
  const v = sp?.get("view");
  return {
    view: v === "trash" || v === "shared" ? v : "folder",
    parentId: sp?.get("folder") || null,
    shared: sp?.get("shared") === "1",
    q: (sp?.get("q") ?? "").slice(0, 100),
  };
}

function locHref(pathname: string, loc: Loc) {
  const p = new URLSearchParams();
  if (loc.view !== "folder") p.set("view", loc.view);
  if (loc.parentId && loc.view === "folder") p.set("folder", loc.parentId);
  if (loc.shared && loc.parentId && loc.view === "folder") p.set("shared", "1");
  if (loc.q && loc.view === "folder") p.set("q", loc.q);
  const s = p.toString();
  return s ? `${pathname}?${s}` : pathname;
}

function toClientScope(info: ScopeInfo, fallback: ClientScope): ClientScope {
  if (info.kind === "club" && info.clubId) return { kind: "club", clubId: info.clubId };
  if (info.kind === "university") return { kind: "university" };
  if (info.kind === "user") return fallback.kind === "user" ? fallback : { kind: "user" };
  return fallback;
}

const SORT_KEYS: SortKey[] = ["name", "modified", "size", "type"];
const VIEW_PREF = "wc.files.view";
const SORT_PREF = "wc.files.sort";

const NETWORK_ERROR = "We couldn't reach the server. Check your connection and try again.";

/** Runs a server action, turning failures into a toast. Returns the data, or null when it failed. */
async function run<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T | null> {
  try {
    const r = await fn();
    if (r.ok) return r.data;
    toast.error(r.error);
  } catch {
    toast.error(NETWORK_ERROR);
  }
  return null;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function FileExplorer({ scope, initial, folderLinkBase, links, sidebarNote, readOnlyNote }: ExplorerProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const uid = useId();
  const searchId = `${uid}-search`;
  const hintId = `${uid}-keys`;
  const loc = useMemo(() => readLoc(searchParams), [searchParams]);
  const searching = loc.view === "folder" && Boolean(loc.q);
  const auto = loc.view === "folder" && loc.shared && Boolean(loc.parentId);

  const query: ListQuery = useMemo(
    () => ({
      scope: auto ? "auto" : scope,
      parentId: loc.view === "folder" ? loc.parentId : null,
      view: searching ? "search" : loc.view,
      q: searching ? loc.q : null,
      tree: !auto && loc.view !== "shared",
    }),
    [auto, scope, loc, searching],
  );
  const { data, stale, error, loading, reload } = useFileList(query, initial);

  // The side tree survives views that don't send one (shared, folders shared with you).
  const [tree, setTree] = useState<FolderNode[]>(initial.tree ?? []);
  useEffect(() => {
    if (data?.tree) setTree(data.tree);
  }, [data?.tree]);
  const [canManageSpace, setCanManageSpace] = useState(initial.canManage);
  const [trashCount, setTrashCount] = useState(initial.trashCount);
  useEffect(() => {
    if (data && !auto && data.view !== "shared") {
      setCanManageSpace(data.canManage);
      setTrashCount(data.trashCount);
    }
  }, [data, auto]);

  const spaceKind = initial.scope.kind;
  const rootLabel = initial.path[0]?.name ?? initial.scope.label;
  const kind = data?.scope.kind ?? spaceKind;
  const trash = loc.view === "trash";
  const sharedView = loc.view === "shared";
  const writableHere = Boolean(data?.canUpload) && !trash && !sharedView && !searching;

  // ─── Preferences (per browser) ───────────────────────────────────────────
  const [mode, setMode] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  useEffect(() => {
    setMode(readPref(VIEW_PREF, ["list", "grid"] as const, "list"));
    const [k, d] = readPref(SORT_PREF, SORT_KEYS.flatMap((key) => [`${key}:asc`, `${key}:desc`]), "name:asc").split(":");
    setSort({ key: k as SortKey, dir: d as SortDir });
  }, []);
  function chooseMode(m: "list" | "grid") {
    setMode(m);
    writePref(VIEW_PREF, m);
  }
  function chooseSort(key: SortKey, dir?: SortDir) {
    const next = { key, dir: dir ?? (sort.key === key ? (sort.dir === "asc" ? "desc" : "asc") : key === "name" || key === "type" ? "asc" : "desc") } as const;
    setSort(next);
    writePref(SORT_PREF, `${next.key}:${next.dir}`);
  }

  // ─── Search box (debounced into the URL) ─────────────────────────────────
  const [searchText, setSearchText] = useState(loc.q);
  const searchRef = useRef<HTMLInputElement>(null);
  const pushedQ = useRef(loc.q);
  useEffect(() => {
    // Only when the URL changed on its own (Back, a link); not echoes of typing.
    if (loc.q !== pushedQ.current) {
      pushedQ.current = loc.q;
      setSearchText(loc.q);
    }
  }, [loc.q]);
  const clientFilter = trash || sharedView;
  useEffect(() => {
    if (clientFilter) return;
    const q = searchText.trim();
    if (q === loc.q) return;
    const t = setTimeout(() => {
      pushedQ.current = q;
      window.history.replaceState(null, "", locHref(pathname, { ...loc, view: "folder", q }));
    }, 300);
    return () => clearTimeout(t);
  }, [searchText, clientFilter, loc, pathname]);

  const rows = useMemo(() => {
    let list = data?.items ?? [];
    const q = searchText.trim().toLowerCase();
    if (clientFilter && q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    return sortRows(list, sort.key, sort.dir);
  }, [data?.items, searchText, clientFilter, sort]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // ─── Navigation ──────────────────────────────────────────────────────────
  /** Keyboard users keep their place: after opening a folder (or going up), focus lands in the new list. */
  const focusAfterLoad = useRef<{ want: boolean; id: string | null }>({ want: false, id: null });

  const go = useCallback(
    (next: Partial<Loc>, opts: { replace?: boolean; focusId?: string | null } = {}) => {
      const target: Loc = { view: "folder", parentId: null, shared: false, q: "", ...next };
      const href = locHref(pathname, target);
      const active = typeof document !== "undefined" ? document.activeElement : null;
      if (active && (active === document.body || paneRef.current?.contains(active))) focusAfterLoad.current = { want: true, id: opts.focusId ?? null };
      if (opts.replace) window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
    },
    [pathname],
  );

  // ─── Selection & focus ───────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const paneRef = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(false);

  const locKey = locHref(pathname, loc);
  const [prevLocKey, setPrevLocKey] = useState(locKey);
  const [prevView, setPrevView] = useState(loc.view);
  if (prevLocKey !== locKey) {
    // A new place: start fresh (adjusting state during render avoids a flash of the old selection).
    setPrevLocKey(locKey);
    setSelected(new Set());
    setAnchorId(null);
    setFocusId(null);
    if (prevView !== loc.view) {
      // The list filter in Trash / Shared doesn't carry over to another view.
      setPrevView(loc.view);
      setSearchText(loc.q);
    }
  }

  // Forget selected items that disappeared (moved, trashed, deleted elsewhere).
  useEffect(() => {
    setSelected((s) => {
      const kept = [...s].filter((id) => byId.has(id));
      return kept.length === s.size ? s : new Set(kept);
    });
  }, [byId]);

  useEffect(() => {
    if (!wantFocus.current || !focusId) return;
    wantFocus.current = false;
    const el = itemRefs.current.get(focusId);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  }, [focusId]);

  /** Puts keyboard focus back on an item after a rename or a menu closes. */
  const focusItem = useCallback((id: string | null) => {
    if (!id) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      // Leave focus alone if something else (a dialog, the rename box) took it.
      if (active && active !== document.body && (!paneRef.current?.contains(active) || active.matches("input, textarea, select"))) return;
      itemRefs.current.get(id)?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (!focusAfterLoad.current.want || !data || stale || loading) return;
    const wanted = focusAfterLoad.current.id;
    focusAfterLoad.current = { want: false, id: null };
    const id = wanted && rows.some((r) => r.id === wanted) ? wanted : (rows[0]?.id ?? null);
    if (!id) {
      paneRef.current?.focus();
      return;
    }
    if (wanted === id) setSelected(new Set([id]));
    wantFocus.current = true;
    setFocusId(id);
    requestAnimationFrame(() => itemRefs.current.get(id)?.focus({ preventScroll: true }));
  }, [data, stale, loading, rows]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  function selectOnly(id: string) {
    setSelected(new Set([id]));
    setAnchorId(id);
    setFocusId(id);
  }

  function selectRange(toId: string, additive: boolean) {
    const from = anchorId && byId.has(anchorId) ? anchorId : toId;
    const a = rows.findIndex((r) => r.id === from);
    const b = rows.findIndex((r) => r.id === toId);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const range = rows.slice(lo, hi + 1).map((r) => r.id);
    setSelected((s) => new Set(additive ? [...s, ...range] : range));
    setFocusId(toId);
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchorId(id);
    setFocusId(id);
  }

  // ─── Dialog state ────────────────────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const pendingRename = useRef<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "delete"; ids: string[] } | { kind: "empty" }>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // After "New folder", start renaming it as soon as it appears.
  useEffect(() => {
    if (pendingRename.current && byId.has(pendingRename.current)) {
      const id = pendingRename.current;
      pendingRename.current = null;
      setSelected(new Set([id]));
      setFocusId(id);
      setRenamingId(id);
    }
  }, [byId]);

  // ─── Uploads ─────────────────────────────────────────────────────────────
  const reloadSoon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (reloadSoon.current) clearTimeout(reloadSoon.current);
    reloadSoon.current = setTimeout(reload, 350);
  }, [reload]);
  const uploads = useUploadQueue({ onUploaded: scheduleReload });
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTo = useRef<{ parentId: string | null; label: string }>({ parentId: null, label: "" });

  const currentScope: ClientScope = data ? toClientScope(data.scope, scope) : scope;
  const currentFolderId = loc.view === "folder" && !searching ? loc.parentId : null;
  const currentFolderName = data?.folder?.name ?? rootLabel;

  function startUpload(files: File[], parentId: string | null, label: string) {
    if (!files.length) return;
    const target: UploadTarget = { scope: currentScope, parentId };
    uploads.enqueue(files, target, label);
  }

  function pickFiles(parentId: string | null, label: string) {
    uploadTo.current = { parentId, label };
    fileInput.current?.click();
  }

  // ─── Actions ─────────────────────────────────────────────────────────────
  const absolute = (path: string) => (typeof window === "undefined" ? path : new URL(path, window.location.origin).toString());

  function linkFor(row: FileRow) {
    if (!row.isFolder) return absolute(row.url ?? `/api/files/${row.id}`);
    if (auto || sharedView) return absolute(`/files?folder=${row.id}&shared=1`);
    return absolute(`${folderLinkBase}?folder=${row.id}`);
  }

  async function copyLink(row: FileRow) {
    try {
      await navigator.clipboard.writeText(linkFor(row));
      toast.success("Link copied", { description: "It opens only for people who can see it." });
    } catch {
      toast.error("Your browser blocked copying. Open the item and copy the address bar instead.");
    }
  }

  function download(list: FileRow[]) {
    const files = list.filter((r) => !r.isFolder && r.url);
    files.forEach((f, i) => {
      // Spaced out so the browser doesn't treat several downloads as one blocked popup.
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = `${f.url}?download=1`;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 350);
    });
  }

  function open(row: FileRow) {
    if (trash) {
      if (row.isFolder) toast.info("Restore this folder to open it.");
      else setPreviewId(row.id);
      return;
    }
    if (row.isFolder) go({ parentId: row.id, shared: auto || sharedView });
    else setPreviewId(row.id);
  }

  async function newFolder(parentId: string | null) {
    setBusy(true);
    const made = await run(() => createFolderAction(currentScope, parentId));
    setBusy(false);
    if (!made) return;
    if (parentId !== currentFolderId) {
      toast.success(`Added “${made.name}”`);
      reload();
      return;
    }
    pendingRename.current = made.id;
    reload();
  }

  async function rename(row: FileRow, name: string) {
    setRenamingId(null);
    focusItem(row.id);
    const r = await run(() => renameItemAction(row.id, name));
    if (r) {
      if (r.name !== row.name) toast.success(`Renamed to “${r.name}”`);
      reload();
    }
  }

  async function move(ids: string[], targetId: string | null): Promise<boolean> {
    const targetName = targetId ? (tree.find((n) => n.id === targetId)?.name ?? "the folder") : rootLabel;
    const r = await run(() => moveItemsAction(ids, targetId));
    if (!r) return false;
    if (r.moved) {
      toast.success(`Moved ${r.moved === 1 ? `“${byId.get(ids[0])?.name ?? "1 item"}”` : plural(r.moved, "item")} to ${targetName}`, {
        description: r.renamed.length ? `Renamed to avoid a clash: ${r.renamed.map((x) => `“${x.to}”`).join(", ")}` : undefined,
      });
    }
    setSelected(new Set());
    reload();
    return true;
  }

  async function trashItems(list: FileRow[]) {
    const ids = list.map((r) => r.id);
    if (!ids.length) return;
    const r = await run(() => trashItemsAction(ids));
    if (!r) return;
    setSelected(new Set());
    reload();
    toast.success(r.count === 1 ? `Moved “${list[0].name}” to the trash` : `Moved ${plural(r.count, "item")} to the trash`, {
      action: {
        label: "Undo",
        onClick: async () => {
          const back = await run(() => restoreItemsAction(ids));
          if (back) {
            toast.success("Restored");
            reload();
          }
        },
      },
    });
  }

  async function restore(list: FileRow[]) {
    const r = await run(() => restoreItemsAction(list.map((x) => x.id)));
    if (!r) return;
    setSelected(new Set());
    reload();
    toast.success(r.restored === 1 ? `Restored “${list[0].name}”` : `Restored ${plural(r.restored, "item")}`, {
      description: r.movedToTop.length ? `Its folder is gone, so ${r.movedToTop.length === 1 ? "it's" : "they're"} back at the top level of ${rootLabel}.` : undefined,
    });
  }

  async function deleteForever(ids: string[]) {
    setBusy(true);
    const r = await run(() => deleteForeverAction(ids));
    setBusy(false);
    if (!r) return;
    setSelected(new Set());
    reload();
    toast.success(r.deleted === 1 ? "Deleted for good" : `Deleted ${plural(r.deleted, "item")} for good`);
  }

  async function emptyTrash() {
    setBusy(true);
    const r = await run(() => emptyTrashAction(scope));
    setBusy(false);
    if (!r) return;
    reload();
    if (r.kept) toast.warning(`Deleted ${plural(r.deleted, "item")}. ${plural(r.kept, "item")} stayed because the club's records still use ${r.kept === 1 ? "it" : "them"}.`);
    else toast.success(r.deleted ? `Emptied the trash (${plural(r.deleted, "item")})` : "The trash was already empty");
  }

  async function setFeatured(row: FileRow, on: boolean) {
    const r = await run(() => setFeaturedAction(row.id, on));
    if (!r) return;
    reload();
    toast.success(on ? `“${row.name}” is now on the club page` : `Took “${row.name}” off the club page`, {
      description: on && row.effective !== "PUBLIC" ? `Only ${visCopy("club", row.effective).short.toLowerCase()} will see it there.` : undefined,
    });
  }

  // ─── Menus ───────────────────────────────────────────────────────────────
  const [menuTarget, setMenuTarget] = useState<"background" | "items">("background");

  function itemEntries(list: FileRow[]): MenuEntry[] {
    if (!list.length) return [];
    const one = list.length === 1 ? list[0] : null;
    const allEditable = list.every((r) => r.canEdit);
    // Read-only viewers don't see editing actions at all; a mixed selection sees them greyed out.
    const anyEditable = list.some((r) => r.canEdit);
    const files = list.filter((r) => !r.isFolder);
    const entries: MenuEntry[] = [];
    if (!one) entries.push({ kind: "label", key: "count", label: `${plural(list.length, "item")} selected` });
    if (trash) {
      if (one && !one.isFolder) entries.push({ kind: "item", key: "preview", label: "Preview", icon: Eye, onSelect: () => setPreviewId(one.id), shortcut: "Enter" });
      entries.push({ kind: "item", key: "restore", label: "Restore", icon: RotateCcw, onSelect: () => restore(list), disabled: !allEditable });
      entries.push({ kind: "separator", key: "s1" });
      entries.push({ kind: "item", key: "forever", label: "Delete forever…", icon: Trash2, danger: true, onSelect: () => setConfirm({ kind: "delete", ids: list.map((r) => r.id) }), shortcut: "Del", disabled: !canManageSpace });
      return entries;
    }
    if (one) {
      entries.push(
        one.isFolder
          ? { kind: "item", key: "open", label: "Open", icon: FolderOpen, onSelect: () => open(one), shortcut: "Enter" }
          : { kind: "item", key: "preview", label: "Preview", icon: Eye, onSelect: () => open(one), shortcut: "Enter" },
      );
      if (!one.isFolder) entries.push({ kind: "item", key: "tab", label: "Open in a new tab", icon: ExternalLink, onSelect: () => window.open(one.url ?? "#", "_blank", "noopener") });
      if (one.sourceHref) entries.push({ kind: "item", key: "source", label: `Go to ${one.source ?? "its files"}`, icon: Folder, onSelect: () => (window.location.href = one.sourceHref!) });
    }
    if (files.length) entries.push({ kind: "item", key: "download", label: files.length > 1 ? `Download ${files.length} files` : "Download", icon: Download, onSelect: () => download(files) });
    entries.push({ kind: "separator", key: "s1" });
    if (one?.canEdit) entries.push({ kind: "item", key: "rename", label: "Rename", icon: Pencil, onSelect: () => setRenamingId(one.id), shortcut: "F2" });
    if (!sharedView && !auto && anyEditable) entries.push({ kind: "item", key: "move", label: "Move to…", icon: FolderInput, onSelect: () => setMoveIds(list.map((r) => r.id)), disabled: !allEditable });
    if (one) entries.push({ kind: "item", key: "link", label: "Copy link", icon: Link2, onSelect: () => copyLink(one) });
    if (one && canManageSpace && !auto && !sharedView) entries.push({ kind: "item", key: "share", label: "Share & permissions…", icon: Share2, onSelect: () => setShareId(one.id) });
    if (one && !one.isFolder && kind === "club" && canManageSpace && !auto && !sharedView) {
      entries.push({ kind: "item", key: "feature", label: "Show on club page", checked: one.featured, onSelect: () => setFeatured(one, !one.featured) });
    }
    if (one?.isFolder && one.canEdit && !sharedView) {
      entries.push({ kind: "separator", key: "s2" });
      entries.push({ kind: "item", key: "newfolder", label: "New folder inside", icon: FolderPlus, onSelect: () => newFolder(one.id) });
      entries.push({ kind: "item", key: "uploadhere", label: "Upload here…", icon: Upload, onSelect: () => pickFiles(one.id, one.name) });
    }
    if (!sharedView && anyEditable) {
      entries.push({ kind: "separator", key: "s3" });
      entries.push({ kind: "item", key: "trash", label: "Move to trash", icon: Trash2, danger: true, onSelect: () => trashItems(list), shortcut: "Del", disabled: !allEditable });
    }
    return entries;
  }

  function backgroundEntries(): MenuEntry[] {
    const entries: MenuEntry[] = [];
    if (trash) {
      if (rows.length && canManageSpace) entries.push({ kind: "item", key: "empty", label: "Empty trash…", icon: Trash2, danger: true, onSelect: () => setConfirm({ kind: "empty" }) });
    } else if (writableHere) {
      entries.push({ kind: "item", key: "newfolder", label: "New folder", icon: FolderPlus, onSelect: () => newFolder(currentFolderId) });
      entries.push({ kind: "item", key: "upload", label: "Upload here…", icon: Upload, onSelect: () => pickFiles(currentFolderId, currentFolderName) });
    }
    entries.push({ kind: "separator", key: "s1" });
    if (rows.length) entries.push({ kind: "item", key: "all", label: "Select all", icon: Check, onSelect: () => setSelected(new Set(rows.map((r) => r.id))), shortcut: modKey("A") });
    entries.push({ kind: "item", key: "mode", label: mode === "list" ? "View as icons" : "View as list", icon: mode === "list" ? Grid2x2 : LayoutList, onSelect: () => chooseMode(mode === "list" ? "grid" : "list") });
    entries.push({ kind: "item", key: "refresh", label: "Refresh", icon: RefreshCw, onSelect: reload });
    return entries;
  }

  const forceItemsMenu = useRef(false);

  /**
   * Opens the shared context menu (the ⋯ buttons, the selection bar and
   * Shift+F10) by sending a contextmenu event from `target`, placed under `anchor`.
   */
  function openMenuAt(target: HTMLElement, anchor: HTMLElement = target) {
    const r = anchor.getBoundingClientRect();
    target.dispatchEvent(new globalThis.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + Math.min(r.width, 24), clientY: r.bottom }));
  }

  function onPaneContextMenu(e: MouseEvent) {
    const itemEl = (e.target as HTMLElement).closest<HTMLElement>("[data-item-id]");
    if (renamingId) setRenamingId(null);
    if (forceItemsMenu.current) {
      forceItemsMenu.current = false;
      setMenuTarget("items");
    } else if (itemEl) {
      const id = itemEl.dataset.itemId!;
      if (!selected.has(id)) selectOnly(id);
      else setFocusId(id);
      setMenuTarget("items");
    } else {
      setSelected(new Set());
      setMenuTarget("background");
    }
  }

  // ─── Drag and drop ───────────────────────────────────────────────────────
  const [draggingIds, setDraggingIds] = useState<Set<string>>(new Set());
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [fileDragDepth, setFileDragDepth] = useState(0);

  function canMoveInto(targetId: string | null, ids: Iterable<string>): boolean {
    if (trash || sharedView || auto) return false;
    const list = [...ids];
    if (!list.length) return false;
    if (targetId === null) return canManageSpace;
    const node = tree.find((n) => n.id === targetId);
    if (!node?.canEdit) return false;
    // Not into itself or anything inside it.
    for (const id of list) {
      let current: string | null = targetId;
      for (let d = 0; current && d < 64; d++) {
        if (current === id) return false;
        const at: string = current;
        current = tree.find((n) => n.id === at)?.parentId ?? null;
      }
    }
    return true;
  }

  function canUploadInto(targetId: string | null): boolean {
    if (trash || sharedView) return false;
    if (targetId === null) return auto ? false : canManageSpace;
    if (targetId === currentFolderId) return Boolean(data?.canUpload);
    const row = byId.get(targetId);
    if (row) return row.isFolder && row.canEdit;
    return Boolean(tree.find((n) => n.id === targetId)?.canEdit);
  }

  function readDragIds(e: DragEvent): string[] {
    try {
      return JSON.parse(e.dataTransfer.getData(INTERNAL_DRAG_TYPE) || "[]") as string[];
    } catch {
      return [];
    }
  }

  function dragProps(row: FileRow) {
    const canDrag = row.canEdit && !trash && !sharedView && !auto;
    const isFolderTarget = row.isFolder && !trash && !sharedView;
    return {
      draggable: canDrag && renamingId !== row.id,
      onDragStart: canDrag
        ? (e: DragEvent) => {
            const ids = selected.has(row.id) ? [...selected] : [row.id];
            if (!selected.has(row.id)) selectOnly(row.id);
            e.dataTransfer.setData(INTERNAL_DRAG_TYPE, JSON.stringify(ids));
            e.dataTransfer.effectAllowed = "move";
            if (ids.length > 1) {
              const ghost = document.createElement("div");
              ghost.textContent = `${ids.length} items`;
              ghost.style.cssText = "position:fixed;top:-100px;left:-100px;padding:6px 12px;border-radius:9999px;background:#492365;color:#fff;font:600 13px system-ui";
              document.body.appendChild(ghost);
              e.dataTransfer.setDragImage(ghost, 10, 10);
              setTimeout(() => ghost.remove(), 0);
            }
            setDraggingIds(new Set(ids));
          }
        : undefined,
      onDragEnd: canDrag
        ? () => {
            setDraggingIds(new Set());
            setDropTargetId(null);
          }
        : undefined,
      onDragOver: isFolderTarget
        ? (e: DragEvent) => {
            const internal = isInternalDrag(e.dataTransfer);
            const ok = internal ? !draggingIds.has(row.id) && canMoveInto(row.id, draggingIds) : isFileDrag(e.dataTransfer) && canUploadInto(row.id);
            if (!ok) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = internal ? "move" : "copy";
            if (dropTargetId !== row.id) setDropTargetId(row.id);
          }
        : undefined,
      onDragLeave: isFolderTarget ? () => setDropTargetId((d) => (d === row.id ? null : d)) : undefined,
      onDrop: isFolderTarget
        ? (e: DragEvent) => {
            setDropTargetId(null);
            if (isInternalDrag(e.dataTransfer)) {
              const ids = readDragIds(e);
              if (!ids.length || ids.includes(row.id) || !canMoveInto(row.id, ids)) return;
              e.preventDefault();
              e.stopPropagation();
              setDraggingIds(new Set());
              void move(ids, row.id);
            } else if (isFileDrag(e.dataTransfer) && canUploadInto(row.id)) {
              e.preventDefault();
              e.stopPropagation();
              setFileDragDepth(0);
              const { files, skippedFolders } = filesFromDrop(e.dataTransfer);
              if (skippedFolders) toast.info("Folders can't be uploaded directly. Make a folder here, then drop its files into it.");
              startUpload(files, row.id, row.name);
            }
          }
        : undefined,
    };
  }

  const treeDrop: TreeDrop = {
    canDrop: (e, target) => (isInternalDrag(e.dataTransfer) ? canMoveInto(target, draggingIds) && !(target !== null && draggingIds.has(target)) : isFileDrag(e.dataTransfer) && !auto && canUploadInto(target)),
    onDrop: (e, target) => {
      if (isInternalDrag(e.dataTransfer)) {
        const ids = readDragIds(e);
        setDraggingIds(new Set());
        if (ids.length && canMoveInto(target, ids)) void move(ids, target);
      } else {
        setFileDragDepth(0);
        const { files, skippedFolders } = filesFromDrop(e.dataTransfer);
        if (skippedFolders) toast.info("Folders can't be uploaded directly. Make a folder, then drop its files into it.");
        startUpload(files, target, target ? (tree.find((n) => n.id === target)?.name ?? "the folder") : rootLabel);
      }
    },
  };

  const paneDrop = {
    onDragEnter: (e: DragEvent) => {
      if (isFileDrag(e.dataTransfer) && writableHere) setFileDragDepth((d) => d + 1);
    },
    onDragLeave: (e: DragEvent) => {
      if (isFileDrag(e.dataTransfer) && writableHere) setFileDragDepth((d) => Math.max(0, d - 1));
    },
    onDragOver: (e: DragEvent) => {
      if (isFileDrag(e.dataTransfer) && writableHere) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    onDrop: (e: DragEvent) => {
      setFileDragDepth(0);
      if (!isFileDrag(e.dataTransfer) || !writableHere) return;
      e.preventDefault();
      const { files, skippedFolders } = filesFromDrop(e.dataTransfer);
      if (skippedFolders) toast.info("Folders can't be uploaded directly. Make a folder here, then drop its files into it.");
      startUpload(files, currentFolderId, currentFolderName);
    },
  };

  // ─── Keyboard ────────────────────────────────────────────────────────────
  const typeAhead = useRef({ text: "", at: 0 });

  function columns(): number {
    if (mode === "list") return 1;
    const els = rows.map((r) => itemRefs.current.get(r.id)).filter((x): x is HTMLElement => Boolean(x));
    if (els.length < 2) return 1;
    const top = els[0].offsetTop;
    const n = els.findIndex((el) => el.offsetTop !== top);
    return n === -1 ? els.length : n;
  }

  function goUp() {
    if (trash || sharedView) return;
    if (searching) return go({ parentId: loc.parentId, shared: loc.shared });
    const path = data?.path ?? [];
    const from = loc.parentId;
    if (auto) {
      const parent = path.length > 1 ? path[path.length - 2] : null;
      if (parent?.id) go({ parentId: parent.id, shared: true }, { focusId: from });
      else go({ view: "shared" }, { focusId: from });
      return;
    }
    if (!loc.parentId) return;
    const parent = path.length > 1 ? path[path.length - 2] : null;
    go({ parentId: parent?.id ?? null }, { focusId: from });
  }

  function onPaneKeyDown(e: KeyboardEvent) {
    if (e.defaultPrevented || renamingId) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable=true]")) return;
    const mod = e.metaKey || e.ctrlKey;
    const idx = focusId ? rows.findIndex((r) => r.id === focusId) : -1;
    const current = idx >= 0 ? rows[idx] : null;

    const moveFocus = (to: number) => {
      if (!rows.length) return;
      const i = Math.max(0, Math.min(rows.length - 1, to));
      const id = rows[i].id;
      wantFocus.current = true;
      if (e.shiftKey) selectRange(id, mod);
      else if (mod) setFocusId(id);
      else selectOnly(id);
    };

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return moveFocus(idx < 0 ? 0 : idx + columns());
      case "ArrowUp":
        if (e.altKey) {
          e.preventDefault();
          return goUp();
        }
        e.preventDefault();
        return moveFocus(idx < 0 ? 0 : idx - columns());
      case "ArrowRight":
        if (mode === "grid") {
          e.preventDefault();
          return moveFocus(idx + 1);
        }
        return;
      case "ArrowLeft":
        if (mode === "grid") {
          e.preventDefault();
          return moveFocus(Math.max(0, idx - 1));
        }
        return;
      case "Home":
        e.preventDefault();
        return moveFocus(0);
      case "End":
        e.preventDefault();
        return moveFocus(rows.length - 1);
      case "Enter":
        if (current) {
          e.preventDefault();
          open(current);
        }
        return;
      case " ":
        if (current) {
          e.preventDefault();
          toggle(current.id);
        }
        return;
      case "Escape":
        if (selected.size) {
          e.preventDefault();
          setSelected(new Set());
        }
        return;
      case "Backspace":
        e.preventDefault();
        if (mod && selectedRows.length && !trash && !sharedView && selectedRows.every((r) => r.canEdit)) return void trashItems(selectedRows);
        return goUp();
      case "Delete":
        if (!selectedRows.length) return;
        e.preventDefault();
        if (trash) {
          if (canManageSpace) setConfirm({ kind: "delete", ids: selectedRows.map((r) => r.id) });
        } else if (!sharedView && selectedRows.every((r) => r.canEdit)) void trashItems(selectedRows);
        else toast.error("You can't move some of these to the trash.");
        return;
      case "F2":
        if (current?.canEdit && !trash) {
          e.preventDefault();
          setRenamingId(current.id);
        }
        return;
      case "F10":
        if (e.shiftKey && current) {
          e.preventDefault();
          const el = itemRefs.current.get(current.id);
          if (el) openMenuAt(el);
        }
        return;
      case "ContextMenu":
        if (current) {
          e.preventDefault();
          const el = itemRefs.current.get(current.id);
          if (el) openMenuAt(el);
        }
        return;
      case "/":
        e.preventDefault();
        searchRef.current?.focus();
        return;
      case "?":
        e.preventDefault();
        setKeysOpen(true);
        return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(rows.map((r) => r.id)));
      return;
    }
    // Type-ahead: jump to the first name starting with what's typed.
    if (!mod && !e.altKey && e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      const t = typeAhead.current;
      t.text = now - t.at > 800 ? e.key : t.text + e.key;
      t.at = now;
      const start = t.text.length === 1 ? idx + 1 : Math.max(0, idx);
      const hit = typeAheadIndex(rows.map((r) => r.name), t.text, start);
      if (hit >= 0) {
        e.preventDefault();
        wantFocus.current = true;
        selectOnly(rows[hit].id);
      }
    }
  }

  // ─── Item handlers ───────────────────────────────────────────────────────
  const coarse = useRef(false);
  useEffect(() => {
    coarse.current = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  }, []);

  const handlers: ItemHandlers = {
    onClick: (e, row) => {
      if (renamingId && renamingId !== row.id) setRenamingId(null);
      if (e.shiftKey) return selectRange(row.id, e.metaKey || e.ctrlKey);
      if (e.metaKey || e.ctrlKey) return toggle(row.id);
      // On touch screens a tap opens, like a phone's file app; checkboxes select.
      if (coarse.current && selected.size === 0) return open(row);
      if (coarse.current && selected.size > 0) return toggle(row.id);
      selectOnly(row.id);
    },
    onOpen: (row) => {
      if (!coarse.current) open(row);
    },
    onToggle: (row, e) => {
      if (e.shiftKey) selectRange(row.id, true);
      else toggle(row.id);
    },
    onMore: (e) => openMenuAt(e.currentTarget),
    onRenameCommit: (row, name) => void rename(row, name),
    onRenameCancel: () => {
      const id = renamingId;
      setRenamingId(null);
      focusItem(id);
    },
    dragProps,
    register: (id, el) => {
      if (el) itemRefs.current.set(id, el);
      else itemRefs.current.delete(id);
    },
  };

  // ─── Derived bits for rendering ──────────────────────────────────────────
  const previewFiles = rows.filter((r) => !r.isFolder);
  const previewIndex = previewId ? previewFiles.findIndex((r) => r.id === previewId) : -1;
  const previewRow = previewIndex >= 0 ? previewFiles[previewIndex] : null;
  const crumbs: Crumb[] = data?.path ?? initial.path;
  const location = previewRow ? (previewRow.location ?? (crumbs.map((c) => c.name).join(" / ") || rootLabel)) : "";
  const moveRows = (moveIds ?? []).map((id) => byId.get(id)).filter((r): r is FileRow => Boolean(r));
  const shareRow = shareId ? byId.get(shareId) : null;
  const showLocation = searching || trash || sharedView;
  const allChecked = rows.length > 0 && selected.size === rows.length;
  const headerLabel = trash ? "Trash" : sharedView ? "Shared with me" : searching ? `Results for “${loc.q}”` : currentFolderName;

  const sidebar = (
    <div className="space-y-4">
      <FolderTree
        nodes={tree}
        rootLabel={rootLabel}
        activeId={loc.view === "folder" && !auto && !searching ? loc.parentId : undefined}
        onChoose={(id) => {
          setFoldersOpen(false);
          go({ parentId: id });
        }}
        drop={treeDrop}
        label={`${rootLabel} folders`}
      />
      <div className="space-y-0.5 border-t border-line pt-3">
        {spaceKind === "user" ? (
          <PlaceButton
            icon={Users}
            label="Shared with me"
            active={sharedView || auto}
            onClick={() => {
              setFoldersOpen(false);
              go({ view: "shared" });
            }}
          />
        ) : null}
        {links?.map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-ink-2 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
            {l.icon === "university" ? <FolderTreeIcon className="h-4 w-4" aria-hidden /> : <Folder className="h-4 w-4" aria-hidden />}
            <span className="truncate">{l.label}</span>
          </Link>
        ))}
        {canManageSpace ? (
          <PlaceButton
            icon={Trash2}
            label="Trash"
            count={trashCount}
            active={trash}
            onClick={() => {
              setFoldersOpen(false);
              go({ view: "trash" });
            }}
          />
        ) : null}
      </div>
      {sidebarNote ? <div className="border-t border-line pt-3 text-xs text-ink-3">{sidebarNote}</div> : null}
    </div>
  );

  const loadingFirst = loading && (!data || stale) && !data?.items.length;
  const pending = loading || busy;

  return (
    <div className="space-y-3">
      {readOnlyNote ? <Callout tone="info">{readOnlyNote}</Callout> : null}
      <div className="grid min-h-[34rem] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden min-w-0 border-r border-line bg-canvas/60 p-3 lg:block" aria-label="Folders and places">
          {sidebar}
        </aside>

        <section className="flex min-w-0 flex-col" aria-label={headerLabel}>
          {/* Location + search */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setFoldersOpen(true)} aria-label="Show folders">
              <FolderTreeIcon className="h-4 w-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">Folders</span>
            </Button>
            <Breadcrumbs
              crumbs={crumbs}
              mode={trash ? "trash" : sharedView ? "shared" : searching ? "search" : auto ? "auto" : "folder"}
              q={loc.q}
              rootLabel={rootLabel}
              onGo={(id) => (auto ? (id ? go({ parentId: id, shared: true }) : go({ view: "shared" })) : go({ parentId: id }))}
              onShared={() => go({ view: "shared" })}
              onRoot={() => go({})}
              dropFor={(id) =>
                auto || trash || sharedView
                  ? undefined
                  : {
                      canDrop: (e) => isInternalDrag(e.dataTransfer) && id !== currentFolderId && canMoveInto(id, draggingIds),
                      onDrop: (e) => {
                        const ids = readDragIds(e);
                        setDraggingIds(new Set());
                        if (ids.length && canMoveInto(id, ids)) void move(ids, id);
                      },
                    }
              }
            />
            <div className="relative ml-auto w-full sm:w-64">
              <label htmlFor={searchId} className="sr-only">
                {clientFilter ? "Filter this list" : `Search ${rootLabel}`}
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input
                id={searchId}
                ref={searchRef}
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && searchText) {
                    e.preventDefault();
                    setSearchText("");
                  } else if (e.key === "ArrowDown" && rows.length) {
                    e.preventDefault();
                    wantFocus.current = true;
                    selectOnly(rows[0].id);
                  }
                }}
                placeholder={clientFilter ? "Filter this list" : `Search ${spaceKind === "club" ? "club files" : "files"}`}
                className="h-9 pl-9"
                autoComplete="off"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2" role="toolbar" aria-label="File actions">
            {selectedRows.length ? (
              <SelectionBar
                rows={selectedRows}
                trash={trash}
                sharedView={sharedView || auto}
                canManage={canManageSpace}
                onClear={() => setSelected(new Set())}
                onDownload={() => download(selectedRows)}
                onMove={() => setMoveIds(selectedRows.map((r) => r.id))}
                onShare={() => setShareId(selectedRows[0].id)}
                onTrash={() => trashItems(selectedRows)}
                onRestore={() => restore(selectedRows)}
                onDeleteForever={() => setConfirm({ kind: "delete", ids: selectedRows.map((r) => r.id) })}
                onMore={(el) => {
                  if (!paneRef.current) return;
                  forceItemsMenu.current = true;
                  openMenuAt(paneRef.current, el);
                }}
              />
            ) : trash ? (
              <>
                <p className="text-sm text-ink-2">Items stay here until someone who manages these files deletes them for good.</p>
                {rows.length && canManageSpace ? (
                  <Button variant="outline" size="sm" className="ml-auto text-danger" onClick={() => setConfirm({ kind: "empty" })} disabled={busy}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Empty trash
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                {writableHere ? (
                  <>
                    <Button size="sm" onClick={() => pickFiles(currentFolderId, currentFolderName)}>
                      <Upload className="h-4 w-4" aria-hidden /> Upload
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => newFolder(currentFolderId)} disabled={busy}>
                      <FolderPlus className="h-4 w-4" aria-hidden /> New folder
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-ink-3">{sharedView ? "Files and folders people have shared with you by name." : searching ? `Searching all of ${rootLabel}.` : data && !data.canUpload ? "You can open what's here, but not add to it." : ""}</p>
                )}
              </>
            )}
            <div className={cn("flex items-center gap-1", !selectedRows.length && "ml-auto")}>
              <SortMenu sort={sort} onChoose={chooseSort} />
              <div className="flex rounded-lg border border-line-2 p-0.5" role="group" aria-label="View">
                <ViewButton icon={LayoutList} label="List view" active={mode === "list"} onClick={() => chooseMode("list")} />
                <ViewButton icon={Grid2x2} label="Icon view" active={mode === "grid"} onClick={() => chooseMode("grid")} />
              </div>
            </div>
          </div>

          {/* Items */}
          <ContextMenu
            onOpenChange={(o) => {
              if (!o) setMenuTarget("background");
            }}
          >
            <ContextMenuTrigger asChild disabled={Boolean(renamingId)}>
              <div
                ref={paneRef}
                tabIndex={-1}
                className={cn("relative flex min-h-[22rem] flex-1 flex-col outline-none", pending && data && "cursor-progress")}
                onContextMenu={onPaneContextMenu}
                onKeyDown={onPaneKeyDown}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("[data-item-id]") && !e.shiftKey && !e.metaKey && !e.ctrlKey) setSelected(new Set());
                }}
                {...paneDrop}
              >
                {loading && data ? <div className="absolute inset-x-0 top-0 z-[2] h-0.5 animate-pulse bg-brand" role="progressbar" aria-label="Loading" /> : null}
                {error && data && !stale ? (
                  <div className="px-3 pt-3">
                    <Callout tone="warning">
                      {error}{" "}
                      <button type="button" onClick={reload} className="font-medium underline underline-offset-2">
                        Try again
                      </button>
                    </Callout>
                  </div>
                ) : null}
                {error && (!data || stale) ? (
                  <div className="p-4">
                    <Callout tone="danger" title="This didn't open">
                      <p>{error}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={reload}>
                          Try again
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => go({})}>
                          Go to {rootLabel}
                        </Button>
                      </div>
                    </Callout>
                  </div>
                ) : loadingFirst ? (
                  <LoadingRows />
                ) : rows.length === 0 ? (
                  <Empty
                    trash={trash}
                    shared={sharedView}
                    searching={searching || (clientFilter && Boolean(searchText.trim()))}
                    q={clientFilter ? searchText.trim() : loc.q}
                    canUpload={writableHere}
                    folderName={currentFolderName}
                    onUpload={() => pickFiles(currentFolderId, currentFolderName)}
                    onNewFolder={() => newFolder(currentFolderId)}
                  />
                ) : (
                  <div
                    role="grid"
                    aria-multiselectable="true"
                    aria-label={`${headerLabel}: ${plural(rows.length, "item")}`}
                    aria-describedby={hintId}
                    aria-busy={loading || undefined}
                    className={cn("@container min-w-0 flex-1", stale && "opacity-60")}
                  >
                    {mode === "list" ? (
                      <>
                        <ListHeader
                          sort={sort}
                          onSort={(k) => chooseSort(k)}
                          allChecked={allChecked}
                          someChecked={selected.size > 0}
                          onToggleAll={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                          trash={trash}
                        />
                        <ListItems rows={rows} kind={kind} selected={selected} focusId={focusId} renamingId={renamingId} dropTargetId={dropTargetId} draggingIds={draggingIds} showLocation={showLocation} trash={trash} handlers={handlers} />
                      </>
                    ) : (
                      <GridItems rows={rows} kind={kind} selected={selected} focusId={focusId} renamingId={renamingId} dropTargetId={dropTargetId} draggingIds={draggingIds} showLocation={showLocation} trash={trash} handlers={handlers} />
                    )}
                  </div>
                )}
                {fileDragDepth > 0 && writableHere ? (
                  <div className="pointer-events-none absolute inset-2 z-[3] flex items-end justify-center rounded-xl border-2 border-dashed border-brand bg-brand-50/60 pb-6" aria-hidden>
                    <span className="flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white shadow-lg">
                      <Upload className="h-4 w-4" /> {dropTargetId ? `Drop to upload into ${byId.get(dropTargetId)?.name ?? "this folder"}` : `Drop to upload to ${currentFolderName}`}
                    </span>
                  </div>
                ) : null}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent
              className="w-64"
              aria-label={menuTarget === "items" ? "Item actions" : "Folder actions"}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                focusItem(focusId ?? rows[0]?.id ?? null);
              }}
            >
              <MenuEntries entries={menuTarget === "items" ? itemEntries(selectedRows) : backgroundEntries()} />
            </ContextMenuContent>
          </ContextMenu>

          {/* Status bar */}
          <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-xs text-ink-3">
            <span aria-live="polite">
              {data ? plural(rows.length, "item") : "Loading…"}
              {selected.size ? ` · ${selected.size} selected` : ""}
              {data?.truncated ? " · showing the first matches; try a longer search" : ""}
            </span>
            <span id={hintId} className="sr-only">
              Arrow keys move, Enter opens, Space selects, Shift+F10 shows actions, Backspace goes up a folder, Delete moves to the trash, F2 renames. Type a name to jump to it.
            </span>
            <button type="button" onClick={() => setKeysOpen(true)} className="ml-auto hidden items-center gap-1 rounded px-1 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand sm:inline-flex">
              <Keyboard className="h-3.5 w-3.5" aria-hidden /> Keyboard shortcuts
            </button>
          </footer>
        </section>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept={acceptAttr("any")}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          startUpload(files, uploadTo.current.parentId, uploadTo.current.label || currentFolderName);
          e.target.value = "";
        }}
      />

      <UploadPanel items={uploads.items} onCancel={uploads.cancel} onDismiss={uploads.dismiss} />

      <Dialog open={foldersOpen} onOpenChange={setFoldersOpen}>
        <DialogContent title="Folders">{sidebar}</DialogContent>
      </Dialog>

      <PreviewDialog
        row={previewRow}
        kind={previewRow?.spaceKind ?? kind}
        location={location}
        onClose={() => setPreviewId(null)}
        onStep={(dir) => {
          const next = previewFiles[previewIndex + dir];
          if (next) {
            setPreviewId(next.id);
            setFocusId(next.id);
            setSelected(new Set([next.id]));
          }
        }}
        hasPrev={previewIndex > 0}
        hasNext={previewIndex >= 0 && previewIndex < previewFiles.length - 1}
        onShare={canManageSpace && !auto && !sharedView && previewRow ? () => setShareId(previewRow.id) : undefined}
        onCopyLink={() => previewRow && copyLink(previewRow)}
      />

      <ShareDialog itemId={shareRow?.id ?? null} open={Boolean(shareRow)} onOpenChange={(o) => (!o ? setShareId(null) : null)} onChanged={reload} copyLink={(id) => byId.get(id) && copyLink(byId.get(id)!)} />

      {moveIds ? (
        <MoveDialog
          open
          onOpenChange={(o) => (!o ? setMoveIds(null) : null)}
          names={moveRows.map((r) => r.name)}
          movingIds={moveIds}
          currentParentId={moveRows[0]?.parentId ?? null}
          tree={tree}
          rootLabel={rootLabel}
          canUseRoot={canManageSpace}
          onMove={(target) => move(moveIds, target)}
        />
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => (!o ? setConfirm(null) : null)}
        danger
        title={confirm?.kind === "empty" ? "Empty the trash?" : confirm && confirm.ids.length === 1 ? `Delete “${byId.get(confirm.ids[0])?.name ?? "this item"}” forever?` : `Delete ${confirm?.kind === "delete" ? plural(confirm.ids.length, "item") : "these items"} forever?`}
        description={
          confirm?.kind === "empty"
            ? `Everything in the trash (${plural(rows.length, "item")}) and everything inside those folders will be deleted for good. Files still used by the club's records stay.`
            : "They'll be gone for good, along with anything inside a folder, and links to them will stop working. This can't be undone."
        }
        confirmLabel={confirm?.kind === "empty" ? "Empty trash" : "Delete forever"}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c?.kind === "empty") void emptyTrash();
          else if (c) void deleteForever(c.ids);
        }}
      />

      <ShortcutsDialog open={keysOpen} onOpenChange={setKeysOpen} />
    </div>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function PlaceButton({ icon: Icon, label, active, count, onClick }: { icon: LucideIcon; label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-brand",
        active ? "bg-brand-50 font-medium text-brand" : "text-ink-2 hover:bg-muted hover:text-ink",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {count ? <span className="rounded-full bg-muted px-1.5 text-xs text-ink-2">{count}</span> : null}
    </button>
  );
}

function ViewButton({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn("flex h-7 w-7 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-brand", active ? "bg-brand-50 text-brand" : "text-ink-3 hover:bg-muted hover:text-ink")}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

function SortMenu({ sort, onChoose }: { sort: { key: SortKey; dir: SortDir }; onChoose: (key: SortKey, dir?: SortDir) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Sort: ${SORT_LABEL[sort.key]}, ${sort.dir === "asc" ? "ascending" : "descending"}`}>
          <ArrowDownUp className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{SORT_LABEL[sort.key]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        {SORT_KEYS.map((k) => (
          <DropdownMenuItem key={k} role="menuitemradio" aria-checked={sort.key === k} onSelect={() => onChoose(k, sort.key === k ? sort.dir : undefined)}>
            <Check className={cn("h-4 w-4", sort.key === k ? "opacity-100" : "opacity-0")} aria-hidden />
            {SORT_LABEL[k]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Order</DropdownMenuLabel>
        {(["asc", "desc"] as const).map((d) => (
          <DropdownMenuItem key={d} role="menuitemradio" aria-checked={sort.dir === d} onSelect={() => onChoose(sort.key, d)}>
            <Check className={cn("h-4 w-4", sort.dir === d ? "opacity-100" : "opacity-0")} aria-hidden />
            {sort.key === "name" || sort.key === "type" ? (d === "asc" ? "A to Z" : "Z to A") : sort.key === "size" ? (d === "asc" ? "Smallest first" : "Largest first") : d === "asc" ? "Oldest first" : "Newest first"}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SelectionBar({
  rows,
  trash,
  sharedView,
  canManage,
  onClear,
  onDownload,
  onMove,
  onShare,
  onTrash,
  onRestore,
  onDeleteForever,
  onMore,
}: {
  rows: FileRow[];
  trash: boolean;
  sharedView: boolean;
  canManage: boolean;
  onClear: () => void;
  onDownload: () => void;
  onMove: () => void;
  onShare: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onMore: (el: HTMLElement) => void;
}) {
  const editable = rows.every((r) => r.canEdit);
  const files = rows.filter((r) => !r.isFolder).length;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Button variant="ghost" size="sm" onClick={onClear} aria-label="Clear selection">
        <X className="h-4 w-4" aria-hidden />
        {rows.length} selected
      </Button>
      {trash ? (
        <>
          <Button variant="outline" size="sm" onClick={onRestore} disabled={!editable}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Restore
          </Button>
          {canManage ? (
            <Button variant="outline" size="sm" className="text-danger" onClick={onDeleteForever}>
              <Trash2 className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Delete forever</span>
              <span className="sm:hidden">Delete</span>
            </Button>
          ) : null}
        </>
      ) : (
        <>
          {files ? (
            <Button variant="outline" size="sm" onClick={onDownload} aria-label={files > 1 ? `Download ${files} files` : "Download"}>
              <Download className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Download</span>
            </Button>
          ) : null}
          {!sharedView && editable ? (
            <Button variant="outline" size="sm" onClick={onMove} aria-label="Move to…">
              <FolderInput className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Move</span>
            </Button>
          ) : null}
          {!sharedView && canManage && rows.length === 1 ? (
            <Button variant="outline" size="sm" onClick={onShare} aria-label="Share & permissions">
              <Share2 className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Share</span>
            </Button>
          ) : null}
          {!sharedView && editable ? (
            <Button variant="outline" size="sm" className="text-danger" onClick={onTrash} aria-label="Move to trash">
              <Trash2 className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Trash</span>
            </Button>
          ) : null}
        </>
      )}
      <Button variant="ghost" size="sm" onClick={(e) => onMore(e.currentTarget)} aria-label="More actions">
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}

function Breadcrumbs({
  crumbs,
  mode,
  q,
  rootLabel,
  onGo,
  onShared,
  onRoot,
  dropFor,
}: {
  crumbs: Crumb[];
  mode: "folder" | "trash" | "shared" | "search" | "auto";
  q: string;
  rootLabel: string;
  onGo: (id: string | null) => void;
  onShared: () => void;
  onRoot: () => void;
  dropFor: (id: string | null) => { canDrop: (e: DragEvent) => boolean; onDrop: (e: DragEvent) => void } | undefined;
}) {
  const [over, setOver] = useState<string | null | undefined>(undefined);
  let items: { id: string | null; name: string; onClick: () => void; droppable: boolean }[];
  if (mode === "trash") items = [{ id: null, name: rootLabel, onClick: onRoot, droppable: false }, { id: "__trash", name: "Trash", onClick: () => undefined, droppable: false }];
  else if (mode === "shared") items = [{ id: "__shared", name: "Shared with me", onClick: onShared, droppable: false }];
  else if (mode === "search") items = [{ id: null, name: rootLabel, onClick: onRoot, droppable: false }, { id: "__search", name: `Search: “${q}”`, onClick: () => undefined, droppable: false }];
  else if (mode === "auto") items = [{ id: "__shared", name: "Shared with me", onClick: onShared, droppable: false }, ...crumbs.map((c) => ({ id: c.id, name: c.name, onClick: () => onGo(c.id), droppable: false }))];
  else items = crumbs.map((c) => ({ id: c.id, name: c.name, onClick: () => onGo(c.id), droppable: true }));

  // Long paths: first, "…", then the last two.
  const hidden = items.length > 4 ? items.slice(1, -2) : [];
  const shown = items.length > 4 ? [items[0], null, ...items.slice(-2)] : items;

  return (
    <nav aria-label="Folder path" className="min-w-0 flex-1">
      <ol className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
        {shown.map((c, i) => {
          const last = i === shown.length - 1;
          if (c === null) {
            return (
              <li key="more" className="flex items-center gap-0.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="rounded px-1.5 py-1 text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand" aria-label="Show the folders in between">
                      …
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {hidden.map((h) => (
                      <DropdownMenuItem key={h.id ?? "root"} onSelect={h.onClick}>
                        <Folder className="h-4 w-4 text-ink-3" aria-hidden /> {h.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
              </li>
            );
          }
          const drop = c.droppable && !last ? dropFor(c.id) : undefined;
          const key = c.id ?? "root";
          return (
            <li key={key} className="flex min-w-0 items-center gap-0.5">
              {last ? (
                <span aria-current="location" className="truncate px-1.5 py-1 font-semibold text-ink" title={c.name}>
                  {c.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={c.onClick}
                  title={c.name}
                  className={cn(
                    "max-w-[10rem] truncate rounded px-1.5 py-1 text-ink-2 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand",
                    over === c.id && "bg-brand-100 text-brand ring-2 ring-brand-200",
                  )}
                  onDragOver={
                    drop
                      ? (e) => {
                          if (!drop.canDrop(e)) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setOver(c.id);
                        }
                      : undefined
                  }
                  onDragLeave={drop ? () => setOver(undefined) : undefined}
                  onDrop={
                    drop
                      ? (e) => {
                          setOver(undefined);
                          if (!drop.canDrop(e)) return;
                          e.preventDefault();
                          e.stopPropagation();
                          drop.onDrop(e);
                        }
                      : undefined
                  }
                >
                  {c.name}
                </button>
              )}
              {last ? null : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2 p-3" role="status" aria-label="Loading files">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 md:block" />
        </div>
      ))}
    </div>
  );
}

function Empty({
  trash,
  shared,
  searching,
  q,
  canUpload,
  folderName,
  onUpload,
  onNewFolder,
}: {
  trash: boolean;
  shared: boolean;
  searching: boolean;
  q: string;
  canUpload: boolean;
  folderName: string;
  onUpload: () => void;
  onNewFolder: () => void;
}) {
  if (searching) {
    return <EmptyState className="m-4 border-0" icon={<Search />} title={`Nothing matches “${q}”`} description="Check the spelling or try part of the name. Search only shows files you're allowed to open." />;
  }
  if (trash) {
    return <EmptyState className="m-4 border-0" icon={<Trash2 />} title="The trash is empty" description="Things you move to the trash wait here, so you can restore them if you change your mind." />;
  }
  if (shared) {
    return (
      <EmptyState
        className="m-4 border-0"
        icon={<Users />}
        title="Nothing has been shared with you yet"
        description="When a club leader or another student adds you to a file or folder by name, it shows up here."
      />
    );
  }
  if (!canUpload) {
    return <EmptyState className="m-4 border-0" icon={<FolderOpen />} title="Nothing here you can open yet" description="Files in this folder are either private to the club's leaders or haven't been added." />;
  }
  return (
    <EmptyState
      className="m-4 border-0"
      icon={<FolderOpen />}
      title={`${folderName} is empty`}
      description="Drag files here from your computer, or use Upload. Up to 25 MB each."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={onUpload}>
            <Upload className="h-4 w-4" aria-hidden /> Upload files
          </Button>
          <Button size="sm" variant="outline" onClick={onNewFolder}>
            <FolderPlus className="h-4 w-4" aria-hidden /> New folder
          </Button>
        </div>
      }
    />
  );
}

const SHORTCUTS: [string, string][] = [
  ["↑ ↓ ← →", "Move between items"],
  ["Enter", "Open a folder or preview a file"],
  ["Space", "Select or unselect"],
  ["Shift + click or arrows", "Select a range"],
  [`${IS_MAC ? "⌘" : "Ctrl"} + click`, "Add to the selection"],
  [modKey("A"), "Select everything here"],
  ["Backspace", "Go up a folder"],
  ["Delete", "Move to the trash"],
  ["F2", "Rename"],
  ["Shift + F10", "Show actions"],
  ["/", "Search"],
  ["Type a name", "Jump to it"],
];

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" description="Click an item (or tab to the list) first.">
        <dl className="divide-y divide-line rounded-xl border border-line text-sm">
          {SHORTCUTS.map(([k, v]) => (
            <div key={v} className="flex items-center justify-between gap-4 px-3 py-2">
              <dt className="text-ink-2">{v}</dt>
              <dd>
                <kbd className="rounded-md border border-line-2 bg-muted px-1.5 py-0.5 font-mono text-xs text-ink">{k}</kbd>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-3">Right-click (or long-press on a phone) any item for everything you can do with it.</p>
      </DialogContent>
    </Dialog>
  );
}

