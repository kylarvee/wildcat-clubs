import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { fundingOfficeForClub } from "@/lib/offices";
import { getCurrentUser } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { loadClubTermBudget, loadFundingRequest } from "@/lib/domain/funding";
import { defaultFundingSource } from "@/lib/funding/defaults";
import { plural, sourceName, sourceNames } from "@/lib/funding/labels";
import { MIN_JUSTIFICATION } from "@/lib/funding/math";
import { requestTimeline } from "@/lib/funding/timeline";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, PageHeader } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { FundingStatusBadge } from "@/components/budget/StatusBadge";
import { RequestBuilder } from "@/components/budget/RequestBuilder";
import { RequestTimeline } from "@/components/budget/RequestTimeline";
import { RequestItemsTable } from "@/components/budget/RequestItemsTable";
import { DecisionCallout, RequestFactsCard } from "@/components/budget/RequestDetail";
import { InvoicePanel } from "@/components/budget/InvoicePanel";
import { WithdrawRequest } from "@/components/budget/WithdrawRequest";
import { builderLines } from "@/components/budget/builder-data";

type Params = Promise<{ slug: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  // Only people who can open the request see its title in the tab.
  const { id } = await params;
  const [user, request] = await Promise.all([getCurrentUser(), loadFundingRequest(id)]);
  const access = user && request ? await getClubAccess(user, request.clubId) : null;
  return { title: request && access?.capabilities.has("budget") ? request.title : "Funding request" };
}

/**
 * One funding request: drafts open in the builder; submitted ones show the
 * snapshot, the decision line by line (with the source that funded it) and
 * the invoice. A partly approved request offers to ask another source for
 * the lines that got less.
 */
export default async function FundingRequestPage({ params }: { params: Params }) {
  const { slug, id } = await params;
  const { club, access, allowed } = await loadClubWorkspace(slug, "budget");
  if (club.status !== "APPROVED" || !allowed) return <NoPermission what="funding requests" suspended={access.suspended} />;
  const request = await loadFundingRequest(id);
  if (!request || request.clubId !== club.id) notFound();

  // The office that decides this club's funding (lib/offices): its own when that office decides funding, else WSUSA.
  const office = await fundingOfficeForClub(club.id);
  const base = `/clubs/${club.slug}/manage/budget`;
  const names = sourceNames(club);
  const crumbs = [
    { href: `${base}?term=${request.termId}`, label: "Budget & funding" },
    { href: `${base}/requests`, label: "Requests" },
    { label: request.status === "DRAFT" ? "Draft" : request.title },
  ];

  if (request.status === "DRAFT") {
    const budget = await loadClubTermBudget(club.id, request.termId);
    const lines = builderLines(budget);
    const live = new Set(lines.map((l) => l.id));
    const stale = request.items.filter((i) => !i.budgetItemId || !live.has(i.budgetItemId)).length;
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumbs={crumbs}
          title={<span className="flex flex-wrap items-center gap-2">{request.title} <FundingStatusBadge status="DRAFT" /></span>}
          description={`A draft for ${request.term.name}. Only your club's budget holders can see it until you submit.`}
          className="mb-0"
        />
        {stale ? (
          <Callout tone="warning" title={`${plural(stale, "line")} left this draft`}>
            {stale === 1 ? "A cost line" : "Some cost lines"} you picked {stale === 1 ? "was" : "were"} removed or moved out of {request.term.name} since the draft was saved. Check the lines below and save again.
          </Callout>
        ) : null}
        <RequestBuilder
          slug={club.slug}
          clubId={club.id}
          term={{ id: request.termId, name: request.term.name }}
          lines={lines}
          sourceNames={names}
          defaultSource={defaultFundingSource(club)}
          initial={{
            requestId: request.id,
            title: request.title,
            justification: request.justification ?? "",
            fundingSource: request.fundingSource,
            itemIds: request.items.map((i) => i.budgetItemId).filter((x): x is string => Boolean(x)),
          }}
          reviewDays={office.reviewDays}
          office={office.name}
          minJustification={MIN_JUSTIFICATION}
        />
        <PolicyNotices placement="FUNDING" />
      </div>
    );
  }

  const invoice = request.invoices[0] ?? null;
  const approved = request.status === "APPROVED" || request.status === "PARTIALLY_APPROVED";
  const expected = sourceName(request.fundingSource, club);
  const fundedBy = approved ? sourceName(request.fundedSource ?? request.fundingSource, club) : null;
  const steps = requestTimeline({
    office: office.name,
    status: request.status,
    createdAt: request.createdAt,
    submittedAt: request.submittedAt,
    submittedBy: request.submittedBy?.name,
    decidedAt: request.decidedAt,
    decidedBy: request.decidedBy?.name,
    fundedBy,
    invoice,
  });
  // Lines WSUSA funded for less than they asked are free again (lib/funding/locks): offer to ask another source for them.
  const reduced = approved ? request.items.filter((i) => i.approvedCents != null && i.approvedCents < i.totalCents) : [];
  let askAgainHref: string | null = null;
  if (reduced.length) {
    const budget = await loadClubTermBudget(club.id, request.termId);
    const open = new Set(budget.lines.filter((l) => l.requestable).map((l) => l.id));
    if (reduced.some((i) => i.budgetItemId && open.has(i.budgetItemId))) askAgainHref = `${base}/requests/new?term=${request.termId}&from=${request.id}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={crumbs}
        title={<span className="flex flex-wrap items-center gap-2">{request.title} <FundingStatusBadge status={request.status} /></span>}
        description={`${request.term.name} · ${fundedBy ? `Funded by ${fundedBy}` : `Expected from ${expected}`}`}
        actions={request.status === "SUBMITTED" ? <WithdrawRequest requestId={request.id} title={request.title} /> : undefined}
        className="mb-0"
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <DecisionCallout request={request} audience="club" reviewDays={office.reviewDays} office={office.name} fundedLabel={fundedBy} reducedLines={reduced.length} askAgainHref={askAgainHref} />
          <RequestFactsCard request={request} sourceLabel={expected} fundedLabel={fundedBy} />
          <section className="space-y-2" aria-labelledby="items-heading">
            <h2 id="items-heading" className="text-base font-semibold text-ink">
              {approved ? "What was requested and funded" : "What was requested"}
            </h2>
            <p className="text-sm text-ink-3">
              The lines as they were when the request was submitted. Later budget changes don&apos;t alter them.
              {approved ? ` ${office.name} decides line by line; a line that got less than it asked is free to put in a request to another source.` : ""}
            </p>
            <RequestItemsTable items={request.items} requestedCents={request.amountRequestedCents} approvedCents={request.amountApprovedCents} showApproved={approved} caption={`Lines in ${request.title}`} />
          </section>
          {approved ? (
            <Card>
              <CardHeader title="Invoice" description={`${office.name} uses the invoice to move the approved money through the university finance system.`} />
              <CardBody>
                {invoice ? (
                  <InvoicePanel invoice={invoice} />
                ) : (
                  <p className="text-sm text-ink-2">This request was approved before approvals came with an invoice. Ask {office.name} if you need one.</p>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>
        <aside className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Progress" />
            <CardBody>
              <RequestTimeline steps={steps} />
            </CardBody>
          </Card>
          <Card>
            <CardBody className="flex gap-3 text-sm text-ink-2">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              <p>
                {office.email ? (
                  <>
                    Questions about this request? Email{" "}
                    <a href={`mailto:${office.email}`} className="font-medium text-brand-600 hover:underline">
                      {office.name}
                    </a>
                    {office.location ? ` or stop by ${office.location}` : ""}.
                  </>
                ) : (
                  `Questions about this request? Ask ${office.name}${office.location ? ` at ${office.location}` : ""}.`
                )}
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
      <PolicyNotices placement="FUNDING" />
    </div>
  );
}
