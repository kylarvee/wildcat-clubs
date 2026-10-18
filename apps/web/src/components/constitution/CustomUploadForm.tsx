"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JoinPolicy, SuccessionMethod } from "@prisma/client";
import { Loader2, Upload, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { JOIN_OPTIONS, SUCCESSION_OPTIONS } from "@/lib/constitution/templates";
import { withdrawCustomDocumentAction } from "@/app/clubs/[slug]/manage/constitution/actions";
import { useFormSubmit } from "@/components/founding/useFormSubmit";

/** Upload a custom constitution or bylaws for WSUSA approval, stating the rules it sets. */
export function CustomUploadForm({ clubId, joinPolicy, successionMethod, pendingKinds }: { clubId: string; joinPolicy: JoinPolicy; successionMethod: SuccessionMethod; pendingKinds: ("CONSTITUTION" | "BYLAWS")[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"CONSTITUTION" | "BYLAWS">(pendingKinds.includes("CONSTITUTION") ? "BYLAWS" : "CONSTITUTION");
  const [error, setError] = useState<string | null>(null);
  const blocked = pendingKinds.includes(kind);

  const { pending, onSubmit } = useFormSubmit(async (fd, form) => {
    setError(null);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose your PDF or Word document.");
    if (!/\.(pdf|docx?)$/i.test(file.name)) return setError("Upload your document as a PDF or Word file.");
    if (file.size > 25 * 1024 * 1024) return setError("Files can be up to 25 MB.");
    fd.set("clubId", clubId);
    fd.set("kind", kind);
    const res = await fetch("/api/constitution/documents", { method: "POST", body: fd }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { ok: boolean; error?: string } | null;
    if (!json?.ok) return setError(json?.error ?? "The upload didn't go through. Check your connection and try again.");
    toast.success("Sent to WSUSA for approval");
    form.reset();
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate aria-busy={pending}>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Which document?</legend>
        <div className="flex flex-wrap gap-2">
          {(["CONSTITUTION", "BYLAWS"] as const).map((k) => (
            <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${kind === k ? "border-brand bg-brand-50/60" : "border-line-2"}`}>
              <input type="radio" name="kindChoice" checked={kind === k} onChange={() => setKind(k)} className="accent-[var(--color-brand)]" />
              {k === "CONSTITUTION" ? "Constitution" : "Bylaws"}
            </label>
          ))}
        </div>
      </fieldset>
      {blocked ? (
        <Callout tone="info">Your custom {kind === "CONSTITUTION" ? "constitution" : "bylaws"} is already waiting for WSUSA. Withdraw it above to upload a different one.</Callout>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title (optional)">{(id) => <Input id={id} name="title" maxLength={120} placeholder={kind === "CONSTITUTION" ? "Constitution (2027 revision)" : "Bylaws (2027 revision)"} />}</Field>
            <Field label="Document" required hint="PDF or Word, up to 25 MB.">
              {(id) => <input id={id} name="file" type="file" accept=".pdf,.doc,.docx" className="block w-full pt-1.5 text-sm text-ink-2 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand hover:file:bg-brand-100" />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Its primary way of choosing leaders" required hint="Wildcat Clubs starts every selection with it once WSUSA approves. The President and advisor can still use the others for a particular seat.">
              {(id) => (
                <Select id={id} name="successionMethod" defaultValue={successionMethod}>
                  {SUCCESSION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="How do students join?" required hint="Applied to your Register button on approval.">
              {(id) => (
                <Select id={id} name="joinPolicy" defaultValue={joinPolicy}>
                  {JOIN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Note to WSUSA (optional)" hint="What changed and why — it helps reviewers move faster.">
            {(id) => <Textarea id={id} name="note" rows={2} maxLength={2000} />}
          </Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
            {pending ? "Uploading…" : "Send for WSUSA approval"}
          </Button>
        </>
      )}
    </form>
  );
}

export function WithdrawButton({ docId, label }: { docId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="outline" disabled={busy}>
          <Undo2 className="h-4 w-4" aria-hidden /> Withdraw
        </Button>
      }
      title={`Withdraw your custom ${label}?`}
      description="WSUSA stops reviewing it. Your current documents stay in effect."
      confirmLabel="Withdraw"
      onConfirm={async () => {
        setBusy(true);
        const r = await withdrawCustomDocumentAction(docId);
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        toast.success("Withdrawn");
        router.refresh();
      }}
    />
  );
}
