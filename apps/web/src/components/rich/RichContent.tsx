import "server-only";
import { headers } from "next/headers";
import { FileX2, Lock } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { DocumentPreview } from "@/components/embeds/DocumentPreview";
import { EmbedNotice } from "@/components/embeds/EmbedNotice";
import { MapEmbed } from "@/components/embeds/MapEmbed";
import { VideoEmbed } from "@/components/embeds/VideoEmbed";
import { EventEmbedCard } from "@/components/rich/EventEmbedCard";
import { RichStyles } from "@/components/rich/RichStyles";
import { db } from "@/lib/db";
import { getCurrentUser, type Actor } from "@/lib/auth/session";
import { canViewFile } from "@/lib/domain/files";
import { INSTITUTION } from "@/lib/institution";
import { splitRichHtml, type EmbedAttrs } from "@/lib/rich/embeds";
import { richToText, sanitizeRichHtml } from "@/lib/rich/sanitize";

/**
 * CONTRACT (owner: rich-text builder). Renders stored rich HTML and turns
 * <div data-embed> placeholders into live embeds: video player, document
 * preview (permission-checked club files or Google docs), event card
 * (respecting event visibility) and map. Server component.
 *
 * The HTML is sanitized again here (cheap, and it means a write path that
 * forgot to sanitize can't put a script on the page).
 */
export async function RichContent({ html, className }: { html: string | null | undefined; className?: string }) {
  const clean = sanitizeRichHtml(html);
  if (!clean.trim()) return null;
  const parts = splitRichHtml(wrapTables(clean));

  if (parts.every((p) => p.type === "html")) {
    return (
      <>
        <RichStyles />
        <div className={cn("prose-wc", className)} dangerouslySetInnerHTML={{ __html: parts.map((p) => (p.type === "html" ? p.html : "")).join("") }} />
      </>
    );
  }

  const viewer = await getCurrentUser();
  const next = (await headers()).get("x-pathname");
  const signInHref = `/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <div className={cn("space-y-4", className)}>
      <RichStyles />
      {parts.map((p, i) =>
        p.type === "html" ? (
          <div key={i} className="prose-wc" dangerouslySetInnerHTML={{ __html: p.html }} />
        ) : (
          <Embed key={i} attrs={p.attrs} viewer={viewer} signInHref={signInHref} />
        ),
      )}
    </div>
  );
}

/** Short plain-text preview of rich HTML (cards, lists, notifications). */
export function RichContentText({ html, max = 200, className }: { html: string | null | undefined; max?: number; className?: string }) {
  const text = richToText(html, max).replace(/\s*\n+\s*/g, " ");
  if (!text) return null;
  return <span className={className}>{text}</span>;
}

/** Wide tables scroll sideways on phones instead of pushing the page wider. */
function wrapTables(html: string) {
  return html.replace(/<table\b/g, '<div class="wc-table-scroll"><table').replace(/<\/table>/g, "</table></div>");
}

async function Embed({ attrs, viewer, signInHref }: { attrs: EmbedAttrs; viewer: Actor | null; signInHref: string }) {
  switch (attrs.embed) {
    case "video":
      return attrs.src ? <VideoEmbed url={attrs.src} title={attrs.title} /> : null;
    case "event":
      return <EventEmbedCard eventId={attrs.id} viewer={viewer} signInHref={signInHref} />;
    case "map": {
      const building = attrs.id ? await db.building.findUnique({ where: { id: attrs.id } }).catch(() => null) : null;
      if (building) return <MapEmbed query={`${building.name}, ${INSTITUTION.mapsSuffix}`} lat={building.lat} lng={building.lng} label={attrs.title || building.name} />;
      return <MapEmbed query={attrs.src} label={attrs.title} />;
    }
    case "file":
    case "document":
      if (attrs.id) return <FileEmbed fileId={attrs.id} viewer={viewer} signInHref={signInHref} />;
      return attrs.src ? <DocumentPreview url={attrs.src} name={attrs.title ?? ""} mimeType={attrs.mime} /> : null;
  }
}

async function FileEmbed({ fileId, viewer, signInHref }: { fileId: string; viewer: Actor | null; signInHref: string }) {
  const file = await db.fileItem.findUnique({ where: { id: fileId } }).catch(() => null);
  if (!file || file.isFolder || file.trashedAt) {
    return <EmbedNotice icon={<FileX2 />} title="This file was removed." />;
  }
  if (!(await canViewFile(viewer, file))) {
    // Don't show the name of a file the viewer can't open.
    return (
      <EmbedNotice
        icon={<Lock />}
        title="You don't have access to this file."
        action={
          viewer ? null : (
            <ButtonLink href={signInHref} variant="outline" size="sm">
              Sign in
            </ButtonLink>
          )
        }
      >
        {viewer ? "It's shared with a smaller group. Ask a club leader if you need it." : "It may be shared with Weber State accounts or club members."}
      </EmbedNotice>
    );
  }
  return <DocumentPreview fileId={file.id} name={file.name} mimeType={file.mimeType} sizeBytes={file.sizeBytes} />;
}
