"use client";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowDown, ArrowUp, MoreHorizontal, Star } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { ItemIcon, SharedMark, VisIcon } from "@/components/files/FileVisuals";
import { fmtDate, fmtLongDate } from "@/lib/time";
import { formatBytes } from "@/lib/rich/embeds";
import { kindLabel, SORT_LABEL, type SortDir, type SortKey } from "@/lib/files/listing";
import { nameProblem, splitExt } from "@/lib/files/names";
import { visCopy } from "@/lib/files/visibility";
import type { FileRow, FileScopeKind } from "@/lib/files/types";

/**
 * The explorer's main pane in list (details) or grid (icons) view. Pure
 * rendering: selection, focus, drag and drop and menus are owned by
 * FileExplorer and passed in.
 */

export type ItemHandlers = {
  onClick: (e: MouseEvent, row: FileRow) => void;
  onOpen: (row: FileRow) => void;
  onToggle: (row: FileRow, e: MouseEvent) => void;
  onMore: (e: MouseEvent<HTMLButtonElement>, row: FileRow) => void;
  onRenameCommit: (row: FileRow, name: string) => void;
  onRenameCancel: () => void;
  dragProps: (row: FileRow) => {
    draggable: boolean;
    onDragStart?: (e: DragEvent) => void;
    onDragEnd?: (e: DragEvent) => void;
    onDragOver?: (e: DragEvent) => void;
    onDragLeave?: (e: DragEvent) => void;
    onDrop?: (e: DragEvent) => void;
  };
  register: (id: string, el: HTMLElement | null) => void;
};

export type ItemsProps = {
  rows: FileRow[];
  kind: FileScopeKind;
  selected: Set<string>;
  focusId: string | null;
  renamingId: string | null;
  dropTargetId: string | null;
  draggingIds: Set<string>;
  /** Show where each item lives (search, trash, shared). */
  showLocation: boolean;
  trash: boolean;
  handlers: ItemHandlers;
};

function rowLabel(row: FileRow, kind: FileScopeKind) {
  const bits = [row.name, row.isFolder ? "folder" : kindLabel(row), `who can open: ${visCopy(row.spaceKind ?? kind, row.effective).short}`];
  if (row.featured) bits.push("shown on the club page");
  return bits.join(", ");
}

function metaLine(row: FileRow, showLocation: boolean, trash: boolean) {
  const when = trash && row.trashedAt ? `Deleted ${fmtDate(row.trashedAt, "MMM d")}` : fmtLongDate(row.updatedAt);
  const size = row.isFolder ? (row.childCount !== null ? `${row.childCount} ${row.childCount === 1 ? "item" : "items"}` : "Folder") : formatBytes(row.sizeBytes);
  const where = showLocation ? (row.source ?? row.location) : null;
  return [where, when, size].filter(Boolean).join(" · ");
}

// ─── Inline rename ───────────────────────────────────────────────────────────

export function RenameInput({ row, onCommit, onCancel, className }: { row: FileRow; onCommit: (name: string) => void; onCancel: () => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(row.name);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the name without its extension, like a desktop file manager.
    const [base] = splitExt(row.name, row.isFolder);
    el.setSelectionRange(0, base.length);
  }, [row.name, row.isFolder]);

  function commit() {
    if (done.current) return;
    const problem = nameProblem(value);
    if (problem) {
      setError(problem);
      ref.current?.focus();
      return;
    }
    done.current = true;
    if (value.trim() === row.name) onCancel();
    else onCommit(value);
  }

  return (
    <span className={cn("relative block min-w-0 flex-1", className)}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        aria-label={`New name for ${row.name}`}
        aria-invalid={error ? true : undefined}
        maxLength={200}
        className={cn(
          "h-7 w-full min-w-0 rounded-md border bg-surface px-1.5 text-sm text-ink shadow-sm focus:outline-none focus:ring-2",
          error ? "border-danger focus:ring-danger-50" : "border-brand focus:ring-brand-100",
        )}
      />
      {error ? (
        <span role="alert" className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-md bg-danger px-2 py-1 text-xs text-white shadow">
          {error}
        </span>
      ) : null}
    </span>
  );
}

function Checkbox({ row, checked, onToggle }: { row: FileRow; checked: boolean; onToggle: (row: FileRow, e: MouseEvent) => void }) {
  return (
    <input
      type="checkbox"
      tabIndex={-1}
      checked={checked}
      onChange={() => undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(row, e);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-label={`Select ${row.name}`}
      className="h-4 w-4 cursor-pointer rounded border-line-2 accent-[var(--color-brand)]"
    />
  );
}

function MoreButton({ row, onMore, className }: { row: FileRow; onMore: ItemHandlers["onMore"]; className?: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onMore(e, row);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn("flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand", className)}
      aria-label={`Actions for ${row.name}`}
      title="Actions (Shift+F10)"
    >
      <MoreHorizontal className="h-4 w-4" aria-hidden />
    </button>
  );
}

function Badges({ row }: { row: FileRow }) {
  return (
    <>
      {row.featured ? (
        <span title="Shown on the club page under Resources" className="inline-flex shrink-0">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-hidden />
          <span className="sr-only">Shown on the club page</span>
        </span>
      ) : null}
      <SharedMark count={row.sharedWith} />
    </>
  );
}

// ─── List (details) view ─────────────────────────────────────────────────────

// Columns follow the pane's own width (container queries), since the sidebar and workspace nav eat into it.
const LIST_COLS = "grid-cols-[1.75rem_minmax(0,1fr)_2rem] @2xl:grid-cols-[1.75rem_minmax(0,1fr)_10.5rem_8.5rem_6rem_2rem]";

export function ListHeader({ sort, onSort, allChecked, someChecked, onToggleAll, trash }: { sort: { key: SortKey; dir: SortDir }; onSort: (key: SortKey) => void; allChecked: boolean; someChecked: boolean; onToggleAll: () => void; trash: boolean }) {
  const col = (key: SortKey, label: string, className?: string) => {
    const active = sort.key === key;
    return (
      <div role="columnheader" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={className}>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onSort(key)}
          className={cn("inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand", active && "text-ink")}
        >
          {label}
          {active ? sort.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden /> : null}
        </button>
      </div>
    );
  };
  return (
    <div role="rowgroup" className="border-b border-line bg-muted/60">
      <div role="row" className={cn("grid items-center gap-2 px-3 py-1.5 text-xs font-medium text-ink-3", LIST_COLS)}>
        <div role="columnheader" className="flex items-center">
          <input
            type="checkbox"
            tabIndex={-1}
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = someChecked && !allChecked;
            }}
            onChange={onToggleAll}
            aria-label={allChecked ? "Clear selection" : "Select everything here"}
            className="h-4 w-4 cursor-pointer rounded border-line-2 accent-[var(--color-brand)]"
          />
        </div>
        {col("name", SORT_LABEL.name)}
        <div role="columnheader" className="hidden @2xl:block">
          Who can open
        </div>
        {col("modified", trash ? "Modified" : SORT_LABEL.modified, "hidden @2xl:block")}
        {col("size", SORT_LABEL.size, "hidden @2xl:block")}
        <div role="columnheader" aria-label="Actions" />
      </div>
    </div>
  );
}

export function ListItems({ rows, kind, selected, focusId, renamingId, dropTargetId, draggingIds, showLocation, trash, handlers }: ItemsProps) {
  return (
    <div role="rowgroup" className="divide-y divide-line">
      {rows.map((row, i) => {
        const isSelected = selected.has(row.id);
        const isFocus = focusId ? focusId === row.id : i === 0;
        const renaming = renamingId === row.id;
        const drag = handlers.dragProps(row);
        return (
          <div
            key={row.id}
            role="row"
            data-item-id={row.id}
            aria-selected={isSelected}
            aria-label={rowLabel(row, kind)}
            tabIndex={isFocus ? 0 : -1}
            ref={(el) => handlers.register(row.id, el)}
            onClick={(e) => handlers.onClick(e, row)}
            onDoubleClick={() => handlers.onOpen(row)}
            {...drag}
            className={cn(
              "group grid cursor-default select-none items-center gap-2 px-3 py-1.5 text-sm outline-none transition-colors",
              LIST_COLS,
              isSelected ? "bg-brand-50" : "hover:bg-muted/60",
              "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
              dropTargetId === row.id && "bg-brand-100 ring-2 ring-inset ring-brand",
              draggingIds.has(row.id) && "opacity-50",
            )}
          >
            <div role="gridcell" className="flex items-center">
              <Checkbox row={row} checked={isSelected} onToggle={handlers.onToggle} />
            </div>
            <div role="gridcell" className="flex min-w-0 items-center gap-2.5">
              <ItemIcon row={row} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  {renaming ? (
                    <RenameInput row={row} onCommit={(name) => handlers.onRenameCommit(row, name)} onCancel={handlers.onRenameCancel} />
                  ) : (
                    <span className="truncate font-medium text-ink" title={row.name}>
                      {row.name}
                    </span>
                  )}
                  {renaming ? null : <Badges row={row} />}
                  <VisIcon vis={row.effective} kind={row.spaceKind ?? kind} inherited={row.visibility === "INHERIT"} className="@2xl:hidden" />
                </div>
                <p className={cn("truncate text-xs text-ink-3", !showLocation && "@2xl:hidden")}>{metaLine(row, showLocation, trash)}</p>
              </div>
            </div>
            <div role="gridcell" className="hidden min-w-0 @2xl:block">
              <VisIcon vis={row.effective} kind={row.spaceKind ?? kind} inherited={row.visibility === "INHERIT"} withLabel className="max-w-full truncate" />
            </div>
            <div role="gridcell" className="hidden truncate text-ink-2 @2xl:block">
              {trash && row.trashedAt ? fmtDate(row.trashedAt, "MMM d, yyyy") : fmtDate(row.updatedAt, "MMM d, yyyy")}
            </div>
            <div role="gridcell" className="hidden truncate tabular-nums text-ink-2 @2xl:block">
              {row.isFolder ? (row.childCount !== null ? `${row.childCount} ${row.childCount === 1 ? "item" : "items"}` : "—") : formatBytes(row.sizeBytes)}
            </div>
            <div role="gridcell" className="flex justify-end">
              <MoreButton row={row} onMore={handlers.onMore} className={cn("opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100", isSelected && "pointer-fine:opacity-100")} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Grid (icons) view ───────────────────────────────────────────────────────

export function GridItems({ rows, kind, selected, focusId, renamingId, dropTargetId, draggingIds, showLocation, trash, handlers }: ItemsProps) {
  return (
    <div role="rowgroup" className="grid grid-cols-2 gap-3 p-3 @md:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5 @6xl:grid-cols-6">
      {rows.map((row, i) => {
        const isSelected = selected.has(row.id);
        const isFocus = focusId ? focusId === row.id : i === 0;
        const renaming = renamingId === row.id;
        const drag = handlers.dragProps(row);
        return (
          <div
            key={row.id}
            role="row"
            data-item-id={row.id}
            aria-selected={isSelected}
            aria-label={rowLabel(row, kind)}
            tabIndex={isFocus ? 0 : -1}
            ref={(el) => handlers.register(row.id, el)}
            onClick={(e) => handlers.onClick(e, row)}
            onDoubleClick={() => handlers.onOpen(row)}
            {...drag}
            className={cn(
              "group relative flex min-w-0 cursor-default select-none flex-col overflow-hidden rounded-xl border bg-surface text-sm outline-none transition-colors",
              isSelected ? "border-brand-200 bg-brand-50 ring-1 ring-brand-200" : "border-line hover:border-line-2 hover:bg-muted/40",
              "focus-visible:ring-2 focus-visible:ring-brand",
              dropTargetId === row.id && "border-brand bg-brand-100 ring-2 ring-brand",
              draggingIds.has(row.id) && "opacity-50",
            )}
          >
            <div role="gridcell" className="contents">
              <div className="relative aspect-[4/3] w-full border-b border-line bg-muted/40 p-2">
                <ItemIcon row={row} size="lg" />
                <span className={cn("absolute left-2 top-2 rounded bg-surface/90 p-0.5 shadow-sm transition-opacity", isSelected ? "opacity-100" : "opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100")}>
                  <Checkbox row={row} checked={isSelected} onToggle={handlers.onToggle} />
                </span>
                <MoreButton
                  row={row}
                  onMore={handlers.onMore}
                  className={cn("absolute right-1.5 top-1.5 h-7 w-7 bg-surface/90 shadow-sm", isSelected ? "opacity-100" : "opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100")}
                />
              </div>
              <div className="min-w-0 px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  {renaming ? (
                    <RenameInput row={row} onCommit={(name) => handlers.onRenameCommit(row, name)} onCancel={handlers.onRenameCancel} />
                  ) : (
                    <span className="line-clamp-2 min-w-0 flex-1 break-words font-medium leading-snug text-ink" title={row.name}>
                      {row.name}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
                  <VisIcon vis={row.effective} kind={row.spaceKind ?? kind} inherited={row.visibility === "INHERIT"} />
                  <Badges row={row} />
                  <span className="truncate">{metaLine(row, showLocation, trash)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
