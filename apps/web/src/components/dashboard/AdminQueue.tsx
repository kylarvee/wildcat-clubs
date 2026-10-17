import Link from "next/link";
import { CheckCircle2, ChevronRight, Shield } from "lucide-react";
import { Panel } from "@/components/dashboard/Panel";
import type { AdminQueueRow } from "@/app/dashboard/data";

/** WSUSA staff: the shared admin queue, counted by kind, each linking to its tool. */
export function AdminQueue({ rows }: { rows: AdminQueueRow[] }) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <Panel
      id="dash-admin"
      title="WSUSA queue"
      icon={<Shield />}
      description={total ? `${total} open item${total === 1 ? "" : "s"} for the admin team.` : "The admin queue is clear."}
      link={{ href: "/admin", label: "Admin" }}
      bodyClassName={rows.length ? "p-0 sm:p-0" : undefined}
    >
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:px-5">
                <span className="min-w-0 flex-1 text-ink">{r.label}</span>
                <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-warning">{r.count}</span>
                <ChevronRight className="h-4 w-4 text-ink-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> No submissions, funding requests or invoices are waiting.
        </p>
      )}
    </Panel>
  );
}
