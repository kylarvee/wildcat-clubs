"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/misc";
import { decideRequest } from "../actions";
import type { PendingRow } from "./types";

/** Join requests waiting on the club's approval gate. Deciding here closes the matching task everywhere. */
export function PendingRequests({ slug, rows }: { slug: string; rows: PendingRow[] }) {
  const [busy, setBusy] = useState<Record<string, "approve" | "decline">>({});

  async function decide(row: PendingRow, approve: boolean) {
    setBusy((b) => ({ ...b, [row.membershipId]: approve ? "approve" : "decline" }));
    const r = await decideRequest(slug, row.membershipId, approve).catch(() => ({ ok: false as const, error: "We couldn't reach the server. Try again." }));
    setBusy((b) => {
      const next = { ...b };
      delete next[row.membershipId];
      return next;
    });
    if (r.ok) toast.success(approve ? `${row.name} is now a member.` : `Declined ${row.name}'s request.`);
    else toast.error(r.error);
  }

  return (
    <Card className="border-brand-100">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Join requests <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">{rows.length}</span>
          </span>
        }
        description="These students asked to join. Approving adds them to the roster and the club calendar."
      />
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const state = busy[row.membershipId];
          return (
            <li key={row.membershipId} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Avatar name={row.name} src={row.avatarUrl} color={row.avatarColor} size="sm" />
              <div className="min-w-0 flex-1">
                <Link href={`/u/${row.handle}`} className="block truncate text-sm font-medium text-ink hover:underline">
                  {row.name}
                </Link>
                <p className="truncate text-xs text-ink-3">
                  {row.email} · asked {row.requestedLabel}
                  {row.attended ? ` · attended ${row.attended} event${row.attended === 1 ? "" : "s"}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => decide(row, false)} disabled={Boolean(state)} aria-label={`Decline ${row.name}`}>
                  {state === "decline" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                  Decline
                </Button>
                <Button size="sm" onClick={() => decide(row, true)} disabled={Boolean(state)} aria-label={`Approve ${row.name}`}>
                  {state === "approve" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                  Approve
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
