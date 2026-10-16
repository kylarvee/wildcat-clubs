import { ExternalLink, VideoOff } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { safeHttpUrl, videoInfo } from "@/lib/rich/embeds";

/**
 * CONTRACT (owner: rich-text builder). YouTube or Google Drive video player.
 * YouTube links (watch, shorts, live, youtu.be) play through
 * youtube-nocookie.com; Drive files through Drive's /preview player (the file
 * must be shared with "Anyone with the link"). Anything else shows a link.
 * Works in server and client components.
 */
export function VideoEmbed({ url, title, className }: { url: string; title?: string | null; className?: string }) {
  const info = videoInfo(url);
  const name = title?.trim() || null;

  if (!info) {
    const href = safeHttpUrl(url);
    return (
      <div className={cn("flex items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-card)]", className)}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-3">
          <VideoOff className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{name ?? "Video"}</p>
          <p className="text-xs text-ink-3">This video can&apos;t play here. Only YouTube and Google Drive videos play in the page.</p>
        </div>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
            Open <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
    );
  }

  const label = name ?? `${info.providerLabel} video`;
  return (
    <figure className={cn("overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]", className)}>
      <div className="relative aspect-video w-full bg-ink">
        <iframe
          src={info.embedUrl}
          title={label}
          className="absolute inset-0 h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-sm">
        <span className="min-w-0 flex-[1_1_9rem] truncate font-medium text-ink">{label}</span>
        <a
          href={info.openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {info.provider === "youtube" ? "Watch on YouTube" : "Open in Drive"}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </figcaption>
    </figure>
  );
}
