"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { CohostStatus } from "@prisma/client";
import { Check, Handshake, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { fmtDate, fmtRange } from "@/lib/time";
import { decideCohostAction } from "@/app/events/actions";

export type IncomingCohost = {
  id: string;
  status: CohostStatus;
  eventId: string;
  eventTitle: string;
  hostClubName: string;
  hostClubColor: string;
  next: { startsAt: string; endsAt: string; allDay: boolean } | null;
  scheduleLabel: string;
  requestedByName: string;
};

export type OutgoingCohost = {
  eventId: string;
  eventTitle: string;
  nextStartsAt: string | null;
  all: boolean;
  cohosts: { id: string; clubName: string; status: CohostStatus }[];
};

const COHOST_TONE: Record<CohostStatus, "warning" | "success" | "danger"> = { PENDING: "warning", APPROVED: "success", DECLINED: "danger" };
const COHOST_LABEL: Record<CohostStatus, string> = { PENDING: "Waiting", APPROVED: "Accepted", DECLINED: "Declined" };

// ─── Co-host requests ────────────────────────────────────────────────────────

export function CohostPanel({ incoming, outgoing, basePath }: { incoming: IncomingCohost[]; outgoing: OutgoingCohost[]; basePath: string }) {
  const pending = incoming.filter((c) => c.status === "PENDING");
  const accepted = incoming.filter((c) => c.status === "APPROVED");
  return (
    <div className="space-y-5">
      <section aria-labelledby="cohost-in">
        <h3 id="cohost-in" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
          Waiting on you {pending.length ? `(${pending.length})` : ""}
        </h3>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-2 px-3 py-4 text-center text-sm text-ink-3">No requests right now. When another club tags yours, it shows up here.</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((c) => (
              <IncomingCard key={c.id} c={c} />
            ))}
          </ul>
        )}
      </section>

      {accepted.length ? (
        <section aria-labelledby="cohost-yes">
          <h3 id="cohost-yes" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
            You&apos;re co-hosting
          </h3>
          <ul className="space-y-2">
            {accepted.map((c) => (
              <IncomingCard key={c.id} c={c} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="cohost-out">
        <h3 id="cohost-out" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
          Your invitations
        </h3>
        {outgoing.length === 0 ? (
          <p className="text-sm text-ink-3">Tag other clubs in an event&apos;s Co-hosts section to plan it together.</p>
        ) : (
          <ul className="space-y-2">
            {outgoing.map((o) => {
              const n = (s: CohostStatus) => o.cohosts.filter((c) => c.status === s).length;
              return (
                <li key={o.eventId} className="rounded-xl border border-line bg-surface p-3">
                  <Link href={`${basePath}/${o.eventId}#cohosts`} className="font-medium text-ink hover:underline">
                    {o.eventTitle}
                  </Link>
                  {o.nextStartsAt ? <p className="text-xs text-ink-3">Next: {fmtDate(o.nextStartsAt, "EEE, MMM d · h:mm a")}</p> : null}
                  {o.all ? (
                    <p className="mt-1.5 text-xs text-ink-2">
                      All clubs invited · {n("APPROVED")} accepted · {n("PENDING")} waiting · {n("DECLINED")} declined
                    </p>
                  ) : (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {o.cohosts.map((c) => (
                        <li key={c.id}>
                          <Badge tone={COHOST_TONE[c.status]}>
                            {c.clubName} · {COHOST_LABEL[c.status]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function IncomingCard({ c }: { c: IncomingCohost }) {
  const [pending, start] = useTransition();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const decide = (approve: boolean) =>
    start(async () => {
      const res = await decideCohostAction(c.id, approve);
      if (!res.ok) return void toast.error(res.error);
      toast.success(approve ? `“${c.eventTitle}” is on your calendar` : c.status === "APPROVED" ? "Removed from your calendar" : "Request declined");
    });
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.hostClubColor }} aria-hidden />
        <div className="min-w-0 flex-1">
          <Link href={`/events/${c.eventId}`} className="font-medium leading-snug text-ink hover:underline">
            {c.eventTitle}
          </Link>
          <p className="text-xs text-ink-3">Hosted by {c.hostClubName}</p>
          <p className="mt-1 text-xs text-ink-2">{c.next ? fmtRange(c.next.startsAt, c.next.endsAt, c.next.allDay) : "No upcoming meetings"}</p>
          {c.scheduleLabel ? <p className="text-xs text-ink-3">{c.scheduleLabel}</p> : null}
        </div>
      </div>
      {c.status === "PENDING" ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => decide(true)} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide(false)} disabled={pending}>
            <X className="h-4 w-4" /> Decline
          </Button>
        </div>
      ) : (
        <>
          <Button size="sm" variant="ghost" className="mt-1 text-ink-3" onClick={() => setConfirmLeave(true)} disabled={pending}>
            <Handshake className="h-4 w-4" /> Stop co-hosting
          </Button>
          <ConfirmDialog
            open={confirmLeave}
            onOpenChange={setConfirmLeave}
            title="Stop co-hosting?"
            description={`“${c.eventTitle}” comes off your club's calendar, and ${c.hostClubName} is told.`}
            confirmLabel="Stop co-hosting"
            danger
            onConfirm={() => decide(false)}
          />
        </>
      )}
    </li>
  );
}
