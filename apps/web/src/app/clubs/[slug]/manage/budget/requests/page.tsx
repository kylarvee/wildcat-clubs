import type { Metadata } from "next";
import { FileText, Wallet } from "lucide-react";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { listClubRequests } from "@/lib/domain/funding";
import { plural, sourceNames } from "@/lib/funding/labels";
import { requestTotals } from "@/lib/funding/math";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Stat } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { RequestList } from "@/components/budget/RequestList";
import { TileMoney } from "@/components/budget/BudgetSummary";

export const metadata: Metadata = { title: "Funding requests" };

/** Every funding request the club has made, across semesters, newest first. */
export default async function ClubRequestsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club, access, allowed } = await loadClubWorkspace(slug, "budget");
  if (club.status !== "APPROVED" || !allowed) return <NoPermission what="funding requests" suspended={access.suspended} />;
  const base = `/clubs/${club.slug}/manage/budget`;
  const requests = await listClubRequests(club.id);
  const totals = requestTotals(requests);
  const names = sourceNames(club);

  // Group by semester, newest semester first.
  const byTerm = new Map<string, { name: string; startsOn: Date; rows: typeof requests }>();
  for (const r of requests) {
    const g = byTerm.get(r.termId) ?? { name: r.term.name, startsOn: r.term.startsOn, rows: [] };
    g.rows.push(r);
    byTerm.set(r.termId, g);
  }
  const groups = [...byTerm.entries()].sort((a, b) => b[1].startsOn.getTime() - a[1].startsOn.getTime());

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ href: base, label: "Budget & funding" }, { label: "Requests" }]}
        title="Funding requests"
        description={`Everything ${club.name} has asked for, by semester.`}
        actions={
          <ButtonLink href={`${base}/requests/new`}>
            <Wallet className="h-4 w-4" aria-hidden /> New request
          </ButtonLink>
        }
        className="mb-0"
      />
      {requests.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Requested, all time" value={<TileMoney cents={totals.requested} />} hint={plural(requests.filter((r) => r.status !== "DRAFT" && r.status !== "WITHDRAWN").length, "request") + " sent"} />
            <Stat label="Approved, all time" value={<TileMoney cents={totals.approved} />} hint={totals.requested ? `${Math.round((totals.approved / totals.requested) * 100)}% of what was asked` : "Nothing decided yet"} />
            <Stat label="In review" value={<TileMoney cents={totals.pending} />} hint={`${requests.filter((r) => r.status === "SUBMITTED").length} waiting for a decision`} className="col-span-2 sm:col-span-1" />
          </div>
          {groups.map(([termId, g]) => (
            <section key={termId} className="space-y-2" aria-labelledby={`term-${termId}`}>
              <h2 id={`term-${termId}`} className="text-base font-semibold text-ink">
                {g.name}
              </h2>
              <RequestList requests={g.rows} base={base} sourceNames={names} />
            </section>
          ))}
        </>
      ) : (
        <EmptyState
          icon={<FileText />}
          title="No funding requests yet"
          description="When the club needs money for events or supplies, build a request from its budget and send it to WSUSA."
          action={
            <ButtonLink href={base} size="sm">
              Go to the budget
            </ButtonLink>
          }
        />
      )}
    </div>
  );
}
