"use client";

import { useRef, useState } from "react";
import { FileText, FolderOpen, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Label } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import { FilePicker, type PickedFile } from "@/components/files/FilePicker";
import { useRunAction } from "@/components/roles/useRunAction";
import { addContribution, removeContribution } from "../actions";

type Attached = { id: string; name: string };

/**
 * Add a project or contribution to a role: title, a write-up, a link and
 * files (uploaded here or picked from the club's files). The role holder can
 * do this any time — even years after the role ended.
 */
export function ContributionDialog({ slug, clubId, assignmentId, seatName, holderName, isSelf }: { slug: string; clubId: string; assignmentId: string; seatName: string; holderName: string; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState("");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [uploading, setUploading] = useState(0);
  const [picker, setPicker] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const { pending, error, setError, run } = useRunAction();

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setTitle("");
      setHtml("");
      setUrl("");
      setFiles([]);
      setError(null);
      setEditorKey((k) => k + 1);
    }
  }

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const chosen = Array.from(list);
    setUploading((n) => n + chosen.length);
    await Promise.all(
      chosen.map(async (file) => {
        const body = new FormData();
        body.set("file", file);
        body.set("scope", "user");
        // Signed-in viewers of the role history can open it; the uploader keeps ownership.
        body.set("visibility", "MEMBERS");
        try {
          const res = await fetch("/api/files/upload", { method: "POST", body });
          const json = (await res.json()) as { ok: boolean; data?: { id: string; name: string }; error?: string };
          if (json.ok && json.data) setFiles((cur) => [...cur, { id: json.data!.id, name: json.data!.name }]);
          else toast.error(`${file.name}: ${json.error ?? "upload failed"}`);
        } catch {
          toast.error(`${file.name}: upload failed. Check your connection.`);
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
    if (input.current) input.current.value = "";
  }

  function picked(list: PickedFile[]) {
    setFiles((cur) => [...cur, ...list.filter((f) => !cur.some((c) => c.id === f.id)).map((f) => ({ id: f.id, name: f.name }))]);
  }

  async function save() {
    if (title.trim().length < 2) return setError("Give the contribution a title.");
    const r = await run(() => addContribution(slug, assignmentId, { title: title.trim(), descriptionHtml: html, url: url.trim() || null, fileIds: files.map((f) => f.id) }));
    if (r.ok) {
      toast.success(r.data.skippedFiles ? `Added. ${r.data.skippedFiles} file(s) weren't attached because you can't view them.` : `Added to ${isSelf ? "your" : `${holderName}'s`} ${seatName} role.`);
      reset(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4" aria-hidden /> Add contribution
        </Button>
      </DialogTrigger>
      <DialogContent wide title="Add a contribution" description={`Something ${isSelf ? "you" : holderName} built, ran or led as ${seatName}. It shows in the club's role history${isSelf ? " and on your profile" : ""}.`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Title" required>
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Spring 2026 Hackathon" autoFocus required />}
          </Field>
          <div className="space-y-1.5">
            <Label>What was it?</Label>
            <RichTextEditor key={editorKey} onChange={setHtml} clubId={clubId} variant="basic" minHeight={120} placeholder="What you did, who it helped, what the next person should know." />
          </div>
          <Field label="Link (optional)" hint="A website, slide deck, repo or recap.">
            {(id) => <Input id={id} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" maxLength={500} />}
          </Field>

          <div className="space-y-2">
            <Label>Files (optional)</Label>
            {files.length ? (
              <ul className="space-y-1.5">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                    <FileText className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <input ref={input} type="file" multiple className="sr-only" id={`upload-${assignmentId}`} onChange={(e) => void upload(e.target.files)} />
              <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading > 0}>
                {uploading > 0 ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                {uploading > 0 ? `Uploading ${uploading}…` : "Upload files"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setPicker(true)}>
                <FolderOpen className="h-4 w-4" aria-hidden /> Choose from club files
              </Button>
            </div>
            <p className="text-xs text-ink-3">Uploads are visible to signed-in Weber State accounts who open this history. Up to 25 MB each.</p>
          </div>

          {error ? <Callout tone="danger">{error}</Callout> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => reset(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || uploading > 0}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Add contribution
            </Button>
          </DialogFooter>
        </form>
        <FilePicker clubId={clubId} open={picker} onOpenChange={setPicker} onSelect={picked} multiple title="Attach club files" />
      </DialogContent>
    </Dialog>
  );
}

/** `holderName` is set when someone other than the holder removes it: it leaves the role but stays on their profile (roles.removeRoleContribution). */
export function RemoveContributionButton({ slug, projectId, title, holderName }: { slug: string; projectId: string; title: string; holderName?: string }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" className="h-7 w-7 text-ink-3 hover:text-danger" aria-label={`Remove ${title}`} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      }
      title={`Remove “${title}”?`}
      description={
        holderName
          ? `It comes off the role history. It stays on ${holderName}'s profile, where only they can delete it.`
          : "It comes off the role history and your profile. Attached files stay wherever they were stored."
      }
      confirmLabel="Remove"
      danger
      onConfirm={() => {
        void run(() => removeContribution(slug, projectId), { success: "Contribution removed.", toastError: true });
      }}
    />
  );
}
