"use client";

import { forwardRef, useEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  CalendarDays,
  ChevronDown,
  CodeXml,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  MapPin,
  Minus,
  Pilcrow,
  Plus,
  PlayCircle,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Underline,
  Undo2,
} from "lucide-react";
import { cn } from "@/components/ui/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/misc";
import type { DialogKind } from "@/components/rich/editor/dialogs";
import type { EditorVariant } from "@/components/rich/editor/extensions";

const btn =
  "inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-ink-2 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-brand-50 aria-pressed:text-brand data-[state=open]:bg-muted";

type ToolButtonProps = ComponentProps<"button"> & { label: string; shortcut?: string; active?: boolean };

/** One toolbar button: icon, accessible name, tooltip with the keyboard shortcut. */
const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton({ label, shortcut, active, className, children, ...props }, ref) {
  return (
    <Tooltip content={shortcut ? `${label} (${shortcut})` : label}>
      <button
        ref={ref}
        type="button"
        data-toolbar-item=""
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        // Keep the editor's selection while clicking toolbar buttons.
        onMouseDown={(e) => e.preventDefault()}
        className={cn(btn, className)}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
});

const INSERT_ITEMS = [
  { kind: "image", label: "Image", Icon: ImagePlus },
  { kind: "video", label: "Video", Icon: PlayCircle },
  { kind: "document", label: "Document", Icon: FileText },
  { kind: "event", label: "Event", Icon: CalendarDays },
  { kind: "map", label: "Map", Icon: MapPin },
] satisfies { kind: DialogKind; label: string; Icon: typeof ImagePlus }[];

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />;
}

function useIsMac() {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  return mac;
}

/** Arrow keys move between toolbar buttons; Tab leaves the toolbar (one tab stop). */
function useRovingFocus() {
  const ref = useRef<HTMLDivElement>(null);
  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-toolbar-item]:not(:disabled)") ?? []);
  const setActive = (el: HTMLElement | undefined) => {
    for (const it of items()) it.tabIndex = it === el ? 0 : -1;
  };
  // After each render (buttons can become disabled), make sure exactly one enabled button is the tab stop.
  useEffect(() => {
    const list = items();
    if (!list.some((it) => it.getAttribute("tabindex") === "0")) setActive(list[0]);
  });
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length;
    setActive(list[next]);
    list[next].focus();
  }
  function onFocus(e: React.FocusEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (t.matches("[data-toolbar-item]")) setActive(t);
  }
  return { ref, onKeyDown, onFocus };
}

export function Toolbar({
  editor,
  variant,
  disabled,
  stickyTop,
  onOpen,
}: {
  editor: Editor;
  variant: EditorVariant;
  disabled?: boolean;
  stickyTop: number;
  onOpen: (kind: DialogKind) => void;
}) {
  const mac = useIsMac();
  const mod = mac ? "⌘" : "Ctrl+";
  const shift = mac ? "⇧" : "Shift+";
  const alt = mac ? "⌥" : "Alt+";
  const full = variant === "full";
  const roving = useRovingFocus();
  const pendingInsert = useRef<DialogKind | null>(null);

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: full && e.isActive("taskList"),
      quote: full && e.isActive("blockquote"),
      code: full && e.isActive("codeBlock"),
      h1: full && e.isActive("heading", { level: 1 }),
      h2: full && e.isActive("heading", { level: 2 }),
      h3: full && e.isActive("heading", { level: 3 }),
      alignCenter: full && e.isActive({ textAlign: "center" }),
      alignRight: full && e.isActive({ textAlign: "right" }),
      inTable: full && e.isActive("table"),
    }),
  });

  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => fn(editor.chain().focus()).run();
  const blockLabel = s.h1 ? "Heading 1" : s.h2 ? "Heading 2" : s.h3 ? "Heading 3" : "Paragraph";
  const off = Boolean(disabled);

  const blockTypes: { label: string; icon: ReactNode; active: boolean; shortcut: string; apply: () => void }[] = [
    { label: "Paragraph", icon: <Pilcrow className="h-4 w-4" />, active: !s.h1 && !s.h2 && !s.h3, shortcut: `${mod}${alt}0`, apply: run((c) => c.setParagraph()) },
    { label: "Heading 1", icon: <Heading1 className="h-4 w-4" />, active: s.h1, shortcut: `${mod}${alt}1`, apply: run((c) => c.toggleHeading({ level: 1 })) },
    { label: "Heading 2", icon: <Heading2 className="h-4 w-4" />, active: s.h2, shortcut: `${mod}${alt}2`, apply: run((c) => c.toggleHeading({ level: 2 })) },
    { label: "Heading 3", icon: <Heading3 className="h-4 w-4" />, active: s.h3, shortcut: `${mod}${alt}3`, apply: run((c) => c.toggleHeading({ level: 3 })) },
  ];

  return (
    <div
      ref={roving.ref}
      role="toolbar"
      aria-label="Formatting"
      aria-orientation="horizontal"
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
      // Phones: one row that scrolls sideways. Wider screens: wrap onto a second row instead of hiding buttons.
      className="wc-editor-toolbar sticky z-20 flex flex-nowrap items-center gap-0.5 overflow-x-auto rounded-t-[11px] border-b border-line bg-surface/95 px-1.5 py-1 backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:flex-wrap sm:overflow-x-visible"
      style={{ top: stickyTop }}
    >
      <ToolButton label="Undo" shortcut={`${mod}Z`} onClick={run((c) => c.undo())} disabled={off || !s.canUndo}>
        <Undo2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Redo" shortcut={`${mod}${shift}Z`} onClick={run((c) => c.redo())} disabled={off || !s.canRedo}>
        <Redo2 className="h-4 w-4" />
      </ToolButton>
      <Divider />

      {full ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={off}>
              <button type="button" data-toolbar-item="" className={cn(btn, "w-[7.5rem] justify-between px-2 text-sm font-medium")} aria-label={`Text style: ${blockLabel}`}>
                <span className="truncate">{blockLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
              {blockTypes.map((b) => (
                <DropdownMenuItem key={b.label} onSelect={b.apply} className={cn(b.active && "bg-brand-50 text-brand")}>
                  {b.icon}
                  {b.label}
                  <span className="ml-auto pl-4 text-xs text-ink-3">{b.shortcut}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Divider />
        </>
      ) : null}

      <ToolButton label="Bold" shortcut={`${mod}B`} active={s.bold} onClick={run((c) => c.toggleBold())} disabled={off}>
        <Bold className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Italic" shortcut={`${mod}I`} active={s.italic} onClick={run((c) => c.toggleItalic())} disabled={off}>
        <Italic className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Underline" shortcut={`${mod}U`} active={s.underline} onClick={run((c) => c.toggleUnderline())} disabled={off}>
        <Underline className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Strikethrough" shortcut={`${mod}${shift}S`} active={s.strike} onClick={run((c) => c.toggleStrike())} disabled={off}>
        <Strikethrough className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Highlight" shortcut={`${mod}${shift}H`} active={s.highlight} onClick={run((c) => c.toggleHighlight())} disabled={off}>
        <Highlighter className="h-4 w-4" />
      </ToolButton>
      <ToolButton label={s.link ? "Edit link" : "Link"} shortcut={`${mod}K`} active={s.link} onClick={() => onOpen("link")} disabled={off}>
        <LinkIcon className="h-4 w-4" />
      </ToolButton>
      <Divider />

      <ToolButton label="Bulleted list" shortcut={`${mod}${shift}8`} active={s.bullet} onClick={run((c) => c.toggleBulletList())} disabled={off}>
        <List className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Numbered list" shortcut={`${mod}${shift}7`} active={s.ordered} onClick={run((c) => c.toggleOrderedList())} disabled={off}>
        <ListOrdered className="h-4 w-4" />
      </ToolButton>

      {full ? (
        <>
          <ToolButton label="Checklist" shortcut={`${mod}${shift}9`} active={s.task} onClick={run((c) => c.toggleTaskList())} disabled={off}>
            <ListTodo className="h-4 w-4" />
          </ToolButton>
          <Divider />
          <ToolButton label="Quote" shortcut={`${mod}${shift}B`} active={s.quote} onClick={run((c) => c.toggleBlockquote())} disabled={off}>
            <Quote className="h-4 w-4" />
          </ToolButton>
          <ToolButton label="Code block" shortcut={`${mod}${alt}C`} active={s.code} onClick={run((c) => c.toggleCodeBlock())} disabled={off}>
            <CodeXml className="h-4 w-4" />
          </ToolButton>
          <Divider />
          <ToolButton label="Align left" shortcut={`${mod}${shift}L`} active={!s.alignCenter && !s.alignRight} onClick={run((c) => c.setTextAlign("left"))} disabled={off}>
            <TextAlignStart className="h-4 w-4" />
          </ToolButton>
          <ToolButton label="Align center" shortcut={`${mod}${shift}E`} active={s.alignCenter} onClick={run((c) => c.setTextAlign("center"))} disabled={off}>
            <TextAlignCenter className="h-4 w-4" />
          </ToolButton>
          <ToolButton label="Align right" shortcut={`${mod}${shift}R`} active={s.alignRight} onClick={run((c) => c.setTextAlign("right"))} disabled={off}>
            <TextAlignEnd className="h-4 w-4" />
          </ToolButton>
          <Divider />

          <DropdownMenu>
            <Tooltip content="Table">
              <DropdownMenuTrigger asChild disabled={off}>
                <button type="button" data-toolbar-item="" className={btn} aria-label="Table options" aria-pressed={s.inTable}>
                  <TableIcon className="h-4 w-4" aria-hidden />
                  <ChevronDown className="h-3 w-3 text-ink-3" aria-hidden />
                </button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
              {s.inTable ? (
                <>
                  <DropdownMenuLabel>Rows</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={run((c) => c.addRowBefore())}>Add row above</DropdownMenuItem>
                  <DropdownMenuItem onSelect={run((c) => c.addRowAfter())}>Add row below</DropdownMenuItem>
                  <DropdownMenuItem onSelect={run((c) => c.deleteRow())}>Delete row</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Columns</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={run((c) => c.addColumnBefore())}>Add column left</DropdownMenuItem>
                  <DropdownMenuItem onSelect={run((c) => c.addColumnAfter())}>Add column right</DropdownMenuItem>
                  <DropdownMenuItem onSelect={run((c) => c.deleteColumn())}>Delete column</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={run((c) => c.toggleHeaderRow())}>Toggle header row</DropdownMenuItem>
                  <DropdownMenuItem onSelect={run((c) => c.mergeOrSplit())} disabled={!editor.can().mergeOrSplit()}>
                    Merge or split cells
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem danger onSelect={run((c) => c.deleteTable())}>
                    Delete table
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem onSelect={run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}>Insert table (3 × 3)</DropdownMenuItem>
                  <DropdownMenuItem onSelect={run((c) => c.insertTable({ rows: 2, cols: 2, withHeaderRow: false }))}>Insert table (2 × 2, no header)</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolButton label="Divider line" onClick={run((c) => c.setHorizontalRule())} disabled={off}>
            <Minus className="h-4 w-4" />
          </ToolButton>
          <Divider />

          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={off}>
              <button type="button" data-toolbar-item="" className={cn(btn, "px-2 text-sm font-medium text-brand hover:text-brand")} aria-label="Insert image, video, document, event or map">
                <Plus className="h-4 w-4" aria-hidden />
                Insert
                <ChevronDown className="h-3.5 w-3.5 text-ink-3" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            {/* Open the dialog only once the menu has fully closed, so the menu's focus handling can't pull focus out of it. */}
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => {
                const kind = pendingInsert.current;
                pendingInsert.current = null;
                if (!kind) return; // closed with Escape: focus goes back to the button as usual
                e.preventDefault();
                onOpen(kind);
              }}
            >
              {INSERT_ITEMS.map(({ kind, label, Icon }) => (
                <DropdownMenuItem key={kind} onSelect={() => (pendingInsert.current = kind)}>
                  <Icon className="h-4 w-4 text-ink-3" aria-hidden /> {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </div>
  );
}
