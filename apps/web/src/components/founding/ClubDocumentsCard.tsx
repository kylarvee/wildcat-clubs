"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { removeClubDocumentAction } from "@/app/clubs/[slug]/manage/profile/actions";
import { useFormSubmit } from "@/components/founding/useFormSubmit";

export type ProfileDocRow = {
  id: string;
  kind: "CONSTITUTION" | "BYLAWS" | "OTHER";
  title: string;
  statusLabel: string;
  statusTone: "success" | "info" | "neutral";
  fileUrl: string | null;
  meta: string;
};

/** "Additional documents" on the profile: constitution/bylaws (managed elsewhere) plus other documents leaders upload here. */
export function ClubDocumentsCard({ clubId, docs, constitutionHref }: { clubId: string; docs: ProfileDocRow[]; constitutionHref: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();

  const { pending: uploading, onSubmit } = useFormSubmit(async (fd, form) => {
    setError(null);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file to upload.");
    if (file.size > 25 * 1024 * 1024) return setError("Files can be up to 25 MB.");
    fd.set("kind", "OTHER");
    fd.set("clubId", clubId);
    const res = await fetch("/api/constitution/documents", { method: "POST", body: fd }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { ok: boolean; error?: string } | null;
    if (!json?.ok) return setError(json?.error ?? "The upload didn't go through. Check your connection and try again.");
    toast.success("Document added to your profile");
    form.reset();
    router.refresh();
  });

  return (
    <Card>
      <CardHeader title="Additional documents" description="Shown under Resources on your club page. Constitution and bylaws are managed in the Constitution tool." />
      <CardBody className="space-y-5">
        {docs.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <FileText className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />
                <span className="min-w-0 flex-1 text-sm">
                  {d.fileUrl ? (
                    <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:text-brand hover:underline">
                      {d.title}
                    </a>
                  ) : (
                    <span className="font-medium text-ink">{d.title}</span>
                  )}
                  <span className="block text-xs text-ink-3">{d.meta}</span>
                </span>
                <Badge tone={d.statusTone}>{d.statusLabel}</Badge>
                {d.kind === "OTHER" ? (
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" variant="ghost" disabled={removing} aria-label={`Remove ${d.title} from the profile`}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    }
                    title={`Remove “${d.title}” from your profile?`}
                    description="It stops showing on your club page. The file itself stays in Club files."
                    confirmLabel="Remove"
                    danger
                    onConfirm={() =>
                      startRemove(async () => {
                        const r = await removeClubDocumentAction(d.id);
                        if (!r.ok) toast.error(r.error);
                        else {
                          toast.success("Removed from your profile");
                          router.refresh();
                        }
                      })
                    }
                  />
                ) : constitutionHref ? (
                  <Link href={constitutionHref} className="text-sm font-medium text-brand-600 hover:underline">
                    Manage
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">No documents yet. Add things like a club handbook, meeting schedule, or sponsor packet.</p>
        )}

        <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-dashed border-line-2 p-4" noValidate aria-busy={uploading}>
          <p className="text-sm font-medium text-ink">Add a document</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <Field label="Title" required>
              {(id) => <Input id={id} name="title" maxLength={120} placeholder="e.g. New member handbook" required />}
            </Field>
            <Field label="Who can see it">
              {(id) => (
                <Select id={id} name="visibility" defaultValue="PUBLIC">
                  <option value="PUBLIC">Everyone</option>
                  <option value="MEMBERS">Members only</option>
                </Select>
              )}
            </Field>
          </div>
          <Field label="File" required hint="PDF, Word, PowerPoint, Excel, text or image — up to 25 MB.">
            {(id) => <input id={id} name="file" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.png,.jpg,.jpeg" className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand hover:file:bg-brand-100" />}
          </Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Button type="submit" variant="secondary" disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
            {uploading ? "Uploading…" : "Add document"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
