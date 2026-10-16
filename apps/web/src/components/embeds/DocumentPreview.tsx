import type { ReactNode } from "react";
import { Download, ExternalLink, FileWarning } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { FILE_KIND_TONE, FileKindIcon, GOOGLE_KIND_TO_FILE_KIND } from "@/components/embeds/FileKindIcon";
import { FILE_KIND_LABEL, fileKind, formatBytes, googleDocInfo, safeHttpUrl } from "@/lib/rich/embeds";

/**
 * CONTRACT (owner: rich-text builder). Inline preview of a document: PDFs and
 * images render in place; Google Docs/Sheets/Slides/Forms/Drive via their
 * embed URLs; uploaded audio/video play inline; other types show a file card
 * with Open and Download. Pass a club/university file id (served by
 * /api/files/[id], which checks permission) or an external URL.
 * Callers showing a platform file should check canViewFile() first
 * (RichContent does). Works in server and client components.
 */
export type DocumentPreviewProps = {
  fileId?: string;
  url?: string;
  name: string;
  mimeType?: string | null;
  /** Height of PDF / Google previews in px (capped at 75% of the screen). */
  height?: number;
  className?: string;
  sizeBytes?: number | null;
  /** Show only the file card, never the inline preview. */
  compact?: boolean;
};

const iconButton =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand";

export function DocumentPreview({ fileId, url, name, mimeType, height = 560, className, sizeBytes, compact }: DocumentPreviewProps) {
  const google = fileId ? null : googleDocInfo(url);
  const external = fileId ? null : safeHttpUrl(url);
  const fileHref = fileId ? `/api/files/${encodeURIComponent(fileId)}` : null;
  const openHref = fileHref ?? google?.openUrl ?? external;
  const downloadHref = fileHref ? `${fileHref}?download=1` : null;

  const kind = google ? GOOGLE_KIND_TO_FILE_KIND[google.kind] : fileKind(mimeType, name || url);
  const displayName = name?.trim() || google?.label || (external ? new URL(external).hostname : "Document");
  const kindLabel = google?.label ?? FILE_KIND_LABEL[kind];
  const meta = [kindLabel === displayName ? null : kindLabel, formatBytes(sizeBytes)].filter(Boolean).join(" · ") || (external ? new URL(external).hostname : "");
  const frameStyle = { height: `min(${height}px, 75vh)` };

  if (!openHref) {
    return (
      <div className={cn("flex items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-card)]", className)}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-3">
          <FileWarning className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{displayName}</p>
          <p className="text-xs text-ink-3">This document link isn&apos;t valid, so it can&apos;t be shown.</p>
        </div>
      </div>
    );
  }

  let body: ReactNode = null;
  if (!compact) {
    if (google) {
      body = <iframe src={google.previewUrl} title={displayName} className="block w-full border-0 bg-muted" style={frameStyle} loading="lazy" allowFullScreen />;
    } else if (fileHref && kind === "pdf") {
      body = <iframe src={fileHref} title={displayName} className="block w-full border-0 bg-muted" style={frameStyle} loading="lazy" />;
    } else if ((fileHref || external) && kind === "image") {
      body = (
        <div className="flex justify-center bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileHref ?? external!} alt={displayName} className="block max-h-[70vh] w-auto max-w-full object-contain" loading="lazy" />
        </div>
      );
    } else if (fileHref && kind === "video") {
      body = <video src={fileHref} controls preload="metadata" className="block max-h-[70vh] w-full bg-ink" aria-label={displayName} />;
    } else if (fileHref && kind === "audio") {
      body = (
        <div className="px-3 py-3">
          <audio src={fileHref} controls preload="metadata" className="w-full" aria-label={displayName} />
        </div>
      );
    }
  }

  const isExternal = !fileHref;
  const actions = (
    <span className="flex shrink-0 items-center gap-0.5">
      <a href={openHref} target="_blank" rel={isExternal ? "noopener noreferrer nofollow" : "noopener"} className={iconButton} aria-label={`Open ${displayName} in a new tab`} title="Open in a new tab">
        <ExternalLink className="h-4 w-4" aria-hidden />
      </a>
      {downloadHref ? (
        <a href={downloadHref} className={iconButton} aria-label={`Download ${displayName}`} title="Download">
          <Download className="h-4 w-4" aria-hidden />
        </a>
      ) : null}
    </span>
  );

  // Nothing to preview inline: a file card with clear Open / Download buttons.
  if (!body) {
    return (
      <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-card)] sm:flex-nowrap", className)}>
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", FILE_KIND_TONE[kind])}>
          <FileKindIcon kind={kind} google={google?.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink" title={displayName}>
            {displayName}
          </p>
          <p className="truncate text-xs text-ink-3">{meta}</p>
        </div>
        <div className="flex w-full shrink-0 gap-2 sm:w-auto">
          <a href={openHref} target="_blank" rel={isExternal ? "noopener noreferrer nofollow" : "noopener"} className={buttonClasses("outline", "sm", "flex-1 sm:flex-none")}>
            <ExternalLink className="h-4 w-4" aria-hidden /> Open
          </a>
          {downloadHref ? (
            <a href={downloadHref} className={buttonClasses("secondary", "sm", "flex-1 sm:flex-none")}>
              <Download className="h-4 w-4" aria-hidden /> Download
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <figure className={cn("overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]", className)}>
      <figcaption className="flex items-center gap-2.5 border-b border-line px-3 py-2">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", FILE_KIND_TONE[kind])}>
          <FileKindIcon kind={kind} google={google?.kind} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink" title={displayName}>
            {displayName}
          </span>
          <span className="block truncate text-xs text-ink-3">{meta}</span>
        </span>
        {actions}
      </figcaption>
      {body}
    </figure>
  );
}
