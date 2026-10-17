"use client";

import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { ChevronRight, Folder, FolderLock, FolderOpen, Home } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { FolderNode } from "@/lib/files/types";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function childrenMap(nodes: FolderNode[]) {
  const map = new Map<string | null, FolderNode[]>();
  for (const n of nodes) {
    const list = map.get(n.parentId) ?? [];
    list.push(n);
    map.set(n.parentId, list);
  }
  for (const list of map.values()) list.sort((a, b) => collator.compare(a.name, b.name));
  return map;
}

/** Ids of a folder and every folder inside it. */
export function descendantsOf(nodes: FolderNode[], ids: Iterable<string>): Set<string> {
  const kids = childrenMap(nodes);
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of kids.get(id) ?? []) stack.push(c.id);
  }
  return out;
}

function ancestorsOf(nodes: FolderNode[], id: string | null | undefined): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  let current = id ? byId.get(id) : undefined;
  while (current && out.length < 64) {
    out.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return out;
}

export type TreeDrop = {
  /** Return true when this drag can land on `target` (null = top level). */
  canDrop: (e: DragEvent, target: string | null) => boolean;
  onDrop: (e: DragEvent, target: string | null) => void;
};

/**
 * Folder tree: the explorer's sidebar and the "Move to…" chooser. Each folder
 * is a button (open / choose) with a separate expand toggle, so it works with
 * a keyboard and a screen reader without custom tree semantics.
 */
export function FolderTree({
  nodes,
  rootLabel,
  activeId,
  onChoose,
  disabled,
  rootDisabled,
  drop,
  rootIcon,
  className,
  label = "Folders",
}: {
  nodes: FolderNode[];
  rootLabel: string;
  /** The highlighted folder (null = top level, undefined = nothing). */
  activeId: string | null | undefined;
  onChoose: (id: string | null) => void;
  disabled?: Set<string>;
  rootDisabled?: boolean;
  drop?: TreeDrop;
  rootIcon?: ReactNode;
  className?: string;
  label?: string;
}) {
  const kids = useMemo(() => childrenMap(nodes), [nodes]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(ancestorsOf(nodes, activeId).slice(1)));
  const [over, setOver] = useState<string | null | undefined>(undefined);

  // Opening a folder elsewhere (breadcrumbs, double-click) reveals it here.
  useEffect(() => {
    const up = ancestorsOf(nodes, activeId).slice(1);
    if (up.length) setOpen((s) => (up.every((id) => s.has(id)) ? s : new Set([...s, ...up])));
  }, [activeId, nodes]);

  function toggle(id: string) {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function dropProps(target: string | null) {
    if (!drop) return {};
    return {
      onDragOver: (e: DragEvent) => {
        if (!drop.canDrop(e, target)) return;
        e.preventDefault();
        e.stopPropagation();
        if (over !== target) setOver(target);
      },
      onDragLeave: () => setOver((o) => (o === target ? undefined : o)),
      onDrop: (e: DragEvent) => {
        setOver(undefined);
        if (!drop.canDrop(e, target)) return;
        e.preventDefault();
        e.stopPropagation();
        drop.onDrop(e, target);
      },
    };
  }

  const row = (active: boolean, isOver: boolean, isDisabled: boolean) =>
    cn(
      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-brand",
      active ? "bg-brand-50 font-medium text-brand" : "text-ink-2 hover:bg-muted hover:text-ink",
      isOver && "bg-brand-100 text-brand ring-2 ring-brand-200",
      isDisabled && "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-ink-2",
    );

  function renderLevel(parent: string | null, depth: number): ReactNode {
    const list = kids.get(parent) ?? [];
    if (!list.length) return null;
    return (
      <ul className={cn(depth > 0 && "ml-3 border-l border-line pl-1")}>
        {list.map((n) => {
          const hasKids = (kids.get(n.id)?.length ?? 0) > 0;
          const expanded = open.has(n.id);
          const isDisabled = Boolean(disabled?.has(n.id));
          const active = activeId === n.id;
          const Icon = n.effective === "LEADERS" ? FolderLock : active || expanded ? FolderOpen : Folder;
          return (
            <li key={n.id}>
              <div className="flex items-center">
                {hasKids ? (
                  <button
                    type="button"
                    onClick={() => toggle(n.id)}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} folders in ${n.name}`}
                    className="flex h-7 w-5 shrink-0 items-center justify-center rounded text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} aria-hidden />
                  </button>
                ) : (
                  <span className="w-5 shrink-0" aria-hidden />
                )}
                <button
                  type="button"
                  className={row(active, over === n.id, isDisabled)}
                  onClick={() => !isDisabled && onChoose(n.id)}
                  aria-disabled={isDisabled || undefined}
                  aria-current={active ? "true" : undefined}
                  title={n.name}
                  {...dropProps(n.id)}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{n.name}</span>
                </button>
              </div>
              {hasKids && expanded ? renderLevel(n.id, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <nav aria-label={label} className={className}>
      <button
        type="button"
        className={cn(row(activeId === null, over === null, Boolean(rootDisabled)), "w-full")}
        onClick={() => !rootDisabled && onChoose(null)}
        aria-disabled={rootDisabled || undefined}
        aria-current={activeId === null ? "true" : undefined}
        {...dropProps(null)}
      >
        {rootIcon ?? <Home className="h-4 w-4 shrink-0" aria-hidden />}
        <span className="truncate">{rootLabel}</span>
      </button>
      <div className="mt-0.5">{renderLevel(null, 0)}</div>
    </nav>
  );
}
