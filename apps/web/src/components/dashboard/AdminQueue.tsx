import Link from "next/link";
import { BarChart3, CheckCircle2, ChevronRight, Shield } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Panel } from "@/components/dashboard/Panel";
import type { QueueRow } from "@/lib/analytics/admin";

/**
 * WSUSA and office staff: their office's shared queue (lib/analytics/admin
 * queueFor, the same numbers as the admin Overview), counted by kind, each
 * linking to the tool that handles it. It's the admin's switchboard, so it
 * takes the left column (where students see their clubs).
 */
export function AdminQueue({ rows, name, umbrella }: { rows: QueueRow[]; name: string; umbrella: boolean }) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <Panel
      id="dash-admin"
      title={
        <>
          {name} queue
          {total ? <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning">{total} waiting</span> : null}
        </>
      }
      icon={<Shield />}
      description={umbrella ? "Shared by the admin team. Whoever opens one first handles it." : `Shared by the ${name} team, for your office's clubs. Whoever opens one first handles it.`}
      bodyClassName="p-0 sm:p-0"
    >
      {rows.length ? (
        <ul className="px-2 py-2">
          {rows.map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 text-sm hover:bg-muted/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand">
                <span className="min-w-0 flex-1 text-ink">{r.label}</span>
                <span className={cn("min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-bold tabular-nums", r.urgent ? "bg-danger-50 text-danger" : "bg-warning-50 text-warning")}>{r.count}</span>
                <ChevronRight className="h-4 w-4 text-ink-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-ink-2 sm:px-5">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> {umbrella ? "Nothing is waiting: no submissions, funding requests, invoices or reports." : "Nothing is waiting on your office right now."}
        </p>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-5">
        <ButtonLink href="/admin" variant="outline" size="sm">
          <Shield className="h-4 w-4" aria-hidden /> Admin tools
        </ButtonLink>
        <ButtonLink href="/admin/analytics" variant="ghost" size="sm">
          <BarChart3 className="h-4 w-4" aria-hidden /> Analytics
        </ButtonLink>
      </div>
    </Panel>
  );
}
