"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { EyeOff, History, Loader2, Lock, MessageSquarePlus, UserRound } from "lucide-react";
import type { ComplaintStatus } from "@prisma/client";
import type { ComplaintDetail } from "@/lib/domain/complaints";
import { fmtLongDate, fmtTime } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select, Textarea } from "@/components/ui/form";
import { toast } from "@/components/ui/misc";
import { ANONYMITY_NOTICE, COMPLAINT_STATUS_CHOICES, COMPLAINT_STATUS_HELP, COMPLAINT_STATUS_LABEL, COMPLAINT_STATUS_TONE } from "@/components/admin/complaint-copy";
import { addComplaintNoteAction, setComplaintStatusAction } from "@/app/admin/complaints/actions";

type Patch = (d: ComplaintDetail) => Partial<ComplaintDetail>;

const when = (iso: string) => `${fmtLongDate(iso)} at ${fmtTime(iso)}`;

/**
 * One report, opened. Lives only in this dialog's state: closing it forgets
 * the content, and there is deliberately no export, print, share, forward,
 * email or copy-all here. The content is also hidden from printing.
 */
export function ComplaintDetailDialog({ detail, onClose, onChange }: { detail: ComplaintDetail | null; onClose: () => void; onChange: (patch: Patch) => void }) {
  return (
    <Dialog open={detail !== null} onOpenChange={(o) => (o ? null : onClose())}>
      {detail ? (
        <DialogContent
          wide
          className="print:hidden"
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono tracking-wider">{detail.caseCode}</span>
              <Badge tone={COMPLAINT_STATUS_TONE[detail.status]}>{COMPLAINT_STATUS_LABEL[detail.status]}</Badge>
            </span>
          }
          description={`${detail.category} · received ${when(detail.createdAt)}`}
        >
          <Body detail={detail} onChange={onChange} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function Body({ detail, onChange }: { detail: ComplaintDetail; onChange: (patch: Patch) => void }) {
  return (
    <div className="space-y-6">
      {detail.isAnonymous ? (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-warning-50 px-4 py-3 text-sm text-amber-900">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{ANONYMITY_NOTICE}</p>
        </div>
      ) : null}

      <dl className="grid gap-x-6 gap-y-3 rounded-xl bg-muted/50 px-4 py-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Reporter</dt>
          <dd className="mt-0.5 text-ink">
            {detail.reporter ? (
              <span className="flex flex-col">
                <Link href={`/admin/users/${detail.reporter.id}`} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
                  <UserRound className="h-3.5 w-3.5" aria-hidden /> {detail.reporter.name}
                </Link>
                {/* Plain text on purpose: no email or forwarding shortcuts anywhere in a report. */}
                <span className="break-all text-ink-2">{detail.reporter.email}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-ink-2">
                <EyeOff className="h-3.5 w-3.5" aria-hidden /> Anonymous — not stored
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Club involved</dt>
          <dd className="mt-0.5 text-ink">
            {detail.club ? (
              <Link href={`/admin/clubs/${detail.club.id}`} className="font-medium text-brand-600 hover:underline">
                {detail.club.name}
              </Link>
            ) : (
              <span className="text-ink-3">Not named</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">When it happened</dt>
          <dd className="mt-0.5 text-ink">{detail.incidentDate ? fmtLongDate(detail.incidentDate) : <span className="text-ink-3">Not given</span>}</dd>
        </div>
      </dl>

      <section aria-labelledby="complaint-subject">
        <h3 id="complaint-subject" className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
          {detail.subject}
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">{detail.body}</p>
      </section>

      <StatusForm key={`${detail.id}:${detail.status}`} detail={detail} onChange={onChange} />
      <Notes key={detail.id} detail={detail} onChange={onChange} />
      <AccessLog detail={detail} />
    </div>
  );
}

function StatusForm({ detail, onChange }: { detail: ComplaintDetail; onChange: (patch: Patch) => void }) {
  const choices = COMPLAINT_STATUS_CHOICES.filter((s) => s !== detail.status);
  const [status, setStatus] = useState<ComplaintStatus>(choices[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const selectId = useId();
  const noteId = useId();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const note = String(new FormData(form).get("note") ?? "").trim();
    setError(null);
    start(async () => {
      try {
        const r = await setComplaintStatusAction(detail.id, status, note || null);
        if (!r.ok) return setError(r.error);
        const { note: savedNote, status: saved, updatedAt } = r.data;
        onChange((d) => ({ status: saved, updatedAt, notes: savedNote ? [...d.notes, savedNote] : d.notes }));
        form.reset();
        toast.success(`Marked ${COMPLAINT_STATUS_LABEL[saved].toLowerCase()}`);
      } catch {
        setError("We couldn't reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <section aria-labelledby="complaint-status" className="rounded-xl border border-line p-4">
      <h3 id="complaint-status" className="text-sm font-semibold text-ink">
        Status
      </h3>
      <p className="mt-0.5 text-sm text-ink-3">
        {COMPLAINT_STATUS_LABEL[detail.status]} since {when(detail.updatedAt)}. What the reporter sees: “{COMPLAINT_STATUS_HELP[detail.status]}”
      </p>
      <form onSubmit={submit} className="mt-3 space-y-3" aria-busy={pending}>
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <div>
            <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-ink-3">
              Change to
            </label>
            <Select id={selectId} value={status} onChange={(e) => setStatus(e.target.value as ComplaintStatus)}>
              {choices.map((s) => (
                <option key={s} value={s}>
                  {COMPLAINT_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={noteId} className="mb-1 block text-xs font-medium text-ink-3">
              Note for administrators <span className="font-normal">(optional)</span>
            </label>
            <Textarea id={noteId} name="note" rows={2} maxLength={4000} placeholder={status === "REFERRED" ? "Which office it went to, and when" : "Why the status is changing"} />
          </div>
        </div>
        <p className="text-xs text-ink-3">{COMPLAINT_STATUS_HELP[status]}</p>
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {pending ? "Saving…" : `Mark ${COMPLAINT_STATUS_LABEL[status].toLowerCase()}`}
        </Button>
      </form>
    </section>
  );
}

function Notes({ detail, onChange }: { detail: ComplaintDetail; onChange: (patch: Patch) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = useId();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (body.length < 2) return setError("Write the note first.");
    setError(null);
    start(async () => {
      try {
        const r = await addComplaintNoteAction(detail.id, body);
        if (!r.ok) return setError(r.error);
        onChange((d) => ({ notes: [...d.notes, r.data] }));
        form.reset();
        toast.success("Note added");
      } catch {
        setError("We couldn't reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <section aria-labelledby="complaint-notes">
      <h3 id="complaint-notes" className="text-sm font-semibold text-ink">
        Internal notes <span className="font-normal text-ink-3">· administrators only</span>
      </h3>
      {detail.notes.length ? (
        <ol className="mt-2 space-y-2">
          {detail.notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              <p className="text-xs text-ink-3">
                <span className="font-medium text-ink-2">{n.author}</span> · {when(n.createdAt)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{n.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-sm text-ink-3">No notes yet. Record what you did and decided, so the next administrator can pick it up.</p>
      )}
      <form onSubmit={submit} className="mt-3 space-y-2" aria-busy={pending}>
        <label htmlFor={id} className="sr-only">
          New note
        </label>
        <Textarea id={id} name="body" rows={3} maxLength={4000} placeholder="Add a note…" aria-invalid={error ? true : undefined} />
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageSquarePlus className="h-4 w-4" aria-hidden />}
          Add note
        </Button>
      </form>
    </section>
  );
}

function AccessLog({ detail }: { detail: ComplaintDetail }) {
  return (
    <details className="group rounded-xl border border-line px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink">
        <History className="h-4 w-4 text-ink-3" aria-hidden />
        Who opened this report
        <span className="font-normal text-ink-3">· {detail.totalOpens} time{detail.totalOpens === 1 ? "" : "s"}</span>
      </summary>
      <ol className="mt-3 space-y-1.5 text-sm">
        {detail.accessLog.map((a) => (
          <li key={a.id} className="flex flex-wrap justify-between gap-x-3 text-ink-2">
            <span>
              <span className="font-medium text-ink">{a.admin}</span>
              {a.acknowledged ? <span className="text-ink-3"> · acknowledged the anonymity notice</span> : null}
            </span>
            <span className="text-ink-3">{when(a.at)}</span>
          </li>
        ))}
      </ol>
      {detail.totalOpens > detail.accessLog.length ? <p className="mt-2 text-xs text-ink-3">Showing the latest {detail.accessLog.length}.</p> : null}
    </details>
  );
}
