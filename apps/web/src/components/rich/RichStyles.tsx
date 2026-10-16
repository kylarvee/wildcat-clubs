/**
 * Styles the rich-text editor and <RichContent> need beyond the .prose-wc base
 * in globals.css: task-list layout, table scrolling on phones, and the
 * editor's placeholder, selection and table-resize affordances.
 * React hoists this <style> into <head> once, however many editors or
 * documents are on the page. Colors fall back to the brand hex values.
 */
const CSS = `
.prose-wc li > p { margin: 0; }
.prose-wc li + li { margin-top: 0.25em; }
.prose-wc > :first-child { margin-top: 0; }
.prose-wc img { height: auto; }
.prose-wc ul[data-type="taskList"] li > label { flex: none; display: inline-flex; align-items: center; height: 1.65em; user-select: none; }
.prose-wc ul[data-type="taskList"] li > label input { width: 1rem; height: 1rem; margin: 0; accent-color: var(--color-brand, #492365); }
.prose-wc ul[data-type="taskList"] li > div { flex: 1 1 auto; min-width: 0; }
.prose-wc ul[data-type="taskList"] li[data-checked="true"] > div { color: var(--color-ink-3, #77707f); text-decoration: line-through; }
.prose-wc .wc-table-scroll, .prose-wc .tableWrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.prose-wc th > p, .prose-wc td > p { margin: 0; }
.prose-wc th > * + *, .prose-wc td > * + * { margin-top: 0.5em; }

.wc-editor .ProseMirror { outline: none; word-break: break-word; }
.wc-editor .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder); float: left; height: 0; pointer-events: none; color: var(--color-ink-3, #77707f);
}
.wc-editor .ProseMirror img.ProseMirror-selectednode { outline: 2px solid var(--color-brand, #492365); outline-offset: 2px; }
.wc-editor .ProseMirror hr.ProseMirror-selectednode { border-top-color: var(--color-brand, #492365); }
.wc-editor .ProseMirror ul[data-type="taskList"] li > label input { cursor: pointer; }
.wc-editor .ProseMirror table { table-layout: fixed; }
.wc-editor .ProseMirror th, .wc-editor .ProseMirror td { position: relative; min-width: 3em; }
.wc-editor .ProseMirror .selectedCell::after {
  content: ""; position: absolute; inset: 0; z-index: 2; pointer-events: none; background: rgb(73 35 101 / 0.1);
}
.wc-editor .ProseMirror .column-resize-handle {
  position: absolute; top: 0; right: -2px; bottom: -2px; z-index: 3; width: 4px; pointer-events: none;
  background: var(--color-brand-200, #d6c3e8);
}
.wc-editor .ProseMirror.resize-cursor { cursor: col-resize; }
.wc-editor .ProseMirror-gapcursor::after { border-top-color: var(--color-brand, #492365); }
.wc-editor-toolbar { scrollbar-width: none; }
.wc-editor-toolbar::-webkit-scrollbar { display: none; }
`;

export function RichStyles() {
  return (
    <style href="wc-rich-text" precedence="medium">
      {CSS}
    </style>
  );
}
