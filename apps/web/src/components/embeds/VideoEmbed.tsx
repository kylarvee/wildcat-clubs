/**
 * CONTRACT (owner: rich-text builder). YouTube or Google Drive video player.
 * STUB.
 */
export function VideoEmbed({ url, title }: { url: string; title?: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand underline">
      {title ?? url}
    </a>
  );
}
