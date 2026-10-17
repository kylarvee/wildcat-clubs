"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { EyeOff, Loader2, Lock, UserRound } from "lucide-react";
import type { ComplaintStatus } from "@prisma/client";
import type { ComplaintDetail } from "@/lib/domain/complaints";
import { fmtLongDate } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { ANONYMITY_NOTICE, COMPLAINT_STATUS_LABEL, COMPLAINT_STATUS_TONE } from "@/components/admin/complaint-copy";
import { ComplaintDetailDialog } from "@/components/admin/complaints/ComplaintDetailDialog";
import { openComplaintAction } from "@/app/admin/complaints/actions";

export type ComplaintRow = {
  id: string;
  caseCode: string;
  isAnonymous: boolean;
  category: string;
  status: ComplaintStatus;
  createdAt: string;
  updatedAt: string;
  opens: number;
  notes: number;
};

/**
 * The reports list. Rows carry no report content; "Open" fetches it through
 * a server action that logs the opening. Anonymous reports ask the admin to
 * acknowledge the anonymity notice first — every single time.
 */
export function ComplaintBrowser({ rows, initialOpen, empty }: { rows: ComplaintRow[]; initialOpen: { id: string; isAnonymous: boolean } | null; empty: ReactNode }) {
  const [ackFor, setAckFor] = useState<{ id: string; caseCode: string | null } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ComplaintDetail | null>(null);
  const handledDeepLink = useRef(false);

  const load = useCallback(async (id: string, acknowledged: boolean) => {
    setLoadingId(id);
    try {
      const r = await openComplaintAction(id, acknowledged);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setDetail(r.data);
    } catch {
      toast.error("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoadingId(null);
    }
  }, []);

  const requestOpen = useCallback(
    (row: { id: string; isAnonymous: boolean; caseCode: string | null }) => {
      if (row.isAnonymous) setAckFor({ id: row.id, caseCode: row.caseCode });
      else void load(row.id, false);
    },
    [load],
  );

  // Task links arrive as ?open=<id>: start the same flow once, then drop the parameter.
  useEffect(() => {
    if (!initialOpen || handledDeepLink.current) return;
    handledDeepLink.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    window.history.replaceState(window.history.state, "", url.pathname + (url.search ? url.search : ""));
    const row = rows.find((r) => r.id === initialOpen.id);
    requestOpen({ id: initialOpen.id, isAnonymous: initialOpen.isAnonymous, caseCode: row?.caseCode ?? null });
  }, [initialOpen, rows, requestOpen]);

  return (
    <>
      {rows.length === 0 ? empty : null}
      <div className={rows.length === 0 ? "hidden" : "overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]"}>
        <div className="hidden grid-cols-[9rem_minmax(0,1fr)_7rem_7rem_8rem_6.5rem] gap-4 border-b border-line bg-muted/60 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-3 md:grid" aria-hidden>
          <span>Case</span>
          <span>Category</span>
          <span>Status</span>
          <span>Received</span>
          <span>Activity</span>
          <span className="sr-only">Open</span>
        </div>
        <ul className="divide-y divide-line" aria-label="Reports">
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 md:grid-cols-[9rem_minmax(0,1fr)_7rem_7rem_8rem_6.5rem]">
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold tracking-wider text-ink">{r.caseCode}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-3">
                  {r.isAnonymous ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <UserRound className="h-3.5 w-3.5" aria-hidden />}
                  {r.isAnonymous ? "Anonymous" : "Named"}
                </p>
              </div>
              <div className="order-last col-span-2 flex min-w-0 flex-wrap items-center gap-2 md:order-none md:col-span-1">
                <span className="text-sm text-ink">{r.category}</span>
                {r.isAnonymous ? (
                  <Badge tone="warning">
                    <Lock className="h-3 w-3" aria-hidden /> Anonymous
                  </Badge>
                ) : null}
                <span className="md:hidden">
                  <Badge tone={COMPLAINT_STATUS_TONE[r.status]}>{COMPLAINT_STATUS_LABEL[r.status]}</Badge>
                </span>
                <span className="text-xs text-ink-3 md:hidden">Received {fmtLongDate(r.createdAt)}</span>
              </div>
              <div className="hidden md:block">
                <Badge tone={COMPLAINT_STATUS_TONE[r.status]}>{COMPLAINT_STATUS_LABEL[r.status]}</Badge>
              </div>
              <div className="hidden text-sm text-ink-2 md:block">{fmtLongDate(r.createdAt)}</div>
              <div className="hidden text-xs text-ink-3 md:block">
                {r.opens ? `Opened ${r.opens}×` : "Not opened yet"}
                {r.notes ? <span className="block">{r.notes} note{r.notes === 1 ? "" : "s"}</span> : null}
              </div>
              <div className="row-start-1 justify-self-end md:row-auto">
                <Button
                  size="sm"
                  variant={r.status === "NEW" ? "primary" : "outline"}
                  onClick={() => requestOpen(r)}
                  disabled={loadingId !== null}
                  aria-label={`Open report ${r.caseCode}${r.isAnonymous ? " (anonymous)" : ""}`}
                >
                  {loadingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Open
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <ConfirmDialog
        open={ackFor !== null}
        onOpenChange={(o) => {
          if (!o) setAckFor(null);
        }}
        title={ackFor?.caseCode ? `Anonymous report ${ackFor.caseCode}` : "Anonymous report"}
        description={ANONYMITY_NOTICE}
        confirmLabel="I understand — open it"
        onConfirm={() => {
          const id = ackFor?.id;
          setAckFor(null);
          if (id) void load(id, true);
        }}
      >
        <p className="mt-3 text-sm text-ink-3">You&rsquo;ll be asked again each time you open it, and this opening is logged with your name.</p>
      </ConfirmDialog>

      <ComplaintDetailDialog
        detail={detail}
        onClose={() => setDetail(null)}
        onChange={(patch) => setDetail((d) => (d ? { ...d, ...patch(d) } : d))}
      />
    </>
  );
}
