import type { Metadata } from "next";
import { CalendarPlus, ListChecks } from "lucide-react";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { getTerms } from "@/lib/terms";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { budgetTermForEvent, budgetTermOptions, loadClubTermBudget } from "@/lib/domain/funding";
import { defaultFundingSource } from "@/lib/funding/defaults";
import { sourceNames } from "@/lib/funding/labels";
import { MIN_JUSTIFICATION } from "@/lib/funding/math";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { RequestBuilder } from "@/components/budget/RequestBuilder";
import { TermSelect } from "@/components/budget/TermSelect";
import { builderLines } from "@/components/budget/builder-data";

export const metadata: Metadata = { title: "New funding request" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Start a funding request for one semester (?term=), optionally with an event's lines picked (?event=). */
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
  let termId = terms.find((t) => t.id === str("term"))?.id;
  if (!termId && focusEvent) termId = (await budgetTermForEvent(focusEvent.id, now)) ?? undefined;
  termId ??= current?.id ?? terms.at(-1)!.id;
  const termOptions = terms.some((t) => t.id === termId) ? terms : [...terms, ...(await getTerms()).filter((t) => t.id === termId)].sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());

  const [budget, cfg] = await Promise.all([loadClubTermBudget(club.id, termId), getConfig()]);
  const lines = builderLines(budget);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ href: `${base}?term=${termId}`, label: "Budget & funding" }, { label: "New request" }]}
        title="New funding request"
        description="Pick the costs you need money for and tell WSUSA why. Save a draft any time; nothing is sent until you submit."
        actions={<TermSelect terms={termOptions.map((t) => ({ id: t.id, name: t.name }))} value={termId} currentId={current?.id} basePath={`${base}/requests/new`} keep={{ event: focusEvent?.id }} />}
        className="mb-0"
      />
      {lines.length ? (
        <RequestBuilder
          // A new semester starts a fresh form (its lines are different).
          key={`${budget.term.id}:${focusEvent?.id ?? ""}`}
          slug={club.slug}
          clubId={club.id}
          term={{ id: budget.term.id, name: budget.term.name }}
          lines={lines}
          sourceNames={sourceNames(club)}
          defaultSource={defaultFundingSource(club)}
          preselectEventId={focusEvent?.id ?? null}
          reviewDays={cfg["wsusa.office"].reviewDays}
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
