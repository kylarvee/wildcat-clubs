import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Mail } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { can, canAdminFunding } from "@/lib/authz";
import { fmtLongDate, fmtMoney } from "@/lib/time";
import { invoiceDueDates, loadClubTermBudget, loadFundingRequest, priorRequests } from "@/lib/domain/funding";
import { fundingOfficeForClub } from "@/lib/offices";
import { plural, sourceName, sourceNames } from "@/lib/funding/labels";
import { requestTimeline } from "@/lib/funding/timeline";
import { TYPE_LABEL } from "@/components/founding/copy";
import { ClubLogo } from "@/components/ui/avatar";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, PageHeader } from "@/components/ui/layout";
import { FundingStatusBadge } from "@/components/budget/StatusBadge";
import { RequestTimeline } from "@/components/budget/RequestTimeline";
import { RequestItemsTable, lineMathText } from "@/components/budget/RequestItemsTable";
import { DecisionCallout, RequestFactsCard } from "@/components/budget/RequestDetail";
import { InvoicePanel } from "@/components/budget/InvoicePanel";
import { SourceBreakdown } from "@/components/budget/BudgetSummary";
import { DecisionPanel } from "@/components/budget/admin/DecisionPanel";
import { MarkProcessedButton } from "@/components/budget/admin/InvoiceActions";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  // Metadata resolves before the admin layout's check, so only the admins who decide the club's funding get the request's title.
  const viewer = await getCurrentUser();
  if (!can(viewer, "admin.funding")) return { title: "Funding request" };
  const request = await loadFundingRequest((await params).id);
  return { title: request && request.status !== "DRAFT" && canAdminFunding(viewer, request.club) ? `Funding · ${request.title}` : "Funding request" };
}

/**
 * One funding request for the office that decides it (WSUSA, or the club's own office when it decides funding): the club, the lines it asked for (as
 * submitted), the club's budget for that semester, its earlier requests, the
 * decision (line by line, with the source that funds it), and the invoice the
 * approval created.
 */
export default async function AdminFundingRequestPage({ params }: { params: Params }) {
  const user = await requireUser("/admin/funding");
  if (!can(user, "admin.funding")) notFound();
  const { id } = await params;
  const request = await loadFundingRequest(id);
  // Drafts are the club's own work until they submit; office staff see only their own clubs' requests.
  if (!request || request.status === "DRAFT" || !canAdminFunding(user, request.club)) notFound();

  const invoice = request.invoices[0] ?? null;
  const [budget, prior, due, office] = await Promise.all([
    loadClubTermBudget(request.clubId, request.termId),
    priorRequests(request.clubId, request.id),
    invoiceDueDates(invoice ? [invoice.id] : []),
    // Who decides it: the club's office when it decides funding, else WSUSA (lib/offices).
    fundingOfficeForClub(request.clubId),
  ]);
  const club = request.club;
  const source = sourceName(request.fundingSource, club);
  const approved = request.status === "APPROVED" || request.status === "PARTIALLY_APPROVED";
  const fundedBy = approved ? sourceName(request.fundedSource ?? request.fundingSource, club) : null;
  const reducedLines = approved ? request.items.filter((i) => i.approvedCents != null && i.approvedCents < i.totalCents).length : 0;
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
  const clubLine = [TYPE_LABEL[club.type], club.department?.name, club.college?.name].filter(Boolean).join(" · ");
  const eventLines = request.items.filter((i) => i.eventTitle).length;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ href: "/admin/funding", label: "Funding" }, { label: club.name }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {request.title} <FundingStatusBadge status={request.status} />
          </span>
        }
        description={`${club.name} · ${request.term.name} · ${fundedBy ? `Funded by ${fundedBy}` : `Expected from ${source}`}`}
        className="mb-0"
      />

      {club.status !== "APPROVED" ? (
        <Callout tone="warning" title={club.status === "RETIRED" ? "This club has retired" : "This club isn't currently recognized"}>
          Check with the club&apos;s advisor before approving money for it.
        </Callout>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <DecisionCallout request={request} audience="admin" office={office.name} fundedLabel={fundedBy} reducedLines={reducedLines} />

          {request.status === "SUBMITTED" ? (
            <Card>
              <CardHeader
                title="Decide"
                description={`${club.name} asked for ${fmtMoney(request.amountRequestedCents)} and expects it from ${source}. Approve every line, set what each line gets, or don't approve it.`}
              />
              <CardBody>
                <DecisionPanel
                  requestId={request.id}
                  clubName={club.name}
                  title={request.title}
                  requestedCents={request.amountRequestedCents}
                  lines={request.items.map((i) => ({ id: i.id, description: i.description, eventTitle: i.eventTitle, totalCents: i.totalCents, math: lineMathText(i) }))}
                  expectedSource={request.fundingSource}
                  sourceNames={sourceNames(club)}
                />
              </CardBody>
            </Card>
          ) : null}

          {approved ? (
            <Card>
              <CardHeader
                title="Invoice"
                description={
                  invoice
                    ? invoice.status === "OPEN"
                      ? "Created with the approval. Attach the PDF to the transfer in the university finance system, then mark it processed."
                      : "Processed in the university finance system."
                    : "This request was approved before approvals created invoices, so it has none."
                }
              />
              {invoice ? (
                <CardBody>
                  <InvoicePanel invoice={invoice} defaultOpen={invoice.status === "OPEN"} dueAt={due.get(invoice.id) ?? null}>
                    {invoice.status === "OPEN" ? <MarkProcessedButton invoiceId={invoice.id} number={invoice.number} amountCents={invoice.amountCents} /> : null}
                  </InvoicePanel>
                </CardBody>
              ) : null}
            </Card>
          ) : null}

          <RequestFactsCard request={request} sourceLabel={source} fundedLabel={fundedBy} />

          <section className="space-y-2" aria-labelledby="items-heading">
            <h2 id="items-heading" className="text-base font-semibold text-ink">
              What the club asked for
            </h2>
            <p className="text-sm text-ink-3">
              {plural(request.items.length, "line")}
              {eventLines ? `, ${eventLines} from events` : ""}, as submitted. Per-meeting event costs are multiplied by the meetings scheduled in {request.term.name}.
            </p>
            <RequestItemsTable items={request.items} requestedCents={request.amountRequestedCents} approvedCents={request.amountApprovedCents} showApproved={approved} caption={`Lines in ${request.title}`} />
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center gap-3">
                <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} />
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{club.name}</p>
                  <p className="text-sm text-ink-3">{clubLine}</p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 text-sm">
                <Link href={`/clubs/${club.slug}`} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
                  Club page <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
                <Link href={`/clubs/${club.slug}/manage/budget?term=${request.termId}`} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
                  Club&apos;s budget for {request.term.name} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
                <Link href={`/admin/clubs/${club.id}`} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
                  Club record <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
                {club.contactEmail ? (
                  <a href={`mailto:${club.contactEmail}?subject=${encodeURIComponent(`Funding request: ${request.title}`)}`} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
                    <Mail className="h-3.5 w-3.5" aria-hidden /> Email the club
                  </a>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Progress" />
            <CardBody>
              <RequestTimeline steps={steps} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`${request.term.name} budget`} description="Everything the club has planned and asked for this semester, by source." />
            <CardBody className="space-y-3">
              <SourceBreakdown planned={budget.planned} money={budget.money} club={club} compact />
              <p className="text-xs text-ink-3">
                Planned costs: {fmtMoney(budget.planned.eventCents)} from events, {fmtMoney(budget.planned.generalCents)} other. Requested and approved count every request the club sent this semester, including this one.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Earlier requests" />
            <CardBody className="p-0">
              {prior.length ? (
                <ul className="divide-y divide-line">
                  {prior.map((p) => (
                    <li key={p.id}>
                      <Link href={`/admin/funding/${p.id}`} className="block px-4 py-2.5 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand">
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0 text-sm font-medium text-ink">{p.title}</span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{fmtMoney(p.amountApprovedCents ?? p.amountRequestedCents)}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                          <FundingStatusBadge status={p.status} />
                          {p.term.name}
                          {p.submittedAt ? ` · ${fmtLongDate(p.submittedAt)}` : ""}
                          {p.amountApprovedCents != null && p.amountApprovedCents !== p.amountRequestedCents ? ` · asked ${fmtMoney(p.amountRequestedCents)}` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-3 text-sm text-ink-3">This is the club&apos;s first funding request.</p>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
