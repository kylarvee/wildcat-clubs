"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PolicyPlacement, PolicyStatus } from "@prisma/client";
import { AlertCircle, ExternalLink, FileUp, Loader2, Lock, PenLine, Save, Trash2, Upload } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { toast } from "@/components/ui/misc";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import { DocumentPreview } from "@/components/embeds/DocumentPreview";
import { deletePolicyAction, savePolicyAction } from "@/app/admin/policies/actions";
import { isPolicyDocument, PLACEMENTS, POLICY_DOC_ACCEPT, policySlug } from "@/components/policies/placements";
import { MAX_UPLOAD_MB } from "@/lib/rich/embeds";

export type PolicyDoc = { id: string; name: string; mimeType: string | null; sizeBytes: number | null };

export type PolicyEditorInitial = {
  id: string | null;
  title: string;
  slug: string;
  summary: string;
  bodyHtml: string;
  document: PolicyDoc | null;
  placements: PolicyPlacement[];
  status: PolicyStatus;
  effectiveOn: string;
  version: number;
  /** Once published, the address can't change (links would break). */
  published: boolean;
};

const STATUS_CHOICES: { value: PolicyStatus; label: string; detail: string }[] = [
  { value: "DRAFT", label: "Draft", detail: "Only administrators can see it." },
  { value: "PUBLISHED", label: "Published", detail: "In the policy library and everywhere its placements say." },
  { value: "ARCHIVED", label: "Archived", detail: "Taken out of the library and the app. Its record stays." },
];

/**
 * The one input tool for policy text: write it in the editor or upload a
 * document, choose where it shows, and publish. Publishing changed text of a
 * published policy makes it the next version.
 */
export function PolicyEditor({ initial }: { initial: PolicyEditorInitial }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.id));
  const [summary, setSummary] = useState(initial.summary);
  const [mode, setMode] = useState<"write" | "upload">(initial.document && !initial.bodyHtml ? "upload" : "write");
  const [bodyHtml, setBodyHtml] = useState(initial.bodyHtml);
  const [doc, setDoc] = useState<PolicyDoc | null>(initial.document);
  const [placements, setPlacements] = useState<PolicyPlacement[]>(initial.placements);
  const [status, setStatus] = useState<PolicyStatus>(initial.status);
  const [effectiveOn, setEffectiveOn] = useState(initial.effectiveOn);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const modeName = useId();
  const statusName = useId();

  const touch = () => setDirty(true);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const shownSlug = slugTouched || initial.published ? slug : policySlug(title);

  const upload = async (file: File) => {
    setError(null);
    if (!isPolicyDocument(file.name, file.type)) return setError("Upload a PDF or Word document.");
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return setError(`That file is larger than ${MAX_UPLOAD_MB} MB.`);
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("scope", "university");
      body.set("visibility", "PUBLIC");
      const res = await fetch("/api/files/upload", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { ok: boolean; data?: PolicyDoc & { url: string }; error?: string } | null;
      if (!res.ok || !json?.ok || !json.data) throw new Error(json?.error ?? "That upload didn't go through. Please try again.");
      setDoc({ id: json.data.id, name: json.data.name, mimeType: json.data.mimeType, sizeBytes: json.data.sizeBytes });
      touch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That upload didn't go through. Please try again.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const save = (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    start(async () => {
      const r = await savePolicyAction(initial.id, {
        title,
        slug: shownSlug,
        summary,
        mode,
        bodyHtml: mode === "write" ? bodyHtml : null,
        documentFileId: mode === "upload" ? (doc?.id ?? null) : null,
        placements,
        status,
        effectiveOn,
      }).catch(() => null);
      if (!r) return setError("We couldn't reach the server. Your changes are still here — try again.");
      if (!r.ok) return setError(r.error);
      setDirty(false);
      const d = r.data;
      toast.success(
        d.status === "PUBLISHED"
          ? d.bumped
            ? `Published as version ${d.version}.`
            : "Published. It's in the library and everywhere you placed it."
          : d.status === "ARCHIVED"
            ? "Archived. It's no longer shown in the app."
            : "Draft saved.",
      );
      if (!initial.id) router.replace(`/admin/policies/${d.id}`);
      else router.refresh();
    });
  };

  const remove = () =>
    start(async () => {
      if (!initial.id) return;
      const r = await deletePolicyAction(initial.id);
      if (!r.ok) return setError(r.error);
      setDirty(false);
      toast.success("Draft deleted.");
      router.replace("/admin/policies");
    });

  const togglePlacement = (p: PolicyPlacement) => {
    setPlacements((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
    touch();
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <Card>
        <CardHeader title="The basics" />
        <CardBody className="space-y-4">
          <Field label="Title" required>
            {(id) => (
              <Input
                id={id}
                value={title}
                maxLength={120}
                onChange={(e) => {
                  setTitle(e.target.value);
                  touch();
                }}
                placeholder="e.g. Event Safety"
              />
            )}
          </Field>
          <Field
            label="Web address"
            hint={initial.published ? "Fixed once published, so links to it keep working." : "Lowercase letters, numbers and hyphens. It can't change after the policy is first published."}
          >
            {(id) => (
              <div className="flex items-center rounded-lg border border-line-2 bg-muted/60 pl-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-100">
                <span className="shrink-0 text-sm text-ink-3">/policies/</span>
                <input
                  id={id}
                  value={shownSlug}
                  readOnly={initial.published}
                  maxLength={80}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                    setSlugTouched(true);
                    touch();
                  }}
                  className={cn("h-10 min-w-0 flex-1 rounded-r-lg bg-surface px-1 text-sm text-ink focus:outline-none", initial.published && "bg-transparent text-ink-2")}
                />
                {initial.published ? <Lock className="mr-3 h-4 w-4 shrink-0 text-ink-3" aria-label="Locked" /> : null}
              </div>
            )}
          </Field>
          <Field label="Summary" required hint={`${summary.trim().length}/400 · One or two sentences. It shows everywhere the policy appears, with a link to the full text.`}>
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={400}
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  touch();
                }}
                placeholder="What this policy asks of clubs, in plain words."
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Policy text" description="Write it here, or upload the official document." />
        <CardBody className="space-y-4">
          <fieldset>
            <legend className="sr-only">How you'll add the policy</legend>
            <div className="inline-flex rounded-lg border border-line-2 p-0.5">
              {(
                [
                  ["write", "Write", <PenLine key="w" className="h-4 w-4" aria-hidden />],
                  ["upload", "Upload a document", <FileUp key="u" className="h-4 w-4" aria-hidden />],
                ] as const
              ).map(([value, label, icon]) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand",
                    mode === value ? "bg-brand text-white" : "text-ink-2 hover:bg-muted",
                  )}
                >
                  <input
                    type="radio"
                    name={modeName}
                    value={value}
                    checked={mode === value}
                    onChange={() => {
                      setMode(value);
                      touch();
                    }}
                    className="sr-only"
                  />
                  {icon} {label}
                </label>
              ))}
            </div>
          </fieldset>

          {mode === "write" ? (
            <RichTextEditor
              defaultValue={initial.bodyHtml}
              onChange={(html) => {
                setBodyHtml(html);
                touch();
              }}
              fileScope="university"
              variant="full"
              minHeight={320}
              ariaLabel="Policy text"
              placeholder="Write the policy. Use headings for sections; paste links to WSU policy pages where they help."
            />
          ) : (
            <div className="space-y-3">
              <input ref={fileInput} type="file" accept={POLICY_DOC_ACCEPT} className="sr-only" id="policy-doc" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              {doc ? (
                <>
                  <DocumentPreview fileId={doc.id} name={doc.name} mimeType={doc.mimeType} sizeBytes={doc.sizeBytes} height={480} />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />} Replace document
                    </Button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-2 px-6 py-10 text-center hover:border-brand hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-brand"
                >
                  {uploading ? <Loader2 className="h-8 w-8 animate-spin text-brand" aria-hidden /> : <Upload className="h-8 w-8 text-ink-3" aria-hidden />}
                  <span className="font-medium text-ink">{uploading ? "Uploading…" : "Upload a PDF or Word document"}</span>
                  <span className="text-sm text-ink-3">Up to {MAX_UPLOAD_MB} MB. PDFs preview right on the policy page; Word documents show as a download. Anyone can open it.</span>
                </button>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Where it shows" description="Every published policy is in the policy library. Choose where else people should see it." />
        <CardBody>
          <fieldset>
            <legend className="sr-only">Placements</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {PLACEMENTS.map((p) => (
                <Checkbox key={p.value} label={p.label} description={p.where} checked={placements.includes(p.value)} onChange={() => togglePlacement(p.value)} />
              ))}
            </div>
            {placements.length === 0 ? <p className="mt-3 text-xs text-ink-3">Nothing chosen — it will be listed under General in the library only.</p> : null}
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Status" />
        <CardBody className="grid gap-6 md:grid-cols-[minmax(0,1fr)_14rem]">
          <fieldset className="space-y-2">
            <legend className="sr-only">Status</legend>
            {STATUS_CHOICES.map((s) => (
              <label key={s.value} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3", status === s.value ? "border-brand bg-brand-50/60" : "border-line hover:bg-muted/50")}>
                <input
                  type="radio"
                  name={statusName}
                  checked={status === s.value}
                  onChange={() => {
                    setStatus(s.value);
                    touch();
                  }}
                  className="mt-1 accent-[var(--color-brand)]"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">{s.label}</span>
                  <span className="block text-xs text-ink-3">{s.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="space-y-4">
            <Field label="Effective date" hint={status === "PUBLISHED" && !effectiveOn ? "Leave blank to use the day you publish." : "Shown on the policy page."}>
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={effectiveOn}
                  onChange={(e) => {
                    setEffectiveOn(e.target.value);
                    touch();
                  }}
                />
              )}
            </Field>
            {initial.id ? (
              <p className="text-sm text-ink-2">
                Version {initial.version}
                {initial.published ? <span className="block text-xs text-ink-3">Publishing changes to the title, summary or text makes it version {initial.version + 1}.</span> : null}
              </p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <div className="sticky bottom-0 z-20 rounded-t-2xl border border-line bg-surface/95 px-4 py-3 shadow-[var(--shadow-pop)] backdrop-blur">
        {error ? (
          <p role="alert" className="mb-2 flex items-start gap-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-ink-3" aria-live="polite">
            {pending ? "Saving…" : dirty ? "Unsaved changes" : initial.id ? "All changes saved" : "New policy"}
          </p>
          {initial.id && !initial.published ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} disabled={pending} className="text-danger hover:text-danger">
              <Trash2 className="h-4 w-4" aria-hidden /> Delete draft
            </Button>
          ) : null}
          {initial.id && !dirty ? (
            <ButtonLink href={`/policies/${initial.slug}`} variant="outline" size="sm" target="_blank">
              <ExternalLink className="h-4 w-4" aria-hidden /> View page
            </ButtonLink>
          ) : null}
          <Button type="submit" size="sm" disabled={pending || uploading}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {status === "PUBLISHED"
              ? initial.status === "PUBLISHED"
                ? "Save & publish changes"
                : "Publish"
              : status === "ARCHIVED"
                ? initial.status === "ARCHIVED"
                  ? "Save"
                  : "Archive"
                : initial.status === "PUBLISHED"
                  ? "Unpublish & save as draft"
                  : "Save draft"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this draft?"
        description="It has never been published, so nothing links to it. This can't be undone."
        confirmLabel="Delete draft"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          remove();
        }}
      />
    </form>
  );
}
