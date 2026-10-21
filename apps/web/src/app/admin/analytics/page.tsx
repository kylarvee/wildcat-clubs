import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { adminClubWhere, adminScope, can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { clubAnalyticsRows } from "@/lib/analytics/clubs";
import { parseTableFilters } from "@/lib/analytics/club-table";
import { PageHeader } from "@/components/ui/layout";
import { ClubAnalyticsTable } from "@/components/analytics/ClubAnalyticsTable";
import { SearchInsightsCard } from "@/components/analytics/SearchInsightsCard";

export const metadata: Metadata = { title: "Club analytics" };

/**
 * Every club side by side: membership, activity, retention, attendance,
 * ratings and cross-club connections — all from lib/metrics. An office's
 * staff see only their office's clubs (lib/authz adminClubWhere). Filtering
 * and sorting happen in the browser (and in the URL); the CSV export applies
 * the same filters on the server. Below, for WSUSA: what students search for
 * on the clubs list, and what they search for and don't find (lib/search/log).
 */
export default async function ClubAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser("/admin/analytics");
  if (!can(user, "admin.analytics")) notFound();
  const filters = parseTableFilters(await searchParams);
  const umbrella = adminScope(user).all;
  const [{ rows, termName }, colleges, cfg] = await Promise.all([
    clubAnalyticsRows(new Date(), adminClubWhere(user)),
    db.college.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, shortName: true } }),
    getConfig(),
  ]);

  return (
    <div>
      <PageHeader
        title="Club analytics"
        description={`${umbrella ? "Every club's" : "Your office's clubs'"} numbers side by side. A club counts as active with ${cfg["activity.clubMinEvents"]} events with check-ins in a term and ${cfg["activity.clubMinMembers"]} registered members. Select a club for its full picture.`}
      />
      <ClubAnalyticsTable
        rows={rows}
        colleges={colleges}
        termName={termName}
        initial={filters}
        activeDays={cfg["activity.studentWindowDays"]}
        activeEvents={cfg["activity.studentRecentEvents"]}
      />
      {/* What students search for is platform-wide, so it's WSUSA's. */}
      {umbrella ? (
        <div className="mt-8">
          <SearchInsightsCard />
        </div>
      ) : null}
    </div>
  );
}
