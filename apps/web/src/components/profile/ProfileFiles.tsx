import { Lock } from "lucide-react";
import { fileKind, formatBytes } from "@/lib/rich/embeds";
import { fileUrl } from "@/lib/domain/files";
import { FileKindIcon } from "@/components/embeds/FileKindIcon";
import type { ProfileFile } from "@/lib/profiles/queries";

/**
 * Files attached to a project or contribution, as chips that open the file.
 * Only files the viewer may open are passed in (canViewFile in the read
 * model); the rest are counted, never named.
 */
export function ProfileFiles({ files, hidden = 0 }: { files: ProfileFile[]; hidden?: number }) {
  if (!files.length && !hidden) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Files">
      {files.map((f) => (
        <li key={f.id} className="min-w-0 max-w-full">
          <a
            href={fileUrl(f.id)}
            target="_blank"
            rel="noopener"
            className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink hover:border-brand-200 hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-brand"
          >
            <FileKindIcon kind={fileKind(f.mimeType, f.name)} className="h-4 w-4 shrink-0 text-brand" />
            <span className="min-w-0 truncate">{f.name}</span>
            {f.sizeBytes ? <span className="shrink-0 text-xs text-ink-3">{formatBytes(f.sizeBytes)}</span> : null}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
      ))}
      {hidden ? (
        <li className="flex items-center gap-1.5 rounded-lg border border-dashed border-line-2 px-2.5 py-1.5 text-xs text-ink-3">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          {hidden} more file{hidden === 1 ? "" : "s"} you don&apos;t have access to
        </li>
      ) : null}
    </ul>
  );
}
