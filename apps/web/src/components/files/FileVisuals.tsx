"use client";

import { useState } from "react";
import { Folder, FolderLock, Globe2, Lock, Users } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { FILE_KIND_TONE, FileKindIcon } from "@/components/embeds/FileKindIcon";
import { fileKind } from "@/lib/rich/embeds";
import { visCopy } from "@/lib/files/visibility";
import type { FileRow, FileScopeKind, Vis } from "@/lib/files/types";

/** Icons and small badges shared by the explorer and the picker. */

const VIS_ICON = { PUBLIC: Globe2, MEMBERS: Users, LEADERS: Lock } as const;
const VIS_TONE = { PUBLIC: "text-success", MEMBERS: "text-info", LEADERS: "text-warning" } as const;

export function visSentence(kind: FileScopeKind, vis: Vis, inherited: boolean) {
  const who = visCopy(kind, vis).short;
  return `${inherited ? "Same as its folder: " : "Visible to: "}${who}`;
}

/** Who can open an item, as an icon with a readable label for screen readers and a hover title. */
export function VisIcon({ vis, kind, inherited, className, withLabel }: { vis: Vis; kind: FileScopeKind; inherited?: boolean; className?: string; withLabel?: boolean }) {
  const Icon = VIS_ICON[vis];
  const text = visSentence(kind, vis, Boolean(inherited));
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)} title={text}>
      <Icon className={cn("h-3.5 w-3.5", VIS_TONE[vis], inherited && "opacity-70")} aria-hidden />
      {withLabel ? <span className="text-xs text-ink-3">{visCopy(kind, vis).short}</span> : <span className="sr-only">{text}</span>}
    </span>
  );
}

/** A file's icon tile, or its picture for images (thumbnails load lazily). */
export function ItemIcon({ row, size = "sm", thumbnails = true, className }: { row: Pick<FileRow, "id" | "isFolder" | "mimeType" | "name" | "url" | "effective">; size?: "sm" | "md" | "lg"; thumbnails?: boolean; className?: string }) {
  const [broken, setBroken] = useState(false);
  const box = { sm: "h-8 w-8 rounded-md", md: "h-10 w-10 rounded-lg", lg: "h-full w-full rounded-lg" }[size];
  const icon = { sm: "h-4 w-4", md: "h-5 w-5", lg: "h-10 w-10" }[size];
  if (row.isFolder) {
    const Icon = row.effective === "LEADERS" ? FolderLock : Folder;
    return (
      <span className={cn("flex shrink-0 items-center justify-center bg-brand-50 text-brand", box, className)} aria-hidden>
        <Icon className={icon} fill="currentColor" fillOpacity={0.15} />
      </span>
    );
  }
  const kind = fileKind(row.mimeType, row.name);
  if (kind === "image" && thumbnails && row.url && !broken) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-muted", box, className)} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={row.url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span className={cn("flex shrink-0 items-center justify-center", FILE_KIND_TONE[kind], box, className)} aria-hidden>
      <FileKindIcon kind={kind} className={icon} />
    </span>
  );
}

/** "Users" icon used for "shared with N people". */
export function SharedMark({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 text-[11px] font-medium text-ink-2" title={`Shared with ${count} ${count === 1 ? "person" : "people"}`}>
      <Users className="h-3 w-3" aria-hidden />
      <span aria-hidden>{count}</span>
      <span className="sr-only">{`Shared with ${count} ${count === 1 ? "person" : "people"}`}</span>
    </span>
  );
}
