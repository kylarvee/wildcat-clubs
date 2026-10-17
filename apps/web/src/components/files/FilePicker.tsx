"use client";

import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ChevronRight, FolderOpen, Loader2, Search, Upload, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { Callout, Skeleton } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { ItemIcon, VisIcon } from "@/components/files/FileVisuals";
import { UploadPanel, useUploadQueue } from "@/components/files/UploadQueue";
import { filesFromDrop, isFileDrag, useFileList, type ListQuery } from "@/components/files/client";
import { fmtLongDate } from "@/lib/time";
import { formatBytes } from "@/lib/rich/embeds";
import { ACCEPT_NOUN, acceptAttr, matchesAccept, sortRows } from "@/lib/files/listing";
import type { FileRow, ListResult } from "@/lib/files/types";

/**
 * CONTRACT (owner: files builder). Pop-up for choosing files from a club's
 * files (or the viewer's own / university files when clubId is null). Used by
 * the text editor, events (attachments), announcements, projects, policies.
 * Lists only what the viewer may see (the server checks canViewFile through
 * /api/files/list); can upload into the folder that's open, too.
 *
 * Tabs: "Club files" (when clubId), "My files", "Shared with me", and
 * "University files" for administrators. It often opens inside another
 * dialog: it renders in its own portal, and keyboard and submit events stop
 * here so they never reach the dialog or form underneath.
 */
export type PickedFile = { id: string; name: string; mimeType: string | null; url: string };

export type FilePickerProps = {
  clubId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (files: PickedFile[]) => void;
  multiple?: boolean;
  accept?: "any" | "image" | "document" | "video";
  title?: string;
};

export function FilePicker(props: FilePickerProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <PickerBody {...props} /> : null}
    </Dialog>
  );
}

type Tab = "club" | "user" | "shared" | "university";
type TabLoc = { parentId: string | null };

const TAB_LABEL: Record<Tab, string> = { club: "Club files", user: "My files", shared: "Shared with me", university: "University files" };

function PickerBody({ clubId, onOpenChange, onSelect, multiple = false, accept = "any", title }: FilePickerProps) {
  const [tab, setTab] = useState<Tab>(clubId ? "club" : "user");
  const [locs, setLocs] = useState<Record<Tab, TabLoc>>({ club: { parentId: null }, user: { parentId: null }, shared: { parentId: null }, university: { parentId: null } });
  const [available, setAvailable] = useState<ListResult["available"] | null>(null);
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Map<string, PickedFile>>(new Map());
  const listRef = useRef<HTMLUListElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const searchId = `${useId()}-search`;

  const loc = locs[tab];
  useEffect(() => {
    const t = setTimeout(() => setQ(searchText.trim()), 250);
    return () => clearTimeout(t);
  }, [searchText]);

  const serverSearch = Boolean(q) && tab !== "shared";
  const query: ListQuery = useMemo(() => {
    const scope: ListQuery["scope"] =
      tab === "club" && clubId ? { kind: "club", clubId } : tab === "university" ? { kind: "university" } : tab === "shared" && loc.parentId ? "auto" : { kind: "user" };
    return {
      scope,
      parentId: serverSearch ? null : loc.parentId,
      view: serverSearch ? "search" : tab === "shared" && !loc.parentId ? "shared" : "folder",
      q: serverSearch ? q : null,
      accept,
      contextClubId: clubId,
    };
  }, [tab, clubId, loc.parentId, serverSearch, q, accept]);
  const { data, stale, error, loading, reload } = useFileList(query);

  useEffect(() => {
    if (data?.available) setAvailable(data.available);
  }, [data?.available]);

  // A club whose files this person can't browse: fall back to their own files.
  useEffect(() => {
    if (tab === "club" && available && !available.club) setTab("user");
  }, [tab, available]);

  const tabs: Tab[] = [
    ...(clubId && (available?.club ?? true) ? (["club"] as Tab[]) : []),
    "user",
    ...(available?.user ? (["shared"] as Tab[]) : []),
    ...(available?.university ? (["university"] as Tab[]) : []),
  ];

  const rows = useMemo(() => {
    let list = (data?.items ?? []).filter((r) => matchesAccept(r, accept));
    if (tab === "shared" && q) list = list.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
    return sortRows(list, "name", "asc");
  }, [data?.items, accept, tab, q]);

  const uploads = useUploadQueue({
    onUploaded: (file) => {
      reload();
      if (!matchesAccept({ isFolder: false, mimeType: file.mimeType, name: file.name }, accept)) return;
      setPicked((m) => {
        const next = multiple ? new Map(m) : new Map<string, PickedFile>();
        next.set(file.id, { id: file.id, name: file.name, mimeType: file.mimeType, url: file.url });
        return next;
      });
    },
  });

  const canUpload = Boolean(data?.canUpload) && !stale && data?.view === "folder" && !serverSearch;
  const folderName = data?.folder?.name ?? data?.path.at(-1)?.name ?? TAB_LABEL[tab];

  function go(parentId: string | null) {
    setLocs((l) => ({ ...l, [tab]: { parentId } }));
    setSearchText("");
    setQ("");
  }

  function switchTab(t: Tab) {
    setTab(t);
    setSearchText("");
    setQ("");
  }

  function toggle(row: FileRow) {
    if (row.isFolder || !row.url) return;
    const file: PickedFile = { id: row.id, name: row.name, mimeType: row.mimeType, url: row.url };
    setPicked((m) => {
      if (!multiple) return m.has(row.id) ? new Map() : new Map([[row.id, file]]);
      const next = new Map(m);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, file);
      return next;
    });
  }

  function choose(list: PickedFile[] = [...picked.values()]) {
    if (!list.length) return;
    onSelect(list);
    onOpenChange(false);
  }

  function upload(files: File[]) {
    if (!files.length || !data) return;
    const scope = data.scope.kind === "club" && data.scope.clubId ? ({ kind: "club", clubId: data.scope.clubId } as const) : data.scope.kind === "university" ? ({ kind: "university" } as const) : ({ kind: "user" } as const);
    uploads.enqueue(files, { scope, parentId: data.folder?.id ?? null }, folderName);
  }

  function onListKeyDown(e: KeyboardEvent) {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-row]") ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = buttons[Math.max(0, Math.min(buttons.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      next?.focus();
    } else if (e.key === "Backspace" && !serverSearch) {
      const path = data?.path ?? [];
      if (loc.parentId) {
        e.preventDefault();
        go(path.length > 1 ? (path[path.length - 2].id ?? null) : null);
      }
    }
  }

  // Crumbs: shared folders get a "Shared with me" crumb in front.
  const crumbs: { id: string | null; name: string }[] =
    tab === "shared" ? [{ id: null, name: TAB_LABEL.shared }, ...(loc.parentId ? (data?.path ?? []) : [])] : (data?.path ?? [{ id: null, name: TAB_LABEL[tab] }]);
  const count = picked.size;
  const noun = ACCEPT_NOUN[accept];

  const drop = {
    onDragEnter: (e: DragEvent) => {
      if (isFileDrag(e.dataTransfer) && canUpload) setDragDepth((d) => d + 1);
    },
    onDragLeave: (e: DragEvent) => {
      if (isFileDrag(e.dataTransfer) && canUpload) setDragDepth((d) => Math.max(0, d - 1));
    },
    onDragOver: (e: DragEvent) => {
      if (isFileDrag(e.dataTransfer) && canUpload) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    onDrop: (e: DragEvent) => {
      setDragDepth(0);
      if (!isFileDrag(e.dataTransfer) || !canUpload) return;
      e.preventDefault();
      e.stopPropagation();
      const { files, skippedFolders } = filesFromDrop(e.dataTransfer);
      if (skippedFolders) toast.info("Folders can't be uploaded. Drop the files inside them instead.");
      upload(files);
    },
  };

  return (
    <DialogContent
      wide
      title={title ?? (multiple ? `Choose ${noun}` : `Choose a ${noun === "files" ? "file" : noun.replace(/s$/, "")}`)}
      description={accept === "any" ? "Only files you're allowed to open are listed." : `Showing ${noun} and folders. Only files you're allowed to open are listed.`}
    >
      {/* Keys and submits stop here so they never reach a dialog or form this picker opened from. */}
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && count) {
            e.preventDefault();
            choose();
          }
          // Tab still reaches the dialog's focus trap.
          if (e.key !== "Tab") e.stopPropagation();
        }}
        onSubmit={(e) => e.stopPropagation()}
      >
        {tabs.length > 1 ? (
          <div role="tablist" aria-label="File areas" className="flex gap-1 overflow-x-auto border-b border-line">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => switchTab(t)}
                className={cn(
                  "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand",
                  tab === t ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink",
                )}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Folder path" className="min-w-0 flex-1">
            {serverSearch ? (
              <p className="truncate text-sm font-medium text-ink">Results for “{q}”</p>
            ) : (
              <ol className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
                {crumbs.map((c, i) => {
                  const last = i === crumbs.length - 1;
                  return (
                    <li key={`${c.id ?? "root"}-${i}`} className="flex min-w-0 items-center gap-0.5">
                      {last ? (
                        <span aria-current="location" className="truncate px-1 font-semibold text-ink">
                          {c.name}
                        </span>
                      ) : (
                        <button type="button" onClick={() => go(c.id)} className="max-w-[9rem] truncate rounded px-1 text-ink-2 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
                          {c.name}
                        </button>
                      )}
                      {last ? null : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />}
                    </li>
                  );
                })}
              </ol>
            )}
          </nav>
          {canUpload ? (
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" aria-hidden /> Upload
            </Button>
          ) : null}
        </div>

        <div className="relative">
          <label htmlFor={searchId} className="sr-only">
            Search {TAB_LABEL[tab].toLowerCase()}
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            id={searchId}
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                listRef.current?.querySelector<HTMLButtonElement>("button[data-row]")?.focus();
              }
            }}
            placeholder={`Search ${TAB_LABEL[tab].toLowerCase()}`}
            className="h-9 pl-9"
            autoComplete="off"
          />
        </div>

        <UploadPanel items={uploads.items} onCancel={uploads.cancel} onDismiss={uploads.dismiss} className="static inset-auto w-full rounded-xl shadow-none sm:w-full" />

        <div className="relative min-h-64 overflow-hidden rounded-xl border border-line" {...drop}>
          {loading && data ? <div className="absolute inset-x-0 top-0 z-[1] h-0.5 animate-pulse bg-brand" role="progressbar" aria-label="Loading" /> : null}
          {error && (!data || stale) ? (
            <div className="p-3">
              <Callout tone="danger">
                {error}{" "}
                <button type="button" onClick={reload} className="font-medium underline underline-offset-2">
                  Try again
                </button>
              </Callout>
            </div>
          ) : !data ? (
            <div className="space-y-2 p-3" role="status" aria-label="Loading files">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              {tab === "shared" && !loc.parentId && !q ? <Users className="h-7 w-7 text-ink-3" aria-hidden /> : <FolderOpen className="h-7 w-7 text-ink-3" aria-hidden />}
              <p className="font-medium text-ink">
                {q ? `Nothing matches “${q}”` : tab === "shared" && !loc.parentId ? "Nothing has been shared with you yet" : accept === "any" ? "This folder is empty" : `No ${noun} here`}
              </p>
              <p className="max-w-sm text-sm text-ink-3">{canUpload ? `Drop ${noun} here or use Upload to add some.` : q ? "Try part of the name." : "Try another folder or tab."}</p>
            </div>
          ) : (
            <ul ref={listRef} onKeyDown={onListKeyDown} className={cn("max-h-[45vh] divide-y divide-line overflow-y-auto", stale && "opacity-60")} aria-label={`${folderName}: ${rows.length} items`} aria-busy={loading || undefined}>
              {rows.map((row) => {
                const on = picked.has(row.id);
                const meta = [serverSearch || tab === "shared" ? (row.source ?? row.location) : null, fmtLongDate(row.updatedAt), row.isFolder ? null : formatBytes(row.sizeBytes)].filter(Boolean).join(" · ");
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      data-row
                      onClick={() => (row.isFolder ? (tab === "shared" || serverSearch ? openFolder(row) : go(row.id)) : toggle(row))}
                      onDoubleClick={() => {
                        if (!row.isFolder && !multiple && row.url) choose([{ id: row.id, name: row.name, mimeType: row.mimeType, url: row.url }]);
                      }}
                      aria-pressed={row.isFolder ? undefined : on}
                      aria-label={row.isFolder ? `Open folder ${row.name}` : `${on ? "Selected: " : "Select "}${row.name}`}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                        on ? "bg-brand-50" : "hover:bg-muted/60",
                      )}
                    >
                      {row.isFolder ? (
                        <span className="h-4 w-4 shrink-0" aria-hidden />
                      ) : (
                        <span
                          className={cn("flex h-4 w-4 shrink-0 items-center justify-center border", multiple ? "rounded" : "rounded-full", on ? "border-brand bg-brand text-white" : "border-line-2 bg-surface")}
                          aria-hidden
                        >
                          {on ? <span className={cn("bg-white", multiple ? "h-1.5 w-1.5 rounded-sm" : "h-1.5 w-1.5 rounded-full")} /> : null}
                        </span>
                      )}
                      <ItemIcon row={row} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink" title={row.name}>
                          {row.name}
                        </span>
                        <span className="block truncate text-xs text-ink-3">{meta}</span>
                      </span>
                      <VisIcon vis={row.effective} kind={row.spaceKind ?? data.scope.kind} inherited={row.visibility === "INHERIT"} />
                      {row.isFolder ? <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {dragDepth > 0 && canUpload ? (
            <div className="pointer-events-none absolute inset-1 z-[2] flex items-center justify-center rounded-lg border-2 border-dashed border-brand bg-brand-50/80" aria-hidden>
              <span className="flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
                <Upload className="h-4 w-4" /> Drop to upload to {folderName}
              </span>
            </div>
          ) : null}
        </div>

        {multiple && count ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Chosen files">
            {[...picked.values()].map((f) => (
              <li key={f.id} className="flex max-w-full items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand">
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setPicked((m) => {
                      const next = new Map(m);
                      next.delete(f.id);
                      return next;
                    })
                  }
                  className="rounded-full p-0.5 hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-brand"
                  aria-label={`Remove ${f.name}`}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <input
          ref={fileInput}
          type="file"
          multiple={multiple}
          hidden
          accept={acceptAttr(accept)}
          onChange={(e) => {
            upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        <DialogFooter className="mt-2 justify-between">
          <p className="text-sm text-ink-3" aria-live="polite">
            {count ? `${count} ${count === 1 ? "file" : "files"} chosen` : multiple ? `Choose one or more ${noun}.` : `Choose one ${noun === "files" ? "file" : noun.replace(/s$/, "")}.`}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => choose()} disabled={!count || uploads.active > 0}>
              {uploads.active > 0 ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {count > 1 ? `Choose ${count} files` : "Choose"}
            </Button>
          </div>
        </DialogFooter>
      </div>
    </DialogContent>
  );

  /** Folders found by search or shared with you open where they live. */
  function openFolder(row: FileRow) {
    setSearchText("");
    setQ("");
    if (tab === "shared") setLocs((l) => ({ ...l, shared: { parentId: row.id } }));
    else go(row.id);
  }
}

