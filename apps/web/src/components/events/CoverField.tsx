"use client";

import { useId, useRef, useState } from "react";
import { FolderOpen, ImageOff, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilePicker } from "@/components/files/FilePicker";
import { EventCover } from "@/components/events/EventCover";
import { COVER_ACCEPT, MAX_COVER_BYTES } from "@/lib/events/rules";

/**
 * The event's cover image: one of the host club's image files (University
 * files for a university event), picked or uploaded here. Uploads work like
 * the club logo's: a public file in the club's files (its Flyers folder when
 * it has one), made with the Events Builder permission (`purpose=cover`).
 * The write path checks the choice (lib/events/rules coverProblem).
 */
export function CoverField({
  clubId,
  hostName,
  folderId,
  value,
  onChange,
}: {
  /** Null for a university event. */
  clubId: string | null;
  hostName: string;
  /** Where uploads go (null: the top of the files). */
  folderId: string | null;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = clubId ? "Club files" : "University files";

  async function upload(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Choose an image file (PNG, JPG, WebP, GIF or SVG).");
    if (file.size > MAX_COVER_BYTES) return setError("Cover images can be up to 5 MB.");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("scope", clubId ? "club" : "university");
      if (clubId) fd.set("clubId", clubId);
      if (folderId) fd.set("parentId", folderId);
      fd.set("purpose", "cover");
      fd.set("visibility", "PUBLIC");
      const res = await fetch("/api/files/upload", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; data?: { id: string } } | null;
      if (!json?.ok || !json.data) throw new Error(json?.error ?? "The upload didn't go through. Try again.");
      onChange(`/api/files/${json.data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload didn't go through. Try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      {value ? (
        <EventCover src={value} color="#492365" name={hostName} eager className="aspect-video w-full max-w-md rounded-xl border border-line" />
      ) : (
        <div className="flex aspect-video w-full max-w-md flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-2 bg-muted/50 px-4 text-center text-sm text-ink-3">
          <ImageOff className="h-5 w-5" aria-hidden="true" />
          No cover yet. Cards show {clubId ? "your club's color and logo" : "Weber State purple"} instead.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} disabled={uploading}>
          <FolderOpen className="h-4 w-4" aria-hidden="true" /> Choose from {area.toLowerCase()}
        </Button>
        <input ref={inputRef} type="file" accept={COVER_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading} aria-describedby={hintId}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
          {uploading ? "Uploading…" : "Upload an image"}
        </Button>
        {value ? (
          <Button variant="ghost" size="sm" onClick={() => onChange(null)} disabled={uploading}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove cover
          </Button>
        ) : null}
      </div>
      <p id={hintId} className="text-xs text-ink-3">
        A flyer or a photo works. Pick a public image from {area}, or upload one: PNG, JPG, WebP, GIF or SVG, up to 5 MB. Uploads are saved to {area}{clubId && folderId ? " → Flyers" : ""} as public files.
      </p>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <FilePicker
        clubId={clubId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        accept="image"
        title="Choose a cover image"
        onSelect={(files) => {
          const f = files[0];
          if (!f) return;
          setError(null);
          onChange(f.url);
        }}
      />
    </div>
  );
}
