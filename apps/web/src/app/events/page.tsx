import type { Metadata } from "next";
import { CalendarX, Compass, SearchX } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { viewerContext } from "@/lib/events/feed";
import { listEvents } from "@/lib/events/browse";
import {
  CLEARED,
  dateRange,
  dayHeading,
  eventsHref,
  filterSearchParams,
  hasFilters,
  LIST_STEP,
  listWindow,
  parseEventParams,
  rangeLabel,
  resolveScope,
} from "@/lib/events/browse-params";
import { appUrl, googleSubscribeUrl, webcalUrl } from "@/lib/events/share";
import { toDateInput } from "@/lib/events/wallclock";
import type { EventCardData } from "@/lib/events/types";
import { INSTITUTION } from "@/lib/institution";
import { ButtonLink } from "@/components/ui/button";
import { Container, EmptyState, PageHeader } from "@/components/ui/layout";
import { CalendarView } from "@/components/calendar/CalendarView";
import { EventBrowser } from "@/components/events/EventBrowser";
import { EventCard } from "@/components/events/EventCard";
import { SubscribeMenu } from "@/components/events/SubscribeMenu";
import { PlannedCosts } from "./planned-costs";

export const metadata: Metadata = {
  title: "Events",
  description: `Club and university events at ${INSTITUTION.name}: meetings, socials, workshops and service projects, with free food, service hours and online options to filter by.`,
};

function feedLinks(path: string) {
  const https = appUrl(path);
  return { https, webcal: webcalUrl(https), google: googleSubscribeUrl(https) };
}

/** Cards grouped by day. Something that began before the list's first day (a multi-day event under way) sits under that first day. */
function DayGroups({ items, firstDay, now }: { items: EventCardData[]; firstDay: string; now: Date }) {
  const groups: { key: string; items: EventCardData[] }[] = [];
  for (const e of items) {
    const key = e.dayKey < firstDay ? firstDay : e.dayKey;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(e);
    else groups.push({ key, items: [e] });
  }
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`day-${g.key}`}>
          <h2 id={`day-${g.key}`} className="mb-3 text-xs font-bold uppercase tracking-[0.07em] text-ink-3">
            {dayHeading(g.key, now)}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((e) => (
              <li key={e.occurrenceId} className="min-w-0">
                <EventCard e={e} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Events: the one place to find what's on. Mine (clubs you follow, plus
 * university events you keep on) or All of Weber State (everything you may
 * see), as a list of cards or the month calendar, filtered by date, type,
 * the host's category, perks, service hours and online/hybrid, all in the
 * URL. The old /calendar sends people here. The Subscribe menu holds the
 * calendar feeds.
 */
export default async function EventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseEventParams(await searchParams);
  const user = await getCurrentUser();
  const ctx = await viewerContext(user);
  const scope = resolveScope(params, { signedIn: Boolean(user), followsClubs: ctx.subscribedClubIds.length > 0 });
  const now = new Date();
  const loginHref = `/login?next=${encodeURIComponent(eventsHref(params))}`;
  const [me, result] = await Promise.all([
    user ? db.user.findUnique({ where: { id: user.id }, select: { calendarToken: true, subscribeUniversity: true } }) : Promise.resolve(null),
    params.view === "list" ? listEvents(ctx, scope, params, now) : Promise.resolve(null),
  ]);

  const shown = result?.items.length ?? 0;
  const total = result?.total ?? 0;
  const range = rangeLabel(params, now);
  const summary = result ? (
    <>
      {shown < total ? (
        <>
          Showing <span className="font-semibold text-ink">{shown}</span> of {total} events
        </>
      ) : (
        <>
          <span className="font-semibold text-ink">{total}</span> {total === 1 ? "event" : "events"}
        </>
      )}
      {range ? ` · ${range}` : " coming up"}
    </>
  ) : null;

  const followsNobody = scope === "mine" && ctx.subscribedClubIds.length === 0;
  const empty = followsNobody ? (
    <EmptyState
      icon={<Compass />}
      title="You don't follow any clubs yet"
      description="Follow a club from its page (or register for it) and its events show up under Mine."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink href="/clubs">Browse clubs</ButtonLink>
          <ButtonLink href={eventsHref(params, { scope: "all" })} variant="outline">
            See all of {INSTITUTION.shortName}
          </ButtonLink>
        </div>
      }
    />
  ) : params.q && !hasFilters({ ...params, q: "" }) ? (
    <EmptyState
      icon={<SearchX />}
      title={`No events match “${params.q}”`}
      description="We looked at event names, descriptions and host clubs. Try another word, or fewer of them."
      action={
        <ButtonLink href={eventsHref(params, { q: "" })} variant="outline">
          Clear search
        </ButtonLink>
      }
    />
  ) : hasFilters(params) ? (
    <EmptyState
      icon={<SearchX />}
      title="No events match those filters"
      description={scope === "mine" ? "Nothing from the clubs you follow fits. Try clearing a filter, or look across all of Weber State." : "Try another date or clear a filter or two."}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink href={eventsHref(params, CLEARED)} variant="outline">
            Clear filters
          </ButtonLink>
          {scope === "mine" ? (
            <ButtonLink href={eventsHref(params, { scope: "all" })} variant="outline">
              Look in all of {INSTITUTION.shortName}
            </ButtonLink>
          ) : null}
        </div>
      }
    />
  ) : (
    <EmptyState icon={<CalendarX />} title="Nothing coming up yet" description="When clubs add events, they show up here." />
  );

  return (
    <Container size="xl">
      <PageHeader
        title="Events"
        description={`What's on at ${INSTITUTION.shortName}: club meetings, socials, workshops and service projects. Times are Ogden campus time.`}
        actions={
          <SubscribeMenu
            mine={me ? feedLinks(`/api/ics/user/${me.calendarToken}.ics`) : null}
            publicFeed={feedLinks("/api/ics/university.ics")}
            university={me?.subscribeUniversity ?? true}
            loginHref={loginHref}
          />
        }
      />
      <EventBrowser params={params} scope={scope} signedIn={Boolean(user)} loginHref={loginHref} summary={summary}>
        {params.view === "month" ? (
          <>
            <CalendarView
              source={{ scope: scope === "mine" ? "me" : "all" }}
              initialView="dayGridMonth"
              filters={filterSearchParams(params).toString()}
              initialDate={params.date ?? undefined}
              emptyMessage={hasFilters(params) ? "No events match your filters in this stretch." : "No events in this stretch. Try the next month."}
            />
            {user ? <PlannedCosts actor={user} /> : null}
          </>
        ) : result && result.items.length ? (
          <>
            <DayGroups items={result.items} firstDay={toDateInput(listWindow(dateRange(params, now), now).start)} now={now} />
            {shown < total ? (
              <div className="mt-8 flex flex-col items-center gap-2">
                <ButtonLink href={eventsHref(params, { show: params.show + LIST_STEP })} variant="outline" scroll={false}>
                  Show more events
                </ButtonLink>
              </div>
            ) : null}
          </>
        ) : (
          empty
        )}
      </EventBrowser>
    </Container>
  );
}
