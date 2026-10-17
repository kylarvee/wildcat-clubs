import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { FundingSource } from "@prisma/client";
import { FileCheck2, Inbox, SearchX } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { getConfig } from "@/lib/config";
import { DAY_MS, fmtMoney } from "@/lib/time";
import { adminFundingCounts, adminFundingOverview, adminFundingQueue, clubsWithRequests, type AdminQueue } from "@/lib/domain/funding";
import { SOURCE_ORDER, plural } from "@/lib/funding/labels";
import { FUNDING_LABEL } from "@/lib/events/labels";
import { cn } from "@/components/ui/cn";
import { EmptyState, PageHeader, Stat } from "@/components/ui/layout";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { TileMoney } from "@/components/budget/BudgetSummary";
import { AdminRequestList } from "@/components/budget/admin/AdminRequestList";
import { FundingFilters } from "@/components/budget/admin/FundingFilters";

export const metadata: Metadata = { title: "Funding" };

const QUEUES: { key: AdminQueue; label: string; hint: string }[] = [
  { key: "submitted", label: "Waiting for a decision", hint: "Oldest first." },
  { key: "approved", label: "Approved · invoice open", hint: "Approved requests until their invoice is created and processed, oldest decision first." },
  { key: "all", label: "All requests", hint: "Everything clubs have submitted, newest first. Drafts stay private to the club." },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * WSUSA's funding desk: decide submitted requests, then create and process
 * each approved request's invoice. Requires admin.funding.
 */
export default async function AdminFundingPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser("/admin/funding");
  if (!can(user, "admin.funding")) notFound();
  const sp = await searchParams;
  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || null;
  };
  const queue: AdminQueue = QUEUES.some((q) => q.key === str("queue")) ? (str("queue") as AdminQueue) : "submitted";
  const source = SOURCE_ORDER.includes(str("source") as FundingSource) ? (str("source") as FundingSource) : null;

  const [clubs, counts, overview, cfg] = await Promise.all([clubsWithRequests(), adminFundingCounts(), adminFundingOverview(user), getConfig()]);
  const clubId = clubs.some((c) => c.id === str("club")) ? str("club") : null;
  const { rows, total } = await adminFundingQueue(user, { queue, source, clubId });

  const reviewDays = cfg["wsusa.office"].reviewDays;
  const tabHref = (q: AdminQueue) => {
    const qs = new URLSearchParams();
    if (q !== "submitted") qs.set("queue", q);
    if (source) qs.set("source", source);
    if (clubId) qs.set("club", clubId);
    const s = qs.toString();
    return s ? `/admin/funding?${s}` : "/admin/funding";
  };
  const tabCount: Partial<Record<AdminQueue, number>> = { submitted: counts.submitted, approved: counts.approved };
  const active = QUEUES.find((q) => q.key === queue)!;
  const filtered = Boolean(source || clubId);
  const oldestDays = overview.waiting.oldestSubmittedAt ? Math.floor((Date.now() - overview.waiting.oldestSubmittedAt.getTime()) / DAY_MS) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funding"
        description="Clubs' funding requests come here for a decision. Approved requests get an invoice, and each invoice stays on your list until the money goes through in the university finance system."
        className="mb-0"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Waiting for a decision"
          value={overview.waiting.count}
          hint={overview.waiting.count ? `${fmtMoney(overview.waiting.cents)} requested${oldestDays ? ` · oldest ${plural(oldestDays, "day")}` : ""}` : "Nothing waiting"}
        />
        <Stat label="Need an invoice" value={overview.needsInvoice} hint={overview.needsInvoice ? "Approved, no invoice yet" : "Every approval is invoiced"} />
        <Stat label="Invoices open" value={overview.openInvoices.count} hint={overview.openInvoices.count ? `${fmtMoney(overview.openInvoices.cents)} to process` : "All processed"} />
        <Stat
          label={overview.approvedThisTerm ? `Approved · ${overview.approvedThisTerm.termName}` : "Approved this semester"}
          value={<TileMoney cents={overview.approvedThisTerm?.cents ?? 0} />}
          hint={overview.approvedThisTerm ? plural(overview.approvedThisTerm.count, "request") : "No semester on the calendar"}
        />
      </div>

      <div className="space-y-4">
        <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Funding queues">
          {QUEUES.map((q) => (
            <Link
              key={q.key}
              href={tabHref(q.key)}
              aria-current={queue === q.key ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
                queue === q.key ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              {q.label}
              {tabCount[q.key] ? <span className="rounded-full bg-brand-50 px-1.5 text-xs text-brand">{tabCount[q.key]}</span> : null}
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <FundingFilters
            basePath="/admin/funding"
            queue={queue === "submitted" ? null : queue}
            sources={SOURCE_ORDER.map((s) => ({ value: s, label: FUNDING_LABEL[s] }))}
            clubs={clubs}
            source={source}
            clubId={clubId}
          />
          <p className="text-sm text-ink-3" aria-live="polite">
            {total > rows.length ? `Showing the first ${rows.length} of ${total}` : plural(total, "request")} · {active.hint}
          </p>
        </div>

        {rows.length ? (
          <AdminRequestList rows={rows} reviewDays={reviewDays} />
        ) : filtered ? (
          <EmptyState icon={<SearchX />} title="No requests match these filters" description="Try another funding source or club, or clear the filters." />
        ) : queue === "submitted" ? (
          <EmptyState icon={<Inbox />} title="No requests waiting" description="When a club submits a funding request it shows up here, oldest first, and in your task inbox." />
        ) : queue === "approved" ? (
          <EmptyState icon={<FileCheck2 />} title="Every approval is invoiced and processed" description="Approved requests show up here until their invoice is created and marked processed." />
        ) : (
          <EmptyState icon={<Inbox />} title="No funding requests yet" description="Requests clubs submit from their Budget tool will be listed here." />
        )}
      </div>

      <PolicyNotices placement="FUNDING" />
    </div>
  );
}
