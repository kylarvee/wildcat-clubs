"use client";

import { useId, useRef, useState } from "react";
import { FileText, FolderOpen, Link2, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { toast } from "@/components/ui/misc";
import { FilePicker, type PickedFile } from "@/components/files/FilePicker";
import { isHttpUrl, linkLabel, type EventLink } from "@/lib/events/links";

/**
 * Event attachments: files from the club's Files (or uploaded right here) and
 * pasted links. Only files the viewer may see are shown on the event page.
 */
export function AttachmentsField({
  clubId,
  files,
  onFilesChange,
  links,
  onLinksChange,
}: {
  clubId: string | null;
  files: PickedFile[];
  onFilesChange: (files: PickedFile[]) => void;
  links: EventLink[];
  onLinksChange: (links: EventLink[]) => void;
}) {
  const id = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function addFiles(picked: PickedFile[]) {
    const have = new Set(files.map((f) => f.id));
    onFilesChange([...files, ...picked.filter((f) => !have.has(f.id))]);
  }

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    const added: PickedFile[] = [];
    for (const file of Array.from(list)) {
      const body = new FormData();
      body.set("file", file);
      body.set("scope", clubId ? "club" : "university");
      if (clubId) body.set("clubId", clubId);
      try {
        const res = await fetch("/api/files/upload", { method: "POST", body });
        const json = (await res.json()) as { ok: boolean; data?: PickedFile; error?: string };
        if (!json.ok || !json.data) throw new Error(json.error ?? "Upload failed.");
        added.push(json.data);
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : "Upload failed."}`);
      }
    }
    if (added.length) {
      addFiles(added);
      toast.success(added.length === 1 ? `Uploaded ${added[0].name}` : `Uploaded ${added.length} files`);
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function addLink() {
    const u = url.trim();
    const withScheme = /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`;
    if (!u || !isHttpUrl(withScheme)) {
      setLinkError("Enter a full web address, like https://docs.google.com/…");
      return;
    }
    if (links.length >= 20) {
      setLinkError("You can add up to 20 links.");
      return;
    }
    onLinksChange([...links, { url: withScheme, label: label.trim() }]);
    setUrl("");
    setLabel("");
    setLinkError(null);
  }

  const empty = files.length === 0 && links.length === 0;

  return (
    <div className="space-y-4">
      {empty ? <p className="text-sm text-ink-3">Add slides, flyers, sign-up forms or anything people should have before they come.</p> : null}
      {!empty ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:underline">
                {f.name}
              </a>
              <Button variant="ghost" size="icon" aria-label={`Remove ${f.name}`} onClick={() => onFilesChange(files.filter((x) => x.id !== f.id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {links.map((l, i) => (
            <li key={`${l.url}-${i}`} className="flex items-center gap-3 px-3 py-2">
              <Link2 className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              <div className="min-w-0 flex-1">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium text-ink hover:underline">
                  {linkLabel(l)}
                </a>
                {l.label ? <p className="truncate text-xs text-ink-3">{l.url}</p> : null}
              </div>
              <Button variant="ghost" size="icon" aria-label={`Remove link ${linkLabel(l)}`} onClick={() => onLinksChange(links.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          <FolderOpen className="h-4 w-4" /> {clubId ? "Choose from club files" : "Choose a file"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {uploading ? "Uploading…" : "Upload"}
        </Button>
        <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void upload(e.target.files)} />
      </div>

      <div className="rounded-xl border border-line bg-muted/40 p-3">
        <p className="mb-2 text-sm font-medium text-ink">Add a link</p>
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
          <Input
            id={`${id}-url`}
            aria-label="Link address"
            inputMode="url"
            placeholder="Paste a link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
            aria-invalid={Boolean(linkError)}
            aria-describedby={linkError ? `${id}-err` : undefined}
          />
          <Input
            aria-label="Link name (optional)"
            placeholder="Name (optional)"
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
          />
          <Button variant="secondary" onClick={addLink}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
        {linkError ? (
          <p id={`${id}-err`} className="mt-1.5 text-xs text-danger">
            {linkError}
          </p>
        ) : null}
      </div>

      <FilePicker clubId={clubId} open={pickerOpen} onOpenChange={setPickerOpen} onSelect={addFiles} multiple accept="any" title="Attach files to this event" />
    </div>
  );
}
