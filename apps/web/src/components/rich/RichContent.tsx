/**
 * CONTRACT (owner: rich-text builder). Renders stored rich HTML (already
 * sanitized at write time) and turns <div data-embed> placeholders into live
 * embeds (video, document preview, club file, event card, map).
 *
 * STUB: plain HTML rendering until the full version lands.
 */
export function RichContent({ html, className }: { html: string | null | undefined; className?: string }) {
  if (!html) return null;
  return <div className={"prose-wc " + (className ?? "")} dangerouslySetInnerHTML={{ __html: html }} />;
}
