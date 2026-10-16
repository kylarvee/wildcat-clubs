"use client";

import { Extension, Node, type AnyExtension } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { EmbedNode } from "@/components/rich/editor/EmbedNode";

/**
 * The top node. Same as TipTap's Document, except embeds are allowed only
 * here (top level) — never inside a list item or table cell — because
 * that's where <RichContent> can swap them for live previews.
 */
const RichDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "(block | embedBlock)+",
});

/** Cmd/Ctrl+K opens the link dialog (the dialog lives in React, so it's a callback). */
const LinkShortcut = Extension.create<{ onOpen: () => void }>({
  name: "linkShortcut",
  addOptions() {
    return { onOpen: () => undefined };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        this.options.onOpen();
        return true;
      },
    };
  },
});

export type EditorVariant = "full" | "basic";

export function buildExtensions(opts: { variant: EditorVariant; placeholder: string; maxLength?: number; onOpenLink: () => void }): AnyExtension[] {
  const full = opts.variant === "full";
  const link = {
    openOnClick: false,
    autolink: true,
    linkOnPaste: true,
    defaultProtocol: "https",
    // No target/rel in the stored HTML: the sanitizer opens outside links in a new tab
    // and leaves Wildcat Clubs links (/clubs/…) in the same tab.
    HTMLAttributes: { rel: null, target: null },
  };
  const exts: AnyExtension[] = [
    StarterKit.configure(
      full
        ? { document: false, link, heading: { levels: [1, 2, 3] }, trailingNode: {} }
        : { link, heading: false, codeBlock: false, blockquote: false, horizontalRule: false, trailingNode: false },
    ),
    Highlight,
    Placeholder.configure({ placeholder: opts.placeholder }),
    LinkShortcut.configure({ onOpen: opts.onOpenLink }),
  ];
  if (opts.maxLength) exts.push(CharacterCount.configure({ limit: opts.maxLength }));
  if (full) {
    exts.push(
      RichDocument,
      EmbedNode,
      TaskList,
      TaskItem.configure({ nested: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ inline: false, allowBase64: false }),
      TableKit.configure({ table: { resizable: true, cellMinWidth: 60, allowTableNodeSelection: true } }),
    );
  }
  return exts;
}
