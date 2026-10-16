"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { CalendarDays, FileUp, ImagePlus, LoaderCircle, MapPin, PlayCircle, Search, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { Switch, toast } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilePicker, type PickedFile } from "@/components/files/FilePicker";
import { MapEmbed } from "@/components/embeds/MapEmbed";
import { uploadForEditor, type UploadScope } from "@/components/rich/editor/upload";
import { INSTITUTION } from "@/lib/institution";
import { MAX_UPLOAD_MB, formatBytes, googleDocInfo, safeHttpUrl, toHttpUrl, videoInfo } from "@/lib/rich/embeds";

export type DialogKind = "link" | "image" | "video" | "document" | "event" | "map";

type Ctx = {
  editor: Editor;
  clubId: string | null;
  uploadScope: UploadScope;
  /** Closes the dialog; `refocus` puts the cursor back in the editor afterwards. */
  close: (refocus?: boolean) => void;
};

/** All of the editor's pop-up forms. Only the open one is mounted, so each opens fresh. */
export function EditorDialogs({ kind, onClose, ...rest }: Omit<Ctx, "close"> & { kind: DialogKind | null; onClose: (refocus: boolean) => void }) {
  const ctx: Ctx = { ...rest, close: (refocus = true) => onClose(refocus) };
  const titles: Record<DialogKind, { title: string; description: string; wide?: boolean }> = {
    link: { title: "Link", description: "Link to a web page, an email address or a page on Wildcat Clubs." },
    image: { title: "Add an image", description: "Upload a photo or graphic, or use one from the web." },
    video: { title: "Embed a video", description: "Paste a YouTube or Google Drive link. It plays right in the page." },
    document: { title: "Attach a document", description: "Show a file or Google doc right in the page.", wide: true },
    event: { title: "Feature an event", description: "Readers see the next date, the place and who's hosting.", wide: true },
    map: { title: "Add a map", description: "Pin a campus building or any address.", wide: true },
  };
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => (open ? undefined : onClose(true))}>
      {kind ? (
        <DialogContent title={titles[kind].title} description={titles[kind].description} wide={titles[kind].wide}>
          {kind === "link" ? <LinkForm {...ctx} /> : null}
          {kind === "image" ? <ImageForm {...ctx} /> : null}
          {kind === "video" ? <VideoForm {...ctx} /> : null}
          {kind === "document" ? <DocumentForm {...ctx} /> : null}
          {kind === "event" ? <EventForm {...ctx} /> : null}
          {kind === "map" ? <MapForm {...ctx} /> : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function Pending({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <>
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </>
  );
}

function Footer({ onCancel, submitLabel, pending, disabled, extra }: { onCancel: () => void; submitLabel: string; pending?: boolean; disabled?: boolean; extra?: ReactNode }) {
  return (
    <DialogFooter className={extra ? "justify-between" : undefined}>
      {extra ? <div className="mr-auto">{extra}</div> : null}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={disabled || pending}>
          <Pending pending={Boolean(pending)}>{submitLabel}</Pending>
        </Button>
      </div>
    </DialogFooter>
  );
}

/**
 * These forms render in a portal, but React still bubbles their submit event to
 * the editor's own <form> (if any). Stop it, so inserting a link never submits the page's form.
 */
function stop(e: FormEvent) {
  e.preventDefault();
  e.stopPropagation();
}

function scopeNote(scope: UploadScope, savedTo: UploadScope) {
  if (savedTo !== scope && savedTo === "user") toast.info("Saved to your own files, since you can't add club files here.");
}

// ─── Link ────────────────────────────────────────────────────────────────────

/** Turns what someone typed into a safe href: web address, email, phone or a site path. */
export function normalizeHref(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v) || /^tel:\+?[\d\s().-]{3,}$/i.test(v)) return v;
  if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(v)) return `mailto:${v}`;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  return safeHttpUrl(v);
}

function LinkForm({ editor, close }: Ctx) {
  const existing = (editor.getAttributes("link").href as string | undefined) ?? "";
  const { from, to, empty } = editor.state.selection;
  const needsText = empty && !existing;
  const [href, setHref] = useState(existing);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    stop(e);
    const url = normalizeHref(href);
    if (!url) {
      setError("Enter a full web address like weber.edu/clubs, an email address, or a page path like /clubs.");
      return;
    }
    const chain = editor.chain().focus();
    if (existing) chain.extendMarkRange("link").setLink({ href: url }).run();
    // Links are "inclusive" (autolink), so drop the stored mark: what you type next isn't part of the link.
    else if (needsText) chain.insertContent({ type: "text", text: text.trim() || href.trim(), marks: [{ type: "link", attrs: { href: url } }] }).unsetMark("link").run();
    else chain.setTextSelection({ from, to }).setLink({ href: url }).run();
    close();
  }

  function remove() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    close();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Link to" error={error} hint={error ? undefined : "Web address, email, or a Wildcat Clubs page like /clubs/chess-club"}>
        {(id) => (
          <Input
            id={id}
            value={href}
            onChange={(e) => {
              setHref(e.target.value);
              setError(null);
            }}
            placeholder="https://"
            autoFocus
            inputMode="url"
            autoComplete="off"
            aria-invalid={Boolean(error)}
          />
        )}
      </Field>
      {needsText ? (
        <Field label="Text to show" hint="Leave blank to show the address.">
          {(id) => <Input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Sign-up form" />}
        </Field>
      ) : null}
      <Footer
        onCancel={() => close()}
        submitLabel={existing ? "Update link" : "Add link"}
        disabled={!href.trim()}
        extra={
          existing ? (
            <Button variant="ghost" className="text-danger hover:bg-danger-50 hover:text-danger" onClick={remove}>
              Remove link
            </Button>
          ) : null
        }
      />
    </form>
  );
}

// ─── Shared file chooser ─────────────────────────────────────────────────────

function FileDrop({ accept, file, onFile, hint, icon }: { accept?: string; file: File | null; onFile: (f: File | null) => void; hint: string; icon: ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    // stopPropagation: React bubbles drag events through the portal to the editor's own drop zone.
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
        over ? "border-brand bg-brand-50" : "border-line-2 bg-canvas",
      )}
    >
      <span className="text-ink-3 [&>svg]:h-7 [&>svg]:w-7">{icon}</span>
      {file ? (
        <p className="max-w-full truncate text-sm font-medium text-ink">
          {file.name} <span className="font-normal text-ink-3">· {formatBytes(file.size)}</span>
        </p>
      ) : (
        <p className="text-sm text-ink-2">Drag a file here, or</p>
      )}
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        <Upload className="h-4 w-4" aria-hidden /> {file ? "Choose a different file" : "Choose a file"}
      </Button>
      <p className="text-xs text-ink-3">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ─── Image ───────────────────────────────────────────────────────────────────

function ImageForm({ editor, clubId, uploadScope, close }: Ctx) {
  const [tab, setTab] = useState<"upload" | "url">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlBroken, setUrlBroken] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  const remote = safeHttpUrl(url);

  async function submit(e: FormEvent) {
    stop(e);
    setError(null);
    if (tab === "url") {
      if (!remote) return setError("Enter a full image address that starts with https://");
      editor.chain().focus().setImage({ src: remote, alt: alt.trim() }).run();
      return close();
    }
    if (!file) return setError("Choose an image to upload.");
    if (!file.type.startsWith("image/")) return setError("That file isn't an image. Use Attach a document for other files.");
    setPending(true);
    try {
      const { file: saved, savedTo } = await uploadForEditor(file, { scope: uploadScope, clubId });
      scopeNote(uploadScope, savedTo);
      editor.chain().focus().setImage({ src: saved.url, alt: alt.trim() }).run();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That upload didn't go through. Please try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "upload" | "url")}>
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="url">From a link</TabsTrigger>
        </TabsList>
        <TabsContent value="upload" className="pt-4">
          {preview ? (
            <div className="mb-3 flex justify-center rounded-xl bg-muted p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="" className="max-h-48 rounded-lg object-contain" />
            </div>
          ) : null}
          <FileDrop accept="image/*" file={file} onFile={setFile} icon={<ImagePlus />} hint={`PNG, JPG, GIF or WebP, up to ${MAX_UPLOAD_MB} MB.`} />
        </TabsContent>
        <TabsContent value="url" className="space-y-3 pt-4">
          <Field label="Image address">
            {(id) => (
              <Input
                id={id}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setUrlBroken(false);
                }}
                placeholder="https://…/photo.jpg"
                inputMode="url"
                autoComplete="off"
              />
            )}
          </Field>
          {remote && !urlBroken ? (
            <div className="flex justify-center rounded-xl bg-muted p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={remote} alt="" className="max-h-48 rounded-lg object-contain" onError={() => setUrlBroken(true)} referrerPolicy="no-referrer" />
            </div>
          ) : null}
          {urlBroken ? <p className="text-xs text-warning">We couldn&apos;t load an image from that address. Check that it links straight to the image.</p> : null}
        </TabsContent>
      </Tabs>
      <Field label="Describe the image" hint="Helps people using screen readers. Leave blank if it's only decoration.">
        {(id) => <Input id={id} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="e.g. Members at the fall service project" maxLength={250} />}
      </Field>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Footer onCancel={() => close()} submitLabel={pending ? "Uploading…" : "Insert image"} pending={pending} disabled={tab === "upload" ? !file : !remote} />
    </form>
  );
}

// ─── Video ───────────────────────────────────────────────────────────────────

function VideoForm({ editor, close }: Ctx) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const info = videoInfo(url);
  const showError = touched && url.trim() !== "" && !info;

  function submit(e: FormEvent) {
    stop(e);
    setTouched(true);
    if (!info) return;
    editor.commands.insertEmbed({ embed: "video", src: toHttpUrl(url)!.toString(), title: title.trim() || null });
    close();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Video link" error={showError ? "Paste a YouTube link (youtube.com or youtu.be) or a Google Drive video link." : undefined}>
        {(id) => (
          <Input
            id={id}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="https://www.youtube.com/watch?v=…"
            autoFocus
            inputMode="url"
            autoComplete="off"
            aria-invalid={showError}
          />
        )}
      </Field>
      {info?.thumbnailUrl ? (
        <div className="relative overflow-hidden rounded-xl bg-ink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={info.thumbnailUrl} alt="" className="aspect-video w-full object-cover opacity-90" />
          <PlayCircle className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow" aria-hidden />
        </div>
      ) : null}
      {info?.provider === "drive" ? (
        <Callout tone="info" title="Google Drive video found">
          Make sure the file is shared with &ldquo;Anyone with the link&rdquo; (or anyone at {INSTITUTION.shortName}), or readers will see a sign-in screen instead of the video.
        </Callout>
      ) : null}
      <Field label="Title (optional)" hint="Shown under the video.">
        {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={info ? `${info.providerLabel} video` : "e.g. Fall kickoff recap"} maxLength={200} />}
      </Field>
      <Footer onCancel={() => close()} submitLabel="Embed video" disabled={!info} />
    </form>
  );
}

// ─── Document ────────────────────────────────────────────────────────────────

function DocumentForm({ editor, clubId, uploadScope, close }: Ctx) {
  const [tab, setTab] = useState<"files" | "upload" | "link">("files");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [everyone, setEveryone] = useState(true);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const google = googleDocInfo(url);
  const link = safeHttpUrl(url);
  const clubScope = uploadScope === "club" && clubId;

  function insertFiles(files: PickedFile[]) {
    if (!files.length) return;
    let chain = editor.chain().focus();
    for (const f of files) chain = chain.insertEmbed({ embed: "file", id: f.id, title: f.name, mime: f.mimeType });
    chain.run();
    close();
  }

  async function submit(e: FormEvent) {
    stop(e);
    setError(null);
    if (tab === "files") return setPickerOpen(true);
    if (tab === "link") {
      if (!link) return setError("Enter a full link that starts with https://");
      editor.commands.insertEmbed({ embed: "document", src: link, title: title.trim() || google?.label || null });
      return close();
    }
    if (!file) return setError("Choose a file to upload.");
    setPending(true);
    try {
      const { file: saved, savedTo } = await uploadForEditor(file, { scope: uploadScope, clubId, visibility: everyone ? "PUBLIC" : "INHERIT" });
      scopeNote(uploadScope, savedTo);
      editor.commands.insertEmbed({ embed: "file", id: saved.id, title: saved.name, mime: saved.mimeType });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That upload didn't go through. Please try again.");
      setPending(false);
    }
  }

  const where = clubId ? "club files" : "your files";
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="files">{clubId ? "Club files" : "Your files"}</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="link">Google link</TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="space-y-3 pt-4">
          <p className="text-sm text-ink-2">
            Pick a file that&apos;s already in {where}. PDFs, images and videos preview right in the page; other files show with Open and Download buttons.
          </p>
          <p className="text-xs text-ink-3">Readers who can&apos;t open the file see a short &ldquo;no access&rdquo; note instead, never its contents.</p>
          <FilePicker clubId={clubId} open={pickerOpen} onOpenChange={setPickerOpen} onSelect={insertFiles} multiple accept="document" title={`Choose from ${where}`} />
        </TabsContent>
        <TabsContent value="upload" className="space-y-4 pt-4">
          <FileDrop file={file} onFile={setFile} icon={<FileUp />} hint={`PDFs, Word, Excel, PowerPoint and more, up to ${MAX_UPLOAD_MB} MB.`} />
          <label className="flex items-start justify-between gap-4 rounded-xl border border-line p-3">
            <span className="text-sm">
              <span className="block font-medium text-ink">Anyone who can read this can open the file</span>
              <span className="block text-ink-3">
                {everyone
                  ? "Best for flyers, agendas and public documents."
                  : clubScope
                    ? "Only club members will be able to open it."
                    : `Only signed-in ${INSTITUTION.shortName} accounts will be able to open it.`}
              </span>
            </span>
            <Switch checked={everyone} onCheckedChange={setEveryone} aria-label="Anyone who can read this can open the file" />
          </label>
        </TabsContent>
        <TabsContent value="link" className="space-y-3 pt-4">
          <Field label="Document link" hint={google ? `${google.label} — it will preview right in the page.` : "Google Docs, Sheets, Slides, Forms and Drive links preview in the page. Other links show as a card."}>
            {(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/document/d/…" inputMode="url" autoComplete="off" />}
          </Field>
          {google ? (
            <p className="text-xs text-ink-3">Check the sharing setting in Google: readers need at least &ldquo;Anyone with the link can view&rdquo; to see it.</p>
          ) : null}
          <Field label="Title (optional)">
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={google?.label ?? "e.g. Officer handbook"} maxLength={200} />}
          </Field>
        </TabsContent>
      </Tabs>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Footer
        onCancel={() => close()}
        submitLabel={tab === "files" ? "Browse files" : tab === "upload" ? (pending ? "Uploading…" : "Upload and attach") : "Attach document"}
        pending={pending}
        disabled={tab === "upload" ? !file : tab === "link" ? !link : false}
      />
    </form>
  );
}

// ─── Event ───────────────────────────────────────────────────────────────────

type EventRow = {
  id: string;
  title: string;
  when: string | null;
  upcoming: boolean;
  location: string;
  visibility: "PUBLIC" | "UNIVERSITY" | "MEMBERS";
  cancelled: boolean;
  clubName: string | null;
  clubColor: string | null;
};

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  const json = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: string } | null;
  if (!res.ok || !json?.ok || !json.data) throw new Error(json?.error ?? "Couldn't load that. Please try again.");
  return json.data;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function EventForm({ editor, clubId, close }: Ctx) {
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), 250);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; rows: EventRow[]; error?: string }>({ status: "loading", rows: [] });

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: "loading" }));
    const params = new URLSearchParams({ limit: "25" });
    if (clubId) params.set("clubId", clubId);
    if (query) params.set("q", query);
    getJson<{ events: EventRow[] }>(`/api/embeds/events?${params}`, ctrl.signal)
      .then((d) => setState({ status: "ready", rows: d.events }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setState({ status: "error", rows: [], error: e instanceof Error ? e.message : "Couldn't load events." });
      });
    return () => ctrl.abort();
  }, [clubId, query]);

  function pick(row: EventRow) {
    editor.commands.insertEmbed({ embed: "event", id: row.id, title: row.title });
    close();
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={clubId ? "Search this club's events" : "Search events"} className="pl-9" autoFocus aria-label="Search events" />
      </div>
      <div className="max-h-[50vh] min-h-40 overflow-y-auto rounded-xl border border-line" aria-busy={state.status === "loading"}>
        {state.status === "error" ? (
          <p className="p-4 text-sm text-danger" role="alert">
            {state.error}
          </p>
        ) : state.status === "loading" && state.rows.length === 0 ? (
          <div className="space-y-2 p-3" aria-label="Loading events">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : state.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <CalendarDays className="h-7 w-7 text-ink-3" aria-hidden />
            <p className="text-sm font-medium text-ink">{query ? `No events match “${query}”` : "No events to show yet"}</p>
            <p className="max-w-sm text-xs text-ink-3">{clubId ? "Plan one in the Events Builder, then come back to feature it here." : "Events you can see will show up here."}</p>
          </div>
        ) : (
          <ul className={cn("divide-y divide-line", state.status === "loading" && "opacity-60")}>
            {state.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => pick(row)}
                  className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.clubColor ?? "var(--color-brand)" }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-ink">{row.title}</span>
                      {row.cancelled ? <Badge tone="danger">Cancelled</Badge> : !row.upcoming ? <Badge>Past</Badge> : null}
                      {row.visibility === "MEMBERS" ? <Badge tone="brand">Members only</Badge> : null}
                    </span>
                    <span className="block truncate text-xs text-ink-3">
                      {[row.when ?? "Date to be announced", row.location, row.clubName ?? "University event"].join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-ink-3">Members-only events stay hidden from readers who aren&apos;t members.</p>
      <DialogFooter>
        <Button variant="outline" onClick={() => close()}>
          Cancel
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── Map ─────────────────────────────────────────────────────────────────────

type Building = { id: string; code: string; name: string; address: string | null; lat: number | null; lng: number | null };

function MapForm({ editor, close }: Ctx) {
  const [tab, setTab] = useState<"campus" | "address">("campus");
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Building | null>(null);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const previewAddress = useDebounced(address.trim(), 600);

  useEffect(() => {
    const ctrl = new AbortController();
    getJson<{ buildings: Building[] }>("/api/embeds/buildings", ctrl.signal)
      .then((d) => {
        setBuildings(d.buildings);
        if (d.buildings.length === 0) setTab("address");
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) {
          setBuildings([]);
          setLoadError(e instanceof Error ? e.message : "Couldn't load campus buildings.");
        }
      });
    return () => ctrl.abort();
  }, []);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (buildings ?? []).filter((b) => !f || b.name.toLowerCase().includes(f) || b.code.toLowerCase().includes(f));
  }, [buildings, filter]);

  function submit(e: FormEvent) {
    stop(e);
    if (tab === "campus") {
      if (!picked) return;
      editor.commands.insertEmbed({ embed: "map", id: picked.id, src: `${picked.name}, ${INSTITUTION.mapsSuffix}`, title: picked.name });
    } else {
      if (address.trim().length < 3) return;
      editor.commands.insertEmbed({ embed: "map", src: address.trim(), title: label.trim() || address.trim() });
    }
    close();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="campus">Campus building</TabsTrigger>
          <TabsTrigger value="address">Address</TabsTrigger>
        </TabsList>
        <TabsContent value="campus" className="space-y-3 pt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search buildings (e.g. Union, SU)" className="pl-9" aria-label="Search campus buildings" />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-line" role="radiogroup" aria-label="Campus buildings" aria-busy={buildings === null}>
            {buildings === null ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : loadError ? (
              <p className="p-4 text-sm text-danger" role="alert">
                {loadError}
              </p>
            ) : shown.length === 0 ? (
              <p className="p-4 text-center text-sm text-ink-3">
                {buildings.length === 0 ? "No campus buildings are set up yet. Use the Address tab instead." : "No buildings match that search."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {shown.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={picked?.id === b.id}
                      aria-label={`${b.name} (${b.code})`}
                      onClick={() => setPicked(b)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                        picked?.id === b.id && "bg-brand-50 hover:bg-brand-50",
                      )}
                    >
                      <MapPin className={cn("h-4 w-4 shrink-0", picked?.id === b.id ? "text-brand" : "text-ink-3")} aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{b.name}</span>
                      <span className="shrink-0 text-xs text-ink-3">{b.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {picked ? <MapEmbed query={`${picked.name}, ${INSTITUTION.mapsSuffix}`} lat={picked.lat} lng={picked.lng} label={picked.name} height={200} /> : null}
        </TabsContent>
        <TabsContent value="address" className="space-y-3 pt-4">
          <Field label="Address or place" hint={`Anything Google Maps understands, like "2314 Washington Blvd, Ogden".`}>
            {(id) => <Input id={id} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address or place name" autoComplete="street-address" />}
          </Field>
          <Field label="Label (optional)" hint="Shown under the map, e.g. the venue's name.">
            {(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Ogden Amphitheater" maxLength={120} />}
          </Field>
          {previewAddress.length >= 3 ? <MapEmbed query={previewAddress} label={label || previewAddress} height={200} /> : null}
        </TabsContent>
      </Tabs>
      <Footer onCancel={() => close()} submitLabel="Add map" disabled={tab === "campus" ? !picked : address.trim().length < 3} />
    </form>
  );
}

