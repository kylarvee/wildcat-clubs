import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComplaintStatus } from "@prisma/client";
import { Inbox, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { complaintOverview, listComplaints, type ComplaintFilters } from "@/lib/domain/complaints";
import { Callout, EmptyState, PageHeader, Stat } from "@/components/ui/layout";
import { FilterPills, FilterSelect } from "@/components/admin/Filters";
import { COMPLAINT_CATEGORIES, COMPLAINT_STATUS_LABEL } from "@/components/admin/complaint-copy";
import { ComplaintBrowser } from "@/components/admin/complaints/ComplaintBrowser";

export const metadata: Metadata = { title: "Reports" };

const STATUSES: ComplaintStatus[] = ["NEW", "IN_REVIEW", "REFERRED", "RESOLVED", "CLOSED"];

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Reports from /report. The list never includes report content; opening one
 * goes through openComplaint (logged, and acknowledged for anonymous ones).
 */
export default async function AdminComplaintsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser("/admin/complaints");
  if (!can(user, "admin.complaints")) notFound();
  const sp = await searchParams;
  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || null;
  };

  const statusParam = str("status");
  const status: ComplaintFilters["status"] = statusParam === "all" ? "all" : STATUSES.includes(statusParam as ComplaintStatus) ? (statusParam as ComplaintStatus) : "open";
  const type = str("type") === "anonymous" ? "anonymous" : str("type") === "named" ? "named" : "all";
  const category = str("category");
  const openId = str("open");

  const [rows, overview, deepLink] = await Promise.all([
    listComplaints(user, { status, type, category }),
    complaintOverview(user),
    // Only whether it's anonymous — enough to show the notice before anything loads.
    openId ? db.complaint.findUnique({ where: { id: openId }, select: { id: true, isAnonymous: true } }) : null,
  ]);
  const c = overview.counts;
  const openCount = (c.NEW ?? 0) + (c.IN_REVIEW ?? 0) + (c.REFERRED ?? 0);
  const categoryOptions = [...new Set([...COMPLAINT_CATEGORIES.map((x) => x.value as string), ...overview.categories])].map((v) => ({ value: v, label: v }));
  const filtered = status !== "open" || type !== "all" || category;

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Concerns students and staff sent through Report a concern. Only administrators can see this page." />

      <Callout tone="warning" icon={<ShieldAlert />} title="Reports stay with administrators">
        Don&rsquo;t share report contents outside university administrators and the proper authorities under WSU policy. Anonymous reports ask you to acknowledge that every time you open one, and every opening is logged.
      </Callout>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="New" value={c.NEW ?? 0} hint="waiting for someone" />
        <Stat label="In review" value={c.IN_REVIEW ?? 0} />
        <Stat label="Referred" value={c.REFERRED ?? 0} hint="with another office" />
        <Stat label="Resolved or closed" value={(c.RESOLVED ?? 0) + (c.CLOSED ?? 0)} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <FilterPills
            label="Filter by status"
            param="status"
            value={status === "open" ? null : status}
            options={[
              { value: null, label: "Open", count: openCount },
              ...STATUSES.map((s) => ({ value: s, label: COMPLAINT_STATUS_LABEL[s] })),
              { value: "all", label: "All" },
            ]}
          />
          <FilterPills
            label="Filter by reporter"
            param="type"
            value={type === "all" ? null : type}
            options={[
              { value: null, label: "Anonymous and named" },
              { value: "anonymous", label: "Anonymous" },
              { value: "named", label: "Named" },
            ]}
          />
        </div>
        <FilterSelect label="Category" param="category" value={category} options={categoryOptions} allLabel="All categories" className="w-full sm:w-64" />
      </div>

      <ComplaintBrowser
        rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }))}
        initialOpen={deepLink ? { id: deepLink.id, isAnonymous: deepLink.isAnonymous } : null}
        empty={
          <EmptyState
            icon={<Inbox />}
            title={filtered ? "No reports match these filters" : "No open reports"}
            description={filtered ? "Try another status, category or reporter type." : "New reports show up here, and in your tasks, as soon as they're sent."}
          />
        }
      />
    </div>
  );
}
