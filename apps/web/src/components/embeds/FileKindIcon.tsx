import { File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, ListChecks, Presentation } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { FileKind, GoogleDocKind } from "@/lib/rich/embeds";

const ICONS = {
  pdf: FileText,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  archive: FileArchive,
  text: FileText,
  other: File,
} satisfies Record<FileKind, unknown>;

/** Tile colors by kind, so a PDF, a spreadsheet and a deck are easy to tell apart at a glance. */
export const FILE_KIND_TONE: Record<FileKind, string> = {
  pdf: "bg-red-50 text-red-700",
  image: "bg-sky-50 text-sky-700",
  video: "bg-violet-50 text-violet-700",
  audio: "bg-violet-50 text-violet-700",
  doc: "bg-blue-50 text-blue-700",
  sheet: "bg-green-50 text-green-700",
  slides: "bg-amber-50 text-amber-700",
  archive: "bg-muted text-ink-2",
  text: "bg-muted text-ink-2",
  other: "bg-muted text-ink-2",
};

export const GOOGLE_KIND_TO_FILE_KIND: Record<GoogleDocKind, FileKind> = {
  doc: "doc",
  sheet: "sheet",
  slides: "slides",
  form: "other",
  file: "other",
  folder: "other",
};

export function FileKindIcon({ kind, google, className }: { kind: FileKind; google?: GoogleDocKind; className?: string }) {
  const Icon = google === "form" ? ListChecks : google === "folder" ? Folder : ICONS[kind];
  return <Icon className={cn("h-5 w-5", className)} aria-hidden />;
}
