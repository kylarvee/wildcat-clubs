"use client";

/**
 * CONTRACT (owner: rich-text builder). The platform's one text editor.
 * Every rich-text input in the app uses this component — never a bare textarea
 * for formatted content. Value is HTML; the server sanitizes it with
 * sanitizeRichHtml() before storing.
 *
 * STUB: replaced by the TipTap implementation.
 */
export type RichTextEditorProps = {
  /** Hidden input name so the editor works inside a plain <form action>. */
  name?: string;
  defaultValue?: string | null;
  onChange?: (html: string) => void;
  placeholder?: string;
  /** Enables inserting this club's files (File picker) and event embeds. */
  clubId?: string | null;
  /** "basic" = text formatting only (answers, short notes); "full" = tables, embeds, video, documents. */
  variant?: "full" | "basic";
  minHeight?: number;
  disabled?: boolean;
  className?: string;
};

export function RichTextEditor({ name, defaultValue, onChange, placeholder, minHeight = 160, disabled, className }: RichTextEditorProps) {
  return (
    <textarea
      name={name}
      defaultValue={defaultValue ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
      style={{ minHeight }}
      className={"w-full rounded-lg border border-line-2 p-3 text-sm " + (className ?? "")}
    />
  );
}
