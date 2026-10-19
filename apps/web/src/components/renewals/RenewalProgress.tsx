import Link from "next/link";
import type { Actor } from "@/lib/auth/session";
import { renewalCounts } from "@/lib/domain/renewals";
import { ProgressBar } from "@/components/ui/layout";

const fmt = (n: number) => n.toLocaleString("en-US");

/** The admin Overview's renewal count: how many clubs re-registered this academic year, linking to the Renewals tab. */
export async function RenewalProgress({ actor }: { actor: Actor }) {
  const { window, counts } = await renewalCounts(actor);
  if (!window || !counts.expected) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Re-registered for {window.year}</h3>
      <Link href="/admin/clubs?tab=renewals" className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
          <span className="text-ink-2">
            <span className="text-lg font-semibold tabular-nums text-ink">{fmt(counts.renewed)}</span> of {fmt(counts.expected)} clubs
          </span>
          <span className="text-xs text-ink-3 group-hover:text-brand-600">
            {!counts.notRenewed
              ? "Every club renewed"
              : counts.overdue === counts.notRenewed
                ? `${fmt(counts.overdue)} overdue`
                : `${fmt(counts.notRenewed)} not yet${counts.overdue ? `, ${fmt(counts.overdue)} overdue` : ""}`}
          </span>
        </span>
        <ProgressBar value={counts.renewed} max={counts.expected} className="mt-2" />
      </Link>
    </div>
  );
}
