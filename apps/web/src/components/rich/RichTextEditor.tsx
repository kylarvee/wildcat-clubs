"use client";

import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { toast } from "@/components/ui/misc";
import { RichStyles } from "@/components/rich/RichStyles";
import { EditorDialogs, type DialogKind } from "@/components/rich/editor/dialogs";
import { buildExtensions } from "@/components/rich/editor/extensions";
import { Toolbar } from "@/components/rich/editor/Toolbar";
import { uploadForEditor, type UploadScope } from "@/components/rich/editor/upload";
import { videoInfo } from "@/lib/rich/embeds";

/**
 * CONTRACT (owner: rich-text builder). The platform's one text editor.
 * Every rich-text input in the app uses this component — never a bare textarea
 * for formatted content. Value is HTML; the server sanitizes it with
 * sanitizeRichHtml() before storing, and <RichContent> shows it.
 *
 * Use it in a plain <form action> with `name` (a hidden input carries the
 * HTML; it resets with the form), or controlled with `value` + `onChange`.
 * "full" adds headings, checklists, quotes, code, alignment, tables and the
 * Insert menu (image, video, document, event, map); "basic" is text
 * formatting, lists and links (answers, short notes).
 */
export type RichTextEditorProps = {
  /** Hidden input name so the editor works inside a plain <form action>. */
  name?: string;
  defaultValue?: string | null;
  /** Controlled value. When it changes from outside, the editor shows it (pair with onChange). */
  value?: string | null;
  onChange?: (html: string) => void;
  placeholder?: string;
  /** Enables inserting this club's files (File picker) and event embeds. */
  clubId?: string | null;
  /** "basic" = text formatting only (answers, short notes); "full" = tables, embeds, video, documents. */
  variant?: "full" | "basic";
  minHeight?: number;
  disabled?: boolean;
  className?: string;
  /** Put on the editable area (e.g. the id from <Field>). */
  id?: string;
  /** Accessible name for the editable area (defaults to the placeholder). */
  ariaLabel?: string;
  /** Shows a character counter and stops typing at this many characters. */
  maxLength?: number;
  /** Where uploads go. Defaults to the club's files when clubId is set, else the writer's own files. */
  fileScope?: UploadScope;
  /** Distance from the top of the window where the toolbar sticks while scrolling (the site header is 64px). Use 0 inside dialogs. */
  stickyToolbarTop?: number;
  autoFocus?: boolean;
};

/** Camera-style file names make poor alt text; anything else is a reasonable start. */
function altFromName(name: string) {
  const base = name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return /^(img|image|dsc|pxl|photo|screenshot|screen shot)\b[\s\d]*/i.test(base) || /^\d[\d\s]*$/.test(base) ? "" : base.slice(0, 120);
}

export function RichTextEditor({
  name,
  defaultValue,
  value,
  onChange,
  placeholder,
  clubId = null,
  variant = "full",
  minHeight = 160,
  disabled,
  className,
  id,
  ariaLabel,
  maxLength,
  fileScope,
  stickyToolbarTop = 64,
  autoFocus,
}: RichTextEditorProps) {
  const uploadScope: UploadScope = fileScope ?? (clubId ? "club" : "user");
  const placeholderText = placeholder ?? (variant === "basic" ? "Write your answer…" : "Write something…");
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const lastHtml = useRef<string>(value ?? defaultValue ?? "");
  const refocusAfterDialog = useRef(false);
  // Latest props for callbacks the editor captured at creation.
  const latest = useRef({ onChange, defaultValue, clubId, uploadScope, variant });
  useEffect(() => {
    latest.current = { onChange, defaultValue, clubId, uploadScope, variant };
  });

  /** Uploads pasted or dropped files: images go in as images, anything else as a file embed. */
  async function insertFiles(files: File[], pos?: number) {
    const { clubId: club, uploadScope: scope, variant: v } = latest.current;
    const accepted = v === "full" ? files : [];
    if (!accepted.length) return;
    setUploading((n) => n + accepted.length);
    let notedFallback = false;
    for (const file of accepted) {
      try {
        const { file: saved, savedTo } = await uploadForEditor(file, { scope, clubId: club });
        if (savedTo !== scope && !notedFallback) {
          notedFallback = true;
          toast.info("Saved to your own files, since you can't add club files here.");
        }
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed) return;
        const at = pos != null ? Math.min(pos, ed.state.doc.content.size) : null;
        if (file.type.startsWith("image/")) {
          const image = { type: "image", attrs: { src: saved.url, alt: altFromName(file.name) } };
          if (at != null) ed.chain().insertContentAt(at, image).run();
          else ed.chain().focus().insertContent(image).run();
        } else {
          const chain = at != null ? ed.chain().setTextSelection(at) : ed.chain().focus();
          chain.insertEmbed({ embed: "file", id: saved.id, title: saved.name, mime: saved.mimeType }).run();
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `${file.name} didn't upload. Please try again.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  // The editor is built once per variant; placeholder and maxLength are read when it's created.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const extensions = useMemo(() => buildExtensions({ variant, placeholder: placeholderText, maxLength, onOpenLink: () => setDialog("link") }), [variant]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editable: !disabled,
      autofocus: autoFocus ? "end" : false,
      extensions,
      // Switching variant rebuilds the editor; carry over what's been written.
      content: lastHtml.current,
      editorProps: {
        attributes: {
          class: "prose-wc px-4 py-3 text-[15px]",
          style: `min-height: ${minHeight}px`,
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": ariaLabel ?? placeholderText,
          ...(id ? { id } : {}),
        },
        handlePaste: (view, event) => {
          if (latest.current.variant !== "full" || !view.editable) return false;
          const files = Array.from(event.clipboardData?.files ?? []);
          // Word and Excel put a picture of the copied text on the clipboard too; prefer the text.
          const hasText = Boolean(event.clipboardData?.getData("text/html") || event.clipboardData?.getData("text/plain"));
          if (files.length && !hasText) {
            void insertFiles(files);
            return true;
          }
          // A lone YouTube/Drive link pasted on an empty line becomes a video.
          const text = event.clipboardData?.getData("text/plain")?.trim();
          const { $from, empty } = view.state.selection;
          if (text && !/\s/.test(text) && videoInfo(text) && empty && $from.depth === 1 && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0) {
            editorRef.current?.commands.insertEmbed({ embed: "video", src: text });
            return true;
          }
          return false;
        },
        handleDrop: (view, event, _slice, moved) => {
          setDragging(false);
          if (moved || latest.current.variant !== "full" || !view.editable) return false;
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (!files.length) return false;
          event.preventDefault();
          void insertFiles(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
          return true;
        },
      },
      onUpdate: ({ editor: ed }) => {
        const html = ed.isEmpty ? "" : ed.getHTML();
        lastHtml.current = html;
        if (hiddenRef.current) hiddenRef.current.value = html;
        latest.current.onChange?.(html);
      },
    },
    [variant],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  // Controlled mode: show a value that changed from outside (not one we just emitted).
  useEffect(() => {
    if (!editor || value === undefined || (value ?? "") === lastHtml.current) return;
    const next = value ?? "";
    editor.commands.setContent(next, { emitUpdate: false });
    lastHtml.current = next;
    if (hiddenRef.current) hiddenRef.current.value = next;
  }, [editor, value]);

  // Reset with the form (including React's automatic reset after a successful form action).
  useEffect(() => {
    const form = wrapperRef.current?.closest("form");
    if (!form || !editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // "reset" fires before the browser resets the controls — including the editor's own
    // checklist checkboxes — so reload the content just after it.
    const onReset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (editor.isDestroyed) return;
        const def = latest.current.defaultValue ?? "";
        editor.commands.setContent(def, { emitUpdate: false });
        // Unchanged checklist items keep their node views, so put their boxes back by hand.
        editor.view.dom.querySelectorAll<HTMLInputElement>("li[data-checked] > label > input[type=checkbox]").forEach((box) => {
          box.checked = box.closest("li")?.dataset.checked === "true";
        });
        lastHtml.current = def;
        // Hidden inputs don't reset on their own: their value *is* their default.
        if (hiddenRef.current) hiddenRef.current.value = def;
        latest.current.onChange?.(def);
      }, 0);
    };
    form.addEventListener("reset", onReset);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("reset", onReset);
    };
  }, [editor]);

  // Put the cursor back in the editor once a dialog has closed (after Radix returns focus to the toolbar).
  useEffect(() => {
    if (dialog !== null || !refocusAfterDialog.current || !editor) return;
    refocusAfterDialog.current = false;
    const t = setTimeout(() => editor.commands.focus(), 0);
    return () => clearTimeout(t);
  }, [dialog, editor]);

  function onDragOver(e: DragEvent) {
    if (variant === "full" && !disabled && e.dataTransfer.types.includes("Files")) setDragging(true);
  }

  return (
    <div
      ref={wrapperRef}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      className={cn(
        "wc-editor relative rounded-xl border border-line-2 bg-surface shadow-sm transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-100",
        disabled && "bg-muted",
        dragging && "border-brand ring-2 ring-brand-100",
        className,
      )}
      aria-disabled={disabled || undefined}
    >
      <RichStyles />
      {editor ? (
        <Toolbar editor={editor} variant={variant} disabled={disabled} stickyTop={stickyToolbarTop} onOpen={setDialog} />
      ) : (
        <div className="h-10 rounded-t-[11px] border-b border-line bg-surface" aria-hidden />
      )}
      {editor ? (
        <EditorContent editor={editor} className={cn(disabled && "cursor-not-allowed opacity-70")} />
      ) : (
        <div className="px-4 py-3 text-[15px] text-ink-3" style={{ minHeight }} aria-hidden>
          {placeholderText}
        </div>
      )}
      {dragging ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-10 flex items-center justify-center rounded-b-xl bg-brand-50/70 text-sm font-medium text-brand">
          Drop to upload
        </div>
      ) : null}
      {uploading > 0 || maxLength ? (
        <div className="flex items-center justify-end gap-3 border-t border-line px-3 py-1.5 text-xs text-ink-3">
          {uploading > 0 ? (
            <span className="mr-auto inline-flex items-center gap-1.5" role="status">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Uploading {uploading === 1 ? "1 file" : `${uploading} files`}…
            </span>
          ) : null}
          {maxLength && editor ? <CharacterCounter editor={editor} max={maxLength} /> : null}
        </div>
      ) : null}
      {name ? <HiddenField name={name} initial={value ?? defaultValue ?? ""} inputRef={hiddenRef} /> : null}
      {editor ? (
        <EditorDialogs
          kind={dialog}
          editor={editor}
          clubId={clubId}
          uploadScope={uploadScope}
          onClose={(refocus) => {
            refocusAfterDialog.current = refocus;
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The hidden input that carries the HTML in a plain <form>. Rendered once and
 * then updated directly: React re-applies `defaultValue` on every render, and
 * for a hidden input that would overwrite what the person typed.
 */
const HiddenField = memo(
  function HiddenField({ name, initial, inputRef }: { name: string; initial: string; inputRef: RefObject<HTMLInputElement | null> }) {
    return <input ref={inputRef} type="hidden" name={name} defaultValue={initial} />;
  },
  (prev, next) => prev.name === next.name,
);

function CharacterCounter({ editor, max }: { editor: Editor; max: number }) {
  const count = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.storage as { characterCount?: { characters: () => number } }).characterCount?.characters() ?? 0,
  });
  return (
    <span className={cn("tabular-nums", count >= max && "font-medium text-warning")} aria-live="polite">
      {count.toLocaleString()} / {max.toLocaleString()}
    </span>
  );
}
