"use client";

/**
 * CONTRACT (owner: files builder). Pop-up for choosing files from a club's
 * files (or the viewer's own / university files when clubId is null). Used by
 * the text editor, events (attachments), announcements, projects, policies.
 * Lists only what the viewer may see; can upload into the club's files too.
 * STUB.
 */
export type PickedFile = { id: string; name: string; mimeType: string | null; url: string };

export type FilePickerProps = {
  clubId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (files: PickedFile[]) => void;
  multiple?: boolean;
  accept?: "any" | "image" | "document" | "video";
  title?: string;
};

export function FilePicker(_props: FilePickerProps) {
  return null;
}
