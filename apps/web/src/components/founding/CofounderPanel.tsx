"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Armchair, Loader2, Mail, RotateCw, Send, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { useFormSubmit } from "@/components/founding/useFormSubmit";
import { cancelCofounderInviteAction, inviteCofounderAction, resendCofounderInviteAction } from "@/components/founding/actions";

export type TeamMemberRow = { userId: string; name: string; avatarUrl: string | null; avatarColor: string; startedIt: boolean; seats: string[] };
export type CofounderInviteRow = { id: string; name: string; email: string; sentLabel: string; hasAccount: boolean };

/**
 * The founding team on the founders' Overview: who's in (and whether they
 * have a seat yet), invitations waiting (resend, cancel), and the invite form
 * for founders. lib/domain/cofounders enforces every rule.
 */
export function CofounderPanel({
  clubId,
  slug,
  canInvite,
  members,
  invites,
  cap,
  studentDomain,
}: {
  clubId: string;
  slug: string;
  canInvite: boolean;
  members: TeamMemberRow[];
  invites: CofounderInviteRow[];
  cap: number;
  studentDomain: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const full = invites.length >= cap;
  const orgChart = `/clubs/${slug}/manage/org-chart`;

  const inviteForm = useFormSubmit(async (fd, form) => {
    setError(null);
    const r = await inviteCofounderAction({ clubId, name: String(fd.get("name") ?? ""), email: String(fd.get("email") ?? "") });
    if (!r.ok) return setError(r.error);
    toast.success(r.data.hasAccount ? "Invitation sent to their Tasks" : `Invitation emailed to ${r.data.email}`);
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
      <ul className="space-y-2" aria-label="Founding team">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Avatar name={m.name} src={m.avatarUrl} color={m.avatarColor} size="sm" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="block font-medium text-ink">{m.name}</span>
              <span className="block text-ink-3">{m.startedIt ? "Started the club" : "Co-founder"}</span>
            </span>
            {m.seats.length ? (
              m.seats.map((s) => (
                <Badge key={s} tone="brand">
                  {s}
                </Badge>
              ))
            ) : canInvite ? (
              <Link href={orgChart} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
                <Armchair className="h-3.5 w-3.5" aria-hidden /> Give them a seat
              </Link>
            ) : (
              <Badge>No seat yet</Badge>
            )}
          </li>
        ))}
      </ul>

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
                    <Button size="sm" variant="ghost" disabled={busy && busyId === i.id} onClick={() => rowAction(i.id, () => resendCofounderInviteAction(i.id), `Sent again to ${i.name}`)}>
                      <RotateCw className="h-3.5 w-3.5" aria-hidden /> Resend
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="ghost" disabled={busy && busyId === i.id} aria-label={`Cancel the invitation to ${i.name}`}>
                          <X className="h-3.5 w-3.5" aria-hidden /> Cancel
                        </Button>
                      }
                      title={`Cancel the invitation to ${i.name}?`}
                      description="Their link stops working. You can invite them again later."
                      confirmLabel="Cancel invitation"
                      cancelLabel="Keep it"
                      danger
                      onConfirm={() => rowAction(i.id, () => cancelCofounderInviteAction(i.id), "Invitation cancelled")}
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!canInvite ? (
        <p className="text-sm text-ink-3">The club&apos;s founders invite co-founders: its President, or whoever started it.</p>
      ) : showForm ? (
        <form onSubmit={inviteForm.onSubmit} className="space-y-3 rounded-xl border border-line bg-muted/30 p-4" noValidate aria-busy={inviteForm.pending}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Their name" required>
              {(id) => <Input id={id} name="name" autoComplete="off" maxLength={100} placeholder="Jordan Lee" required />}
            </Field>
            <Field label="Weber State email" required hint={`A student's, ending in @${studentDomain}`}>
              {(id) => <Input id={id} name="email" type="email" inputMode="email" autoComplete="off" placeholder={`jordanlee@${studentDomain}`} required />}
            </Field>
          </div>
          <p className="text-xs text-ink-3">If they have a Wildcat Clubs account, it lands in their Tasks; if not, they get an email with a link. Once they accept, give them a seat on your org chart.</p>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={inviteForm.pending}>
              {inviteForm.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              {inviteForm.pending ? "Sending…" : "Send invitation"}
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Not now
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)} disabled={full}>
            <UserPlus className="h-4 w-4" aria-hidden /> Invite a co-founder
          </Button>
          {full ? <p className="text-sm text-ink-3">{cap} invitations are waiting, the most at once. Cancel one or wait for answers.</p> : null}
        </div>
      )}
    </div>
  );
}
