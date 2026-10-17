"use client";

import { useMemo, type ReactNode } from "react";
import { CalendarDays, MapPin } from "lucide-react";
import { DocumentPreview } from "@/components/embeds/DocumentPreview";
import { MapEmbed } from "@/components/embeds/MapEmbed";
import { VideoEmbed } from "@/components/embeds/VideoEmbed";
import { RichStyles } from "@/components/rich/RichStyles";
import { splitRichHtml, type EmbedAttrs } from "@/lib/rich/embeds";
import { AnnouncementFrame, type FrameAuthor, type FrameClub } from "@/components/announcements/AnnouncementFrame";

/**
 * Live preview of an announcement while it's being written: the same frame
 * readers see, with the editor's HTML and its embeds (videos, documents,
 * files, maps) rendered in place. Event cards fill in their date and place
 * once posted, since they're looked up for each reader.
 */
export function AnnouncementPreview({
  title,
  html,
  author,
  badge,
  pinned,
  club,
  university,
}: {
  title: string;
  html: string;
  author: FrameAuthor;
  badge: string | null;
  pinned: boolean;
  club?: FrameClub | null;
  university?: boolean;
}) {
  const parts = useMemo(() => splitRichHtml(html), [html]);
  const empty = !parts.some((p) => p.type === "embed" || p.html.replace(/<[^>]+>/g, "").trim() || /<img\b/i.test(p.html));
  return (
    <AnnouncementFrame title={title.trim()} author={author} createdAt={null} pinned={pinned} badge={badge} club={club} university={university}>
      <RichStyles />
      {empty ? (
        <p className="text-sm italic text-ink-3">Your announcement shows here as you write it.</p>
      ) : (
        <div className="space-y-4">
          {parts.map((p, i) =>
            p.type === "html" ? (
              // The editor's own output for the person writing it; it's sanitized again on save and on display.
              <div key={i} className="prose-wc" dangerouslySetInnerHTML={{ __html: p.html }} />
            ) : (
              <PreviewEmbed key={i} attrs={p.attrs} />
            ),
          )}
        </div>
      )}
    </AnnouncementFrame>
  );
}

function PreviewEmbed({ attrs }: { attrs: EmbedAttrs }) {
  switch (attrs.embed) {
    case "video":
      return attrs.src ? <VideoEmbed url={attrs.src} title={attrs.title} /> : null;
    case "document":
      return attrs.src ? <DocumentPreview url={attrs.src} name={attrs.title || "Document"} height={360} /> : null;
    case "file":
      return attrs.id ? <DocumentPreview fileId={attrs.id} name={attrs.title || "File"} mimeType={attrs.mime} height={360} /> : null;
    case "map":
      return attrs.src ? (
        <MapEmbed query={attrs.src} label={attrs.title} height={200} />
      ) : (
        <PlaceholderCard icon={<MapPin className="h-5 w-5" aria-hidden="true" />} title={attrs.title || "Map"} detail="The map shows here once posted." />
      );
    case "event":
      return (
        <PlaceholderCard
          icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
          title={attrs.title || "Event"}
          detail="Readers see the event's next date, place and a link to it. People who can't see the event get a short notice instead."
        />
      );
    default:
      return null;
  }
}

function PlaceholderCard({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-canvas p-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{title}</span>
        <span className="block text-xs text-ink-3">{detail}</span>
      </span>
    </div>
  );
}
