import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, FileText, ListChecks, Lock, Plus, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { getTerms } from "@/lib/terms";
import { fmtMoney } from "@/lib/time";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { budgetTermForEvent, budgetTermOptions, loadClubTermBudget } from "@/lib/domain/funding";
import { defaultFundingSource } from "@/lib/funding/defaults";
import { plural, sourceNames } from "@/lib/funding/labels";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState, PageHeader, Section } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { BudgetTiles, SourceBreakdown } from "@/components/budget/BudgetSummary";
import { CostLineRow, EventCostCard } from "@/components/budget/CostLines";
import { AddCostButton, CostRowActions, type CostDialogContext } from "@/components/budget/CostDialog";
import { RequestList } from "@/components/budget/RequestList";
import { TermSelect } from "@/components/budget/TermSelect";

export const metadata: Metadata = { title: "Budget & funding" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The Budget tool: one semester's costs (event costs from the Events Builder,
 * read-only here, plus general costs entered here), totals by funding source,
 * and the club's funding requests. Requires the "budget" capability.
 */
export default async function BudgetPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { club, access, allowed } = await loadClubWorkspace(slug, "budget");
  if (club.status !== "APPROVED") {
    return (
      <EmptyState
        icon={<Lock />}
        title={club.status === "RETIRED" ? "This club is retired" : "Budgets open once WSUSA approves the club"}
        description={
          club.status === "RETIRED"
            ? "Its past funding requests and invoices are kept on record with WSUSA."
            : "While the club is being founded, focus on the profile, advisor and constitution. Planning costs and requesting funding unlock after approval."
        }
      />
    );
  }
  if (!allowed) return <NoPermission what="the budget" suspended={access.suspended} />;

  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const now = new Date();
  const base = `/clubs/${club.slug}/manage/budget`;
  const { terms, current } = await budgetTermOptions(club.id, now);
  if (!terms.length) {
    return (
      <EmptyState
        icon={<CalendarPlus />}
        title="The academic calendar isn't set up yet"
        description="Budgets are planned by semester. Ask a system administrator to add Weber State's terms, then come back."
      />
    );
  }

  const focusEvent = str("event") ? await db.event.findFirst({ where: { id: str("event"), clubId: club.id }, select: { id: true, title: true } }) : null;
  let termId = terms.find((t) => t.id === str("term"))?.id;
  if (!termId && focusEvent) termId = (await budgetTermForEvent(focusEvent.id, now)) ?? undefined;
  termId ??= current?.id ?? terms.at(-1)!.id;
  // An event's meetings can run into a semester with no other costs; make sure it's selectable.
  const termOptions = terms.some((t) => t.id === termId) ? terms : [...terms, ...(await getTerms()).filter((t) => t.id === termId)].sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());

  const budget = await loadClubTermBudget(club.id, termId);
  const names = sourceNames(club);
  const term = budget.term;
  const canEditEvents = access.capabilities.has("events");
  const focusGroup = focusEvent ? budget.eventGroups.find((g) => g.event.id === focusEvent.id) : null;
  const newRequest = (eventId?: string) => `${base}/requests/new?term=${term.id}${eventId ? `&event=${eventId}` : ""}`;
  const ctx: CostDialogContext = {
    clubId: club.id,
    terms: termOptions.map((t) => ({ id: t.id, name: t.name })),
    defaultTermId: term.id,
    defaultSource: defaultFundingSource(club),
    sourceNames: names,
  };
  const generalTotal = budget.general.reduce((s, l) => s + l.totalCents, 0);
  // Something left to ask for: a line no request holds, including what WSUSA didn't fund (lib/funding/locks).
  const canRequest = budget.lines.some((l) => l.requestable);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Budget & funding"
        description={`Plan what ${club.name} will spend each semester, then ask for the money to cover it. Event costs come from the Events Builder; everything else you add here.`}
        actions={
          <>
            <TermSelect terms={termOptions.map((t) => ({ id: t.id, name: t.name }))} value={term.id} currentId={current?.id} basePath={base} />
            {canRequest ? (
              <ButtonLink href={newRequest()} size="md">
                <Wallet className="h-4 w-4" aria-hidden /> Request funding
              </ButtonLink>
            ) : null}
          </>
        }
        className="mb-0"
      />

      {focusEvent ? (
        focusGroup ? (
          <Callout tone="brand" icon={<Wallet />} title={`Funding for ${focusEvent.title}`}>
            <p>
              Its costs are highlighted below: <strong>{fmtMoney(focusGroup.totalCents)}</strong> in {term.name}.{" "}
              {focusGroup.lines.some((l) => l.requestable) ? (
                <Link href={newRequest(focusEvent.id)} className="font-medium underline">
                  Start a request with these lines
                </Link>
              ) : (
                "Every line is already part of a request."
              )}
            </p>
          </Callout>
        ) : (
          <Callout tone="info" title={`${focusEvent.title} has no costs in ${term.name}`}>
            {canEditEvents ? (
              <>
                Add them in the event&apos;s{" "}
                <Link href={`/clubs/${club.slug}/manage/events/${focusEvent.id}#costs`} className="font-medium underline">
                  Costs section
                </Link>{" "}
                and they&apos;ll show up here, ready to request.
              </>
            ) : (
              "Someone with the Events permission can add them in the Events Builder; they'll show up here, ready to request."
            )}
          </Callout>
        )
      ) : null}

      <BudgetTiles planned={budget.planned} money={budget.money} lineCount={budget.lines.length} termName={term.name} />

      {budget.lines.length || budget.requests.length ? (
        <Card>
          <CardHeader title="Where the money comes from" description="Planned and requested money by the source you expect; approved money by the source WSUSA says funded it." />
          <CardBody>
            <SourceBreakdown planned={budget.planned} money={budget.money} club={club} />
          </CardBody>
        </Card>
      ) : null}

      <Section
        title="Event costs"
        description="From each event's Costs section in the Events Builder. Lines marked “each meeting” multiply by the meetings scheduled this semester."
      >
        <div id="event-costs" className="scroll-mt-24" />
        {budget.eventGroups.length ? (
          <div className="space-y-4">
            {budget.eventGroups.map((g) => (
              <EventCostCard
                key={g.event.id}
                group={g}
                termName={term.name}
                slug={club.slug}
                sourceNames={names}
                canEditEvents={canEditEvents}
                highlighted={g.event.id === focusEvent?.id}
                requestHref={g.lines.some((l) => l.requestable) ? newRequest(g.event.id) : null}
              />
            ))}
            <p className="text-right text-sm text-ink-2">
              Event costs this semester: <strong className="tabular-nums text-ink">{fmtMoney(budget.planned.eventCents)}</strong>
            </p>
          </div>
        ) : (
          <EmptyState
            icon={<CalendarPlus />}
            title={`No event costs in ${term.name}`}
            description="Add food, supplies or room fees to an event in the Events Builder and they'll appear here — repeating events multiply by their meetings."
            action={
              canEditEvents ? (
                <ButtonLink href={`/clubs/${club.slug}/manage/events`} variant="outline" size="sm">
                  Open the Events Builder
                </ButtonLink>
              ) : undefined
            }
          />
        )}
      </Section>

      <Section title="Other costs" description="Costs that aren't tied to one event: T-shirts, banners, competition or conference fees." action={<AddCostButton ctx={ctx} />}>
        <div id="other-costs" className="scroll-mt-24" />
        {budget.general.length ? (
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
            <ul className="divide-y divide-line">
              {budget.general.map((l) => (
                <CostLineRow
                  key={l.id}
                  line={l}
                  sourceNames={names}
                  actions={
                    l.lockedBy ? (
                      <span className="flex h-8 w-8 items-center justify-center text-ink-3" title="Locked while a request covers it: in review, or funded in full">
                        <Lock className="h-4 w-4" aria-hidden />
                        <span className="sr-only">Locked while a request covers it: in review, or funded in full</span>
                      </span>
                    ) : (
                      <CostRowActions ctx={ctx} item={{ id: l.id, description: l.description, category: l.category, quantity: l.quantity, unitCostCents: l.unitCostCents, fundingSource: l.fundingSource, termId: l.termId }} />
                    )
                  }
                />
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-line bg-muted/40 px-4 py-3 text-sm">
              <span className="text-ink-2">{plural(budget.general.length, "line")}</span>
              <span className="text-ink-2">
                Other costs this semester: <strong className="tabular-nums text-ink">{fmtMoney(generalTotal)}</strong>
              </span>
            </div>
          </div>
        ) : (
          <EmptyState icon={<ListChecks />} title={`No other costs in ${term.name}`} description="Add anything the club needs money for that isn't part of a single event." action={<AddCostButton ctx={ctx} variant="primary" />} />
        )}
      </Section>

      <Section
        title="Funding requests"
        description={`Requests for ${term.name}. Each lists the lines it covers and the source you expect; WSUSA reviews every request and may fund it from another source.`}
        action={
          <Link href={`${base}/requests`} className="shrink-0 text-sm font-medium text-brand-600 hover:underline">
            All requests
          </Link>
        }
      >
        <div id="requests" className="scroll-mt-24" />
        {budget.requests.length ? (
          <div className="space-y-3">
            <RequestList requests={budget.requests} base={base} sourceNames={names} />
            {canRequest ? (
              <ButtonLink href={newRequest()} variant="outline" size="sm">
                <Plus className="h-4 w-4" aria-hidden /> New request
              </ButtonLink>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={<FileText />}
            title={`No funding requests for ${term.name} yet`}
            description={budget.lines.length ? "Pick the lines you need money for, explain why, and send it to WSUSA." : "Add costs first — then you can ask for the money to cover them."}
            action={
              budget.lines.length ? (
                <ButtonLink href={newRequest()} size="sm">
                  <Wallet className="h-4 w-4" aria-hidden /> Start a request
                </ButtonLink>
              ) : undefined
            }
          />
        )}
      </Section>

      <PolicyNotices placement="FUNDING" />
    </div>
  );
}
