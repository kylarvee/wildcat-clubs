"use client";

import { useId, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { ClubLogo } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { LOGO_PALETTE } from "@/components/founding/copy";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

/**
 * Logo upload (stored as a public club file via /api/files/upload with the
 * profile capability) plus the club color used behind the monogram.
 */
export function LogoField({
  clubId,
  clubName,
  logoUrl,
  logoColor,
  onLogoChange,
  onColorChange,
}: {
  clubId: string;
  clubName: string;
  logoUrl: string | null;
  logoColor: string;
  onLogoChange: (url: string | null) => void;
  onColorChange: (color: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const palette = LOGO_PALETTE.some((p) => p.value.toLowerCase() === logoColor.toLowerCase()) ? LOGO_PALETTE : [{ value: logoColor, name: "Current color" }, ...LOGO_PALETTE];

  async function upload(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Choose an image file (PNG, JPG, WebP, GIF or SVG).");
    if (file.size > MAX_LOGO_BYTES) return setError("Logos can be up to 5 MB.");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("scope", "club");
      fd.set("clubId", clubId);
      fd.set("purpose", "logo");
      fd.set("visibility", "PUBLIC");
      const res = await fetch("/api/files/upload", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; data?: { id: string } } | null;
      if (!json?.ok || !json.data) throw new Error(json?.error ?? "The upload didn't go through. Try again.");
      onLogoChange(`/api/files/${json.data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload didn't go through. Try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <ClubLogo name={clubName || "Club"} src={logoUrl} color={logoColor} size="xl" />
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" id={`${hintId}-file`} aria-describedby={hintId} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
              {uploading ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            {logoUrl ? (
              <Button variant="ghost" size="sm" onClick={() => onLogoChange(null)} disabled={uploading}>
                <Trash2 className="h-4 w-4" aria-hidden /> Remove
              </Button>
            ) : null}
          </div>
          <p id={hintId} className="text-xs text-ink-3">
            Square images work best (at least 256×256). PNG, JPG, WebP, GIF or SVG, up to 5 MB. Without a logo, your initials show on your color.
          </p>
          {error ? (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Club color</legend>
        <div className="flex flex-wrap gap-2">
          {palette.map((p) => {
            const on = p.value.toLowerCase() === logoColor.toLowerCase();
            return (
              <label
                key={p.value}
                title={p.name}
                className={cn(
                  "flex h-9 w-9 cursor-pointer items-center justify-center rounded-full ring-offset-2 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
                  on ? "ring-2 ring-ink" : "hover:scale-105",
                )}
                style={{ backgroundColor: p.value }}
              >
                <input type="radio" name="logoColor" value={p.value} checked={on} onChange={() => onColorChange(p.value)} className="sr-only" aria-label={p.name} />
                {on ? <Check className="h-4 w-4 text-white" aria-hidden /> : null}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
