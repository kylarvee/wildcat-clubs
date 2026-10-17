"use client";

import { useRef, useState } from "react";
import { FileText, FolderKanban, FolderOpen, Loader2, Paperclip, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Label, Select } from "@/components/ui/form";
import { Callout, EmptyState } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import { FilePicker, type PickedFile } from "@/components/files/FilePicker";
import { useRunAction } from "@/components/roles/useRunAction";
import { MonthYearInput, isCompleteMonth } from "@/components/profile/settings/MonthYearInput";
import { addProjectAction, deleteProjectAction, updateProjectAction, type ProjectForm } from "@/app/settings/actions";
import { fmtMonthSpan, fmtMonthYear, toMonthInput } from "@/lib/profiles/format";
import type { MyProject, MyRoleOption } from "@/lib/profiles/queries";

type Attached = { id: string; name: string };

/**
 * Your projects. Link one to a club role you held and it shows under that
 * role on your profile and in the club's role history (they're the same
 * record); otherwise it's listed under Projects.
 */
export function ProjectManager({ projects, roles }: { projects: MyProject[]; roles: MyRoleOption[] }) {
  const [editing, setEditing] = useState<MyProject | "new" | null>(null);
  const roleById = new Map(roles.map((r) => [r.id, r]));
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Your projects</h2>
          <p className="mt-1 text-sm text-ink-3">Things you built, ran, researched or wrote — with links and files.</p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" aria-hidden /> Add project
        </Button>
      </div>
      {projects.length ? (
        <ul className="mt-5 divide-y divide-line">
          {projects.map((p) => {
            const role = p.roleAssignmentId ? roleById.get(p.roleAssignmentId) : null;
            return (
              <li key={p.id} className="flex flex-wrap items-start gap-3 py-4 first:pt-0 last:pb-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-3">
                  <FolderKanban className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{p.title}</p>
                  <p className="text-sm text-ink-3">
                    {role ? `${role.label} · ${role.clubName}` : "Personal project"}
                    {p.startDate ? ` · ${p.endDate ? fmtMonthSpan(p.startDate, p.endDate) : fmtMonthYear(p.startDate)}` : ""}
                  </p>
                  {p.files.length ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-ink-3">
                      <Paperclip className="h-3.5 w-3.5" aria-hidden /> {p.files.length} file{p.files.length === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.title}`}>
                    <Pencil className="h-4 w-4" aria-hidden /> Edit
                  </Button>
                  <DeleteProject project={p} inRole={Boolean(role)} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState className="mt-5" icon={<FolderKanban />} title="No projects yet" description="Add a project — a hackathon build, an event you ran, a research poster — and attach the files that show it off." />
      )}
      {editing ? <ProjectDialog project={editing === "new" ? null : editing} roles={roles} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function DeleteProject({ project, inRole }: { project: MyProject; inRole: boolean }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label={`Delete ${project.title}`} disabled={pending} className="text-ink-3 hover:text-danger">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      }
      title={`Delete “${project.title}”?`}
      description={inRole ? "It comes off your profile and the club's role history. Attached files stay where they're stored." : "It comes off your profile. Attached files stay in your files."}
      confirmLabel="Delete"
      danger
      onConfirm={() => {
        void run(() => deleteProjectAction(project.id), { success: "Project deleted.", toastError: true });
      }}
    />
  );
}

function ProjectDialog({ project, roles, onClose }: { project: MyProject | null; roles: MyRoleOption[]; onClose: () => void }) {
  const [title, setTitle] = useState(project?.title ?? "");
  const [html, setHtml] = useState(project?.descriptionHtml ?? "");
  const [url, setUrl] = useState(project?.url ?? "");
  const [start, setStart] = useState(toMonthInput(project?.startDate));
  const [end, setEnd] = useState(toMonthInput(project?.endDate));
  const [roleId, setRoleId] = useState(project?.roleAssignmentId ?? "");
  const [files, setFiles] = useState<Attached[]>(project?.files.map((f) => ({ id: f.id, name: f.name })) ?? []);
  const [uploading, setUploading] = useState(0);
  const [picker, setPicker] = useState<null | "mine" | "club">(null);
  const input = useRef<HTMLInputElement>(null);
  const { pending, error, setError, run } = useRunAction();
  const role = roles.find((r) => r.id === roleId) ?? null;

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const chosen = Array.from(list);
    setUploading((n) => n + chosen.length);
    await Promise.all(
      chosen.map(async (file) => {
        const body = new FormData();
        body.set("file", file);
        body.set("scope", "user");
        // Profiles are for signed-in Weber State accounts, so are their files.
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
    if (title.trim().length < 2) return setError("Give the project a title.");
    if ((start && !isCompleteMonth(start)) || (end && !isCompleteMonth(end))) return setError("Pick both a month and a year for each date, or leave them empty.");
    if (end && !start) return setError("Add a start month too, or leave the end empty.");
    const input: ProjectForm = { title: title.trim(), descriptionHtml: html, url: url.trim(), startDate: start, endDate: end, roleAssignmentId: roleId, fileIds: files.map((f) => f.id) };
    const r = await run(() => (project ? updateProjectAction(project.id, input) : addProjectAction(input)));
    if (r.ok) {
      const skipped = r.data.skippedFiles;
      toast.success(`${project ? "Project saved" : "Project added"}${skipped ? `. ${skipped} file${skipped === 1 ? " wasn't" : "s weren't"} attached because you can't open ${skipped === 1 ? "it" : "them"}` : ""}.`);
      onClose();
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent wide title={project ? "Edit project" : "Add a project"} description="Shows on your profile. Link it to a club role to add it to that role's history too.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Title" required>
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required autoFocus placeholder="e.g. Advising FAQ Chatbot" />}
          </Field>
          <Field label="Club role" hint={roles.length ? "Optional. Projects from a role show under it on your profile and in the club's role history." : "You haven't held a club role yet, so this is a personal project."}>
            {(id) => (
              <Select id={id} value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={!roles.length}>
                <option value="">Not tied to a club role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} · {r.clubName} ({r.current ? `since ${fmtMonthYear(r.startedAt)}` : fmtMonthSpan(r.startedAt, r.endedAt)})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="space-y-1.5">
            <Label>What was it?</Label>
            <RichTextEditor defaultValue={project?.descriptionHtml} onChange={setHtml} clubId={role?.clubId ?? null} fileScope="user" variant="basic" minHeight={120} stickyToolbarTop={0} ariaLabel="Project description" placeholder="What you did, who it helped, what you learned." />
          </div>
          <Field label="Link" hint="Optional. A website, repo, slide deck or recap.">
            {(id) => <Input id={id} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" maxLength={500} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <MonthYearInput legend="Started" value={start} onChange={setStart} hint="Optional" />
            <MonthYearInput legend="Finished" value={end} onChange={setEnd} hint="Leave empty if it's ongoing or a one-off." />
          </div>

          <div className="space-y-2">
            <Label>Files</Label>
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
              <input ref={input} type="file" multiple className="sr-only" id="project-upload" onChange={(e) => void upload(e.target.files)} />
              <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading > 0}>
                {uploading > 0 ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                {uploading > 0 ? `Uploading ${uploading}…` : "Upload files"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setPicker("mine")}>
                <FolderOpen className="h-4 w-4" aria-hidden /> Choose from my files
              </Button>
              {role ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setPicker("club")}>
                  <FolderOpen className="h-4 w-4" aria-hidden /> Choose from {role.clubName} files
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-ink-3">Uploads can be opened by signed-in Weber State accounts who view your profile. Up to 25 MB each.</p>
          </div>

          {role ? (
            <p className="flex items-center gap-2 text-xs text-ink-3">
              <Badge tone="brand">{role.clubName}</Badge> This project will also appear in the club&apos;s role history.
            </p>
          ) : null}
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || uploading > 0}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {project ? "Save project" : "Add project"}
            </Button>
          </DialogFooter>
        </form>
        <FilePicker
          clubId={picker === "club" && role ? role.clubId : null}
          open={picker !== null}
          onOpenChange={(o) => (!o ? setPicker(null) : null)}
          onSelect={picked}
          multiple
          title={picker === "club" && role ? `Attach ${role.clubName} files` : "Attach your files"}
        />
      </DialogContent>
    </Dialog>
  );
}
