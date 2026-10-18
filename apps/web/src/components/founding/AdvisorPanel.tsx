"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, RotateCw, Send, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useFormSubmit } from "@/components/founding/useFormSubmit";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { cancelAdvisorInviteAction, inviteAdvisorAction, resendAdvisorInviteAction } from "@/components/founding/actions";

export type AdvisorRow = { id: string; name: string; email: string; avatarUrl: string | null; avatarColor: string };
export type PendingInviteRow = { id: string; name: string; email: string; sentLabel: string; hasAccount: boolean };

/** Current advisors, pending invitations (resend / cancel) and the invite form. */
export function AdvisorPanel({
  clubId,
  canInvite,
  advisors,
  invites,
  staffDomain,
  noInviteNote,
}: {
  clubId: string;
  canInvite: boolean;
  advisors: AdvisorRow[];
  invites: PendingInviteRow[];
  staffDomain: string;
  /** Shown instead of the invite form when nobody here can invite (e.g. WSUSA appoints an ambassador program's advisor). */
  noInviteNote?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(advisors.length === 0 && invites.length === 0);
  const [busy, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const inviteForm = useFormSubmit(async (fd, form) => {
    setError(null);
    const r = await inviteAdvisorAction({ clubId, name: String(fd.get("name") ?? ""), email: String(fd.get("email") ?? "") });
    if (!r.ok) return setError(r.error);
    toast.success(`Invitation sent to ${r.data.email}`);
    form.reset();
    setShowForm(false);
    router.refresh();
  });

  function rowAction(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusyId(id);
    start(async () => {
      const r = await fn();
      setBusyId(null);
      if (!r.ok) toast.error((r as { error: string }).error);
      else {
        toast.success(success);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {advisors.length ? (
        <ul className="space-y-2" aria-label="Advisors">
          {advisors.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              <Avatar name={a.name} src={a.avatarUrl} color={a.avatarColor} size="sm" />
              <span className="min-w-0 text-sm">
                <span className="block font-medium text-ink">{a.name}</span>
                <span className="block truncate text-ink-3">{a.email}</span>
              </span>
              <Badge tone="success" className="ml-auto">
                Advisor
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {invites.length ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Waiting for a reply</p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-ink-3">
                  <Mail className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium text-ink">{i.name}</span>
                  <span className="block truncate text-ink-3">
                    {i.email} · sent {i.sentLabel}
                  </span>
                </span>
                <Badge tone={i.hasAccount ? "info" : "neutral"}>{i.hasAccount ? "In their Tasks" : "Email only"}</Badge>
                {canInvite ? (
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy && busyId === i.id}
                      onClick={() => rowAction(i.id, () => resendAdvisorInviteAction(i.id), `Sent again to ${i.email}`)}
                    >
                      <RotateCw className="h-3.5 w-3.5" aria-hidden /> Resend
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="ghost" disabled={busy && busyId === i.id} aria-label={`Cancel invitation to ${i.name}`}>
                          <X className="h-3.5 w-3.5" aria-hidden /> Cancel
                        </Button>
                      }
                      title={`Cancel the invitation to ${i.name}?`}
                      description="Their link stops working. You can invite them again later."
                      confirmLabel="Cancel invitation"
                      cancelLabel="Keep it"
                      danger
                      onConfirm={() => rowAction(i.id, () => cancelAdvisorInviteAction(i.id), "Invitation cancelled")}
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!canInvite ? (
        noInviteNote ? (
          <p className="text-sm text-ink-3">{noInviteNote}</p>
        ) : advisors.length === 0 ? (
          <p className="text-sm text-ink-3">Your President, Vice President or advisor can invite an advisor.</p>
        ) : null
      ) : showForm ? (
        <form onSubmit={inviteForm.onSubmit} className="space-y-3 rounded-xl border border-line bg-muted/30 p-4" noValidate aria-busy={inviteForm.pending}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Advisor's name" required>
              {(id) => <Input id={id} name="name" autoComplete="off" maxLength={100} placeholder="Dr. Jordan Lee" required />}
            </Field>
            <Field label="Weber State email" required hint={`Faculty or staff — must end in @${staffDomain}`}>
              {(id) => <Input id={id} name="email" type="email" inputMode="email" autoComplete="off" placeholder={`jordanlee@${staffDomain}`} required />}
            </Field>
          </div>
          <p className="text-xs text-ink-3">They get an email explaining what advising means, plus a request in their Wildcat Clubs Tasks if they already have an account.</p>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={inviteForm.pending}>
              {inviteForm.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              {inviteForm.pending ? "Sending…" : "Send invitation"}
            </Button>
            {advisors.length || invites.length ? (
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                Not now
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          <UserPlus className="h-4 w-4" aria-hidden /> {advisors.length ? "Invite another advisor" : "Invite an advisor"}
        </Button>
      )}
    </div>
  );
}
