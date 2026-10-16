import Link from "next/link";
import { ExternalLink, File, FileImage, FileSpreadsheet, FileText, FileVideo, Lock, ScrollText } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { clubResources } from "@/lib/clubs/queries";
import { fmtLongDate } from "@/lib/time";
import { RichContent } from "@/components/rich/RichContent";
import { buttonClasses } from "@/components/ui/button";
import { DocumentReader } from "@/components/clubs/DocumentReader";

const DOC_KIND_LABEL = { CONSTITUTION: "Constitution", BYLAWS: "Bylaws", OTHER: "Document" } as const;

function fileIcon(mime: string | null) {
  if (!mime) return File;
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.includes("sheet") || mime.includes("csv") || mime.includes("excel")) return FileSpreadsheet;
  if (mime.includes("pdf") || mime.includes("word") || mime.includes("text") || mime.includes("document") || mime.includes("presentation")) return FileText;
  return File;
}

function fmtSize(bytes: number | null) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The club page "Resources": active constitution/bylaws plus files the club featured (only those this viewer may open). */
export async function ClubResources({ clubId, clubSlug, viewer, canManageFiles }: { clubId: string; clubSlug: string; viewer: Actor | null; canManageFiles: boolean }) {
  const { files, documents } = await clubResources(clubId, viewer);

  if (files.length === 0 && documents.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface px-4 py-6 text-center text-sm text-ink-3">
        <p>No resources shared yet.</p>
        {canManageFiles ? (
          <p className="mt-1">
            <Link href={`/clubs/${clubSlug}/manage/files`} className="font-medium text-brand-600 hover:underline">
              Feature files from Club Files
            </Link>{" "}
            to list them here.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      {documents.map((d) => (
        <li key={d.id} className="flex items-start gap-3 p-3.5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand" aria-hidden="true">
            <ScrollText className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug text-ink">{d.title}</p>
            <p className="text-xs text-ink-3">
              {DOC_KIND_LABEL[d.kind]} · version {d.version} · adopted {fmtLongDate(d.adoptedAt)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {d.contentHtml ? (
                <DocumentReader title={d.title} subtitle={`${DOC_KIND_LABEL[d.kind]}, version ${d.version}`}>
                  <RichContent html={d.contentHtml} />
                </DocumentReader>
              ) : null}
              {d.fileId ? (
                <a href={`/api/files/${d.fileId}`} target="_blank" rel="noopener noreferrer" className={buttonClasses("outline", "sm")}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> PDF
                </a>
              ) : d.fileLocked && !d.contentHtml ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {viewer ? "Members only" : "Log in to view"}
                </span>
              ) : null}
            </div>
          </div>
        </li>
      ))}
      {files.map((f) => {
        const Icon = fileIcon(f.mimeType);
        const size = fmtSize(f.sizeBytes);
        return (
          <li key={f.id}>
            <a
              href={`/api/files/${f.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-2" aria-hidden="true">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{f.name}</span>
                <span className="block text-xs text-ink-3">
                  {size ? `${size} · ` : ""}updated {fmtLongDate(f.updatedAt)}
                </span>
              </span>
              <ExternalLink className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
