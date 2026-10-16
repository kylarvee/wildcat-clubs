"use client";

import { Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { CalendarDays, ExternalLink, FileText, MapPin, PlayCircle, Trash2 } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { FileKindIcon } from "@/components/embeds/FileKindIcon";
import { FILE_KIND_LABEL, fileKind, googleDocInfo, isEmbedKind, mapsSearchUrl, safeHttpUrl, videoInfo, type EmbedAttrs, type EmbedKind } from "@/lib/rich/embeds";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embed: {
      /** Inserts an embed as its own top-level block near the cursor. */
      insertEmbed: (attrs: Partial<EmbedAttrs> & { embed: EmbedKind }) => ReturnType;
    };
  }
}

const KIND_LABEL: Record<EmbedKind, string> = { video: "Video", document: "Document", file: "File", event: "Event", map: "Map" };

function dataAttr(name: "id" | "src" | "title" | "mime") {
  return {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) || null,
    renderHTML: (attrs: Record<string, unknown>) => (attrs[name] ? { [`data-${name}`]: String(attrs[name]) } : {}),
  };
}

/**
 * The "embed" node: a block-level, atomic placeholder stored as
 * <div data-embed="…" data-id data-src data-title data-mime></div>.
 * It lives only at the top level of the document (group "embedBlock" is
 * allowed by the editor's doc node, not inside lists or tables), which is
 * where <RichContent> turns it into a live preview.
 */
export const EmbedNode = Node.create({
  name: "embed",
  group: "embedBlock",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      embed: {
        default: "file",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-embed"),
        renderHTML: (attrs: Record<string, unknown>) => ({ "data-embed": String(attrs.embed) }),
      },
      id: dataAttr("id"),
      src: dataAttr("src"),
      title: dataAttr("title"),
      mime: dataAttr("mime"),
    };
  },

  parseHTML() {
    return [
      { tag: "div[data-embed]", getAttrs: (el: HTMLElement) => (isEmbedKind(el.getAttribute("data-embed")) ? null : false) },
      // Older or pasted content with a raw YouTube / Google iframe becomes a proper embed.
      {
        tag: "iframe[src]",
        getAttrs: (el: HTMLElement) => {
          const src = el.getAttribute("src");
          const title = el.getAttribute("title");
          if (videoInfo(src)) return { embed: "video", src, title };
          if (googleDocInfo(src)) return { embed: "document", src, title };
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", HTMLAttributes];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },

  addCommands() {
    return {
      insertEmbed:
        (attrs) =>
        ({ state, chain }) => {
          const node = { type: this.name, attrs: { id: null, src: null, title: null, mime: null, ...attrs } };
          const { $from } = state.selection;
          const top = $from.depth > 0 ? $from.node(1) : null;
          // An empty top-level paragraph is replaced; otherwise the embed goes right after the block you're in.
          const at =
            !top ? state.selection.from : top.type.name === "paragraph" && top.content.size === 0 ? { from: $from.before(1), to: $from.after(1) } : $from.after(1);
          return chain()
            .insertContentAt(at, node)
            .command(({ tr }) => {
              // Leave the cursor on a line after the embed (adding one if needed), so typing
              // carries on below it instead of replacing the selected embed.
              const after = tr.selection.to;
              if (!tr.doc.resolve(after).nodeAfter?.isTextblock) tr.insert(after, state.schema.nodes.paragraph.create());
              tr.setSelection(TextSelection.create(tr.doc, after + 1));
              return true;
            })
            .run();
        },
    };
  },
});

function describe(a: EmbedAttrs): { label: string; title: string; subtitle: string | null; href: string | null; thumb: string | null } {
  switch (a.embed) {
    case "video": {
      const info = videoInfo(a.src);
      return {
        label: info ? `${info.providerLabel} video` : "Video",
        title: a.title || (info ? `${info.providerLabel} video` : "Video"),
        subtitle: a.src,
        href: info?.openUrl ?? safeHttpUrl(a.src),
        thumb: info?.thumbnailUrl ?? null,
      };
    }
    case "document": {
      const g = googleDocInfo(a.src);
      return { label: g?.label ?? "Linked document", title: a.title || g?.label || "Document", subtitle: a.src, href: g?.openUrl ?? safeHttpUrl(a.src), thumb: null };
    }
    case "file": {
      const kind = fileKind(a.mime, a.title);
      return { label: `Club file · ${FILE_KIND_LABEL[kind]}`, title: a.title || "Attached file", subtitle: "Shown to people who can open this file", href: a.id ? `/api/files/${a.id}` : null, thumb: null };
    }
    case "event":
      return { label: "Event", title: a.title || "Event", subtitle: "Shows the next date, place and host club", href: a.id ? `/events/${a.id}` : null, thumb: null };
    case "map": {
      const q = a.src || a.title || "";
      return { label: "Map", title: a.title || a.src || "Location", subtitle: a.src && a.src !== a.title ? a.src : null, href: q ? mapsSearchUrl(q) : null, thumb: null };
    }
  }
}

function KindIcon({ a }: { a: EmbedAttrs }) {
  const cls = "h-5 w-5";
  switch (a.embed) {
    case "video":
      return <PlayCircle className={cls} aria-hidden />;
    case "event":
      return <CalendarDays className={cls} aria-hidden />;
    case "map":
      return <MapPin className={cls} aria-hidden />;
    case "document":
      return <FileText className={cls} aria-hidden />;
    case "file":
      return <FileKindIcon kind={fileKind(a.mime, a.title)} className={cls} />;
  }
}

// Icons ignore the pointer so clicks target the <button> itself: ProseMirror leaves events on
// buttons inside a node view alone, but would treat a click on the bare <svg> as selecting the node.
const iconButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand [&_svg]:pointer-events-none";

/** In-editor preview card: what's embedded, a way to open it, and a remove button. */
function EmbedView({ node, selected, deleteNode, editor }: ReactNodeViewProps) {
  const attrs = node.attrs as EmbedAttrs;
  if (!isEmbedKind(attrs.embed)) return <NodeViewWrapper />;
  const d = describe(attrs);
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper
      data-embed-view=""
      contentEditable={false}
      data-drag-handle=""
      className={cn(
        "group/embed flex items-center gap-3 rounded-xl border bg-surface p-2.5 pr-2 shadow-[var(--shadow-card)] transition-colors",
        selected ? "border-brand ring-2 ring-brand-100" : "border-line hover:border-line-2",
        editable && "cursor-grab active:cursor-grabbing",
      )}
    >
      {d.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.thumb} alt="" className="m-0! h-14 w-24 shrink-0 rounded-lg! object-cover" draggable={false} />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand">
          <KindIcon a={attrs} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{d.label}</span>
        <span className="truncate text-sm font-medium text-ink">{d.title}</span>
        {d.subtitle ? <span className="truncate text-xs text-ink-3">{d.subtitle}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        {d.href ? (
          <button
            type="button"
            onClick={() => window.open(d.href!, "_blank", "noopener,noreferrer")}
            className={iconButton}
            aria-label={`Open ${KIND_LABEL[attrs.embed].toLowerCase()} in a new tab`}
            title="Open in a new tab"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        {editable ? (
          <button
            type="button"
            onClick={() => deleteNode()}
            className={cn(iconButton, "hover:bg-danger-50 hover:text-danger")}
            aria-label={`Remove ${KIND_LABEL[attrs.embed].toLowerCase()}: ${d.title}`}
            title="Remove"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </span>
    </NodeViewWrapper>
  );
}
