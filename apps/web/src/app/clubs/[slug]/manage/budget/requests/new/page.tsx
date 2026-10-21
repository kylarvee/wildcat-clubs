import type { Metadata } from "next";
import { CalendarPlus, ListChecks, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { fundingOfficeForClub } from "@/lib/offices";
import { getTerms } from "@/lib/terms";
import { fmtMoney } from "@/lib/time";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { budgetTermForEvent, budgetTermOptions, loadClubTermBudget, loadFundingRequest } from "@/lib/domain/funding";
import { defaultFundingSource } from "@/lib/funding/defaults";
import { plural, sourceName, sourceNames } from "@/lib/funding/labels";
import { MIN_JUSTIFICATION } from "@/lib/funding/math";
import { ButtonLink } from "@/components/ui/button";
import { Callout, EmptyState, PageHeader } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { RequestBuilder } from "@/components/budget/RequestBuilder";
import { TermSelect } from "@/components/budget/TermSelect";
import { builderLines } from "@/components/budget/builder-data";

export const metadata: Metadata = { title: "New funding request" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Start a funding request for one semester (?term=), optionally with an
 * event's lines picked (?event=), or with the lines an approved request
 * funded for less than they asked (?from=<requestId>), to ask another source
 * for the rest.
 */
export default async function NewRequestPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { club, access, allowed } = await loadClubWorkspace(slug, "budget");
  if (club.status !== "APPROVED" || !allowed) return <NoPermission what="funding requests" suspended={access.suspended} />;

  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const now = new Date();
  const base = `/clubs/${club.slug}/manage/budget`;
  const { terms, current } = await budgetTermOptions(club.id, now);
  if (!terms.length) {
    return <EmptyState icon={<CalendarPlus />} title="The academic calendar isn't set up yet" description="Requests are made per semester. Ask a system administrator to add Weber State's terms." />;
  }
  const focusEvent = str("event") ? await db.event.findFirst({ where: { id: str("event"), clubId: club.id }, select: { id: true } }) : null;
  const fromId = str("from");
  const fromRequest = fromId ? await loadFundingRequest(fromId) : null;
  const from = fromRequest && fromRequest.clubId === club.id && (fromRequest.status === "APPROVED" || fromRequest.status === "PARTIALLY_APPROVED") ? fromRequest : null;
  let termId = from?.termId ?? terms.find((t) => t.id === str("term"))?.id;
  if (!termId && focusEvent) termId = (await budgetTermForEvent(focusEvent.id, now)) ?? undefined;
  termId ??= current?.id ?? terms.at(-1)!.id;
  const termOptions = terms.some((t) => t.id === termId) ? terms : [...terms, ...(await getTerms()).filter((t) => t.id === termId)].sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());

  // The office that decides this club's funding: its own office when that office decides funding, else WSUSA.
  const [budget, office] = await Promise.all([loadClubTermBudget(club.id, termId), fundingOfficeForClub(club.id)]);
  const lines = builderLines(budget);
  // ?from: the lines that request funded for less than they asked and that are still free to ask for.
  const open = new Map(lines.filter((l) => l.requestable).map((l) => [l.id, l]));
  const rest = from ? from.items.filter((i) => i.budgetItemId && i.approvedCents != null && i.approvedCents < i.totalCents && open.has(i.budgetItemId)).map((i) => open.get(i.budgetItemId!)!) : [];
  const preselect = from && rest.length ? { lineIds: rest.map((l) => l.id), title: `${from.title}: the rest` } : null;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ href: `${base}?term=${termId}`, label: "Budget & funding" }, { label: "New request" }]}
        title="New funding request"
        description="Pick the costs you need money for and tell WSUSA why. Save a draft any time; nothing is sent until you submit."
        actions={from ? undefined : <TermSelect terms={termOptions.map((t) => ({ id: t.id, name: t.name }))} value={termId} currentId={current?.id} basePath={`${base}/requests/new`} keep={{ event: focusEvent?.id }} />}
        className="mb-0"
      />
      {from ? (
        preselect ? (
          <Callout tone="brand" icon={<Wallet />} title={`Asking again for what “${from.title}” didn't fund`}>
            WSUSA funded it from {sourceName(from.fundedSource ?? from.fundingSource, club)}. The {plural(rest.length, "line")} that got less than asked {rest.length === 1 ? "is" : "are"} picked below (
            {fmtMoney(rest.reduce((s, l) => s + l.openCents, 0))} left). Choose the source you expect to cover {rest.length === 1 ? "it" : "them"} now.
          </Callout>
        ) : (
          <Callout tone="info" title={`Nothing left to ask for from “${from.title}”`}>
            Every line it funded for less is already in another request or funded since.
          </Callout>
        )
      ) : null}
      {lines.length ? (
        <RequestBuilder
          // A new semester starts a fresh form (its lines are different).
          key={`${budget.term.id}:${focusEvent?.id ?? ""}:${from?.id ?? ""}`}
          slug={club.slug}
          clubId={club.id}
          term={{ id: budget.term.id, name: budget.term.name }}
          lines={lines}
          sourceNames={sourceNames(club)}
          defaultSource={defaultFundingSource(club)}
          preselectEventId={focusEvent?.id ?? null}
          preselect={preselect}
          reviewDays={office.reviewDays}
          office={office.name}
          minJustification={MIN_JUSTIFICATION}
        />
      ) : (
        <EmptyState
          icon={<ListChecks />}
          title={`Nothing to request in ${budget.term.name} yet`}
          description="A request is built from cost lines. Add event costs in the Events Builder or other costs on the budget page, then come back."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href={`${base}?term=${termId}#other-costs`} size="sm">
                Add a cost
              </ButtonLink>
              {access.capabilities.has("events") ? (
                <ButtonLink href={`/clubs/${club.slug}/manage/events`} variant="outline" size="sm">
                  Open the Events Builder
                </ButtonLink>
              ) : null}
            </div>
          }
        />
      )}
      <PolicyNotices placement="FUNDING" />
    </div>
  );
}
