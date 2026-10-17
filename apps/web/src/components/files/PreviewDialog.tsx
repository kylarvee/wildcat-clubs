"use client";

import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Share2 } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DocumentPreview } from "@/components/embeds/DocumentPreview";
import { VisIcon } from "@/components/files/FileVisuals";
import { fmtLongDate, fmtTime } from "@/lib/time";
import { formatBytes } from "@/lib/rich/embeds";
import { kindLabel } from "@/lib/files/listing";
import { visCopy } from "@/lib/files/visibility";
import type { FileRow, FileScopeKind } from "@/lib/files/types";

/**
 * Quick look: the file inline (PDFs, images, audio, video) with its details,
 * and arrows (or ← →) to step through the other files in the folder.
 */
export function PreviewDialog({
  row,
  kind,
  location,
  onClose,
  onStep,
  hasPrev,
  hasNext,
  onShare,
  onCopyLink,
}: {
  row: FileRow | null;
  kind: FileScopeKind;
  location: string;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
  onShare?: () => void;
  onCopyLink: () => void;
}) {
  useEffect(() => {
    if (!row) return;
    function key(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, video, audio")) return;
      if (e.key === "ArrowLeft" && hasPrev) onStep(-1);
      if (e.key === "ArrowRight" && hasNext) onStep(1);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [row, hasPrev, hasNext, onStep]);

  const inherited = row ? row.visibility === "INHERIT" : false;
  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => (!o ? onClose() : null)}>
      {row ? (
        <DialogContent wide title={row.name} description={`${kindLabel(row)}${row.sizeBytes ? ` · ${formatBytes(row.sizeBytes)}` : ""}`} className="max-w-5xl">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_15rem]">
            <div className="min-w-0">
              <DocumentPreview key={row.id} fileId={row.id} name={row.name} mimeType={row.mimeType} sizeBytes={row.sizeBytes} height={620} />
              <div className="mt-3 flex items-center justify-between gap-2">
                <Button variant="outline" size="sm" onClick={() => onStep(-1)} disabled={!hasPrev} aria-label="Previous file">
                  <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
                </Button>
                <span className="hidden text-xs text-ink-3 sm:inline">Use ← and → to flip through this folder</span>
                <Button variant="outline" size="sm" onClick={() => onStep(1)} disabled={!hasNext} aria-label="Next file">
                  Next <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
            <aside className="space-y-4 text-sm">
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Who can open it</dt>
                  <dd className="mt-0.5 flex items-center gap-1.5 text-ink">
                    <VisIcon vis={row.effective} kind={kind} inherited={inherited} />
                    {visCopy(kind, row.effective).short}
                    {inherited ? <span className="text-ink-3">(from its folder)</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Location</dt>
                  <dd className="mt-0.5 break-words text-ink">{location}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Modified</dt>
                  <dd className="mt-0.5 text-ink">
                    {fmtLongDate(row.updatedAt)} at {fmtTime(row.updatedAt)}
                  </dd>
                </div>
                {row.createdBy ? (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Added by</dt>
                    <dd className="mt-0.5 text-ink">{row.createdBy.name}</dd>
                  </div>
                ) : null}
                {row.featured ? (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Club page</dt>
                    <dd className="mt-0.5 text-ink">Listed under Resources</dd>
                  </div>
                ) : null}
              </dl>
              <div className="flex flex-col gap-2">
                <a href={`${row.url}?download=1`} className={buttonClasses("primary", "sm")}>
                  <Download className="h-4 w-4" aria-hidden /> Download
                </a>
                <a href={row.url ?? "#"} target="_blank" rel="noopener" className={buttonClasses("outline", "sm")}>
                  <ExternalLink className="h-4 w-4" aria-hidden /> Open in a new tab
                </a>
                <Button variant="outline" size="sm" onClick={onCopyLink}>
                  <Copy className="h-4 w-4" aria-hidden /> Copy link
                </Button>
                {onShare ? (
                  <Button variant="outline" size="sm" onClick={onShare}>
                    <Share2 className="h-4 w-4" aria-hidden /> Share & permissions…
                  </Button>
                ) : null}
              </div>
            </aside>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
