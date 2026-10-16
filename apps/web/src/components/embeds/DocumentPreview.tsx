/**
 * CONTRACT (owner: rich-text builder). Inline preview of a document: PDFs and
 * images render in place; Google Docs/Sheets/Slides via their embed URLs; other
 * types show a file card with download. Pass a club/university file id (served
 * by /api/files/[id]) or an external URL.
 * STUB.
 */
export type DocumentPreviewProps = { fileId?: string; url?: string; name: string; mimeType?: string | null; height?: number; className?: string };

export function DocumentPreview({ fileId, url, name }: DocumentPreviewProps) {
  const href = url ?? (fileId ? `/api/files/${fileId}` : "#");
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand underline">
      {name}
    </a>
  );
}
