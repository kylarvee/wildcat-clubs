import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, LogIn, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser, type Actor } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { eventCostSummaries } from "@/lib/domain/events";
import { appUrl, googleSubscribeUrl, webcalUrl } from "@/lib/events/share";
import { INSTITUTION } from "@/lib/institution";
import { fmtDate, fmtMoney } from "@/lib/time";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Container, PageHeader } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { CalendarView } from "@/components/calendar/CalendarView";
import { CopyField } from "@/components/calendar/CopyField";
import { MyCalendar, type MyCalendarClub } from "@/components/calendar/MyCalendar";

export const metadata: Metadata = { title: "Calendar" };

function feedLinks(path: string) {
  const https = appUrl(path);
  return { https, webcal: webcalUrl(https), google: googleSubscribeUrl(https) };
}

function ViewSwitch({ all }: { all: boolean }) {
  const item = (on: boolean) => cn("rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand", on ? "bg-brand-50 text-brand" : "text-ink-3 hover:text-ink");
  return (
    <nav aria-label="Which calendar" className="flex rounded-lg border border-line-2 bg-surface p-0.5">
      <Link href="/calendar" aria-current={!all ? "page" : undefined} className={item(!all)}>
        My calendar
      </Link>
      <Link href="/calendar?all=1" aria-current={all ? "page" : undefined} className={item(all)}>
        All of {INSTITUTION.shortName}
      </Link>
    </nav>
  );
}

function SubscribeCard({ title, description, feed, label }: { title: string; description: string; feed: ReturnType<typeof feedLinks>; label: string }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <a href={feed.google} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line-2 bg-surface px-3 text-sm font-medium text-ink hover:bg-muted">
            <CalendarPlus className="h-4 w-4" /> Google Calendar
          </a>
          <a href={feed.webcal} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line-2 bg-surface px-3 text-sm font-medium text-ink hover:bg-muted">
            <CalendarPlus className="h-4 w-4" /> Apple / Outlook
          </a>
        </div>
        <CopyField value={feed.https} label={label} />
      </CardBody>
    </Card>
  );
}

/** Leaders: what their clubs' upcoming events are expected to cost, with the way to ask for money. */
async function PlannedCosts({ actor }: { actor: Actor }) {
  const roles = await db.roleAssignment.findMany({ where: { userId: actor.id, endedAt: null, role: { not: "MEMBER" } }, select: { clubId: true } });
  const clubIds: string[] = [];
  for (const id of [...new Set(roles.map((r) => r.clubId))]) {
    const access = await getClubAccess(actor, id);
    if (access && (access.capabilities.has("budget") || access.capabilities.has("events"))) clubIds.push(id);
  }
  if (clubIds.length === 0) return null;
  const now = new Date();
  const events = await db.event.findMany({
    where: { clubId: { in: clubIds }, status: "SCHEDULED", costItems: { some: {} }, occurrences: { some: { startsAt: { gte: now }, status: "SCHEDULED" } } },
    select: {
      id: true,
      title: true,
      club: { select: { id: true, name: true, slug: true } },
      occurrences: { where: { startsAt: { gte: now }, status: "SCHEDULED" }, orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } },
    },
    take: 40,
  });
  const summaries = await eventCostSummaries(events.map((e) => e.id));
  const byClub = new Map<string, { name: string; slug: string; rows: { id: string; title: string; next: Date; total: number }[] }>();
  for (const e of events) {
    if (!e.club) continue;
    const g = byClub.get(e.club.id) ?? { name: e.club.name, slug: e.club.slug, rows: [] };
    g.rows.push({ id: e.id, title: e.title, next: e.occurrences[0].startsAt, total: summaries.get(e.id)?.totalCents ?? 0 });
    byClub.set(e.club.id, g);
  }
  return (
    <Card>
      <CardHeader title="Planned event costs" description="Only you and your club's leaders see these." />
      <CardBody className="space-y-4">
        {byClub.size === 0 ? (
          <p className="text-sm text-ink-3">None of your clubs&apos; upcoming events have costs yet. Add them in each event&apos;s Costs section.</p>
        ) : (
          [...byClub.values()].map((g) => (
            <div key={g.slug}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-ink">{g.name}</p>
                <Link href={`/clubs/${g.slug}/manage/budget`} className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                  <Wallet className="h-3.5 w-3.5" /> Request funding
                </Link>
              </div>
              <ul className="divide-y divide-line text-sm">
                {g.rows
                  .sort((a, b) => a.next.getTime() - b.next.getTime())
                  .slice(0, 6)
                  .map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
                      <Link href={`/events/${r.id}`} className="min-w-0 truncate text-ink-2 hover:underline">
                        {r.title} <span className="text-xs text-ink-3">· {fmtDate(r.next, "MMM d")}</span>
                      </Link>
                      <span className="shrink-0 font-medium tabular-nums">{fmtMoney(r.total)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const user = await getCurrentUser();
  const universityFeed = feedLinks("/api/ics/university.ics");

  if (!user || all === "1") {
    return (
      <Container size="xl">
        <PageHeader
          title={`${INSTITUTION.shortName} club calendar`}
          description={`Public events from every ${INSTITUTION.mascot} club, plus university events. Times are Ogden campus time.`}
          actions={user ? <ViewSwitch all /> : null}
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <CalendarView source={{ scope: "university" }} />
          <aside className="min-w-0 space-y-6">
            {!user ? (
              <Card>
                <CardHeader title="Get your own calendar" description="Sign in with your Weber State account to see the clubs you join and follow — including members-only events — in one place." />
                <CardBody>
                  <ButtonLink href="/login?next=%2Fcalendar" className="w-full">
                    <LogIn className="h-4 w-4" /> Sign in with Weber State
                  </ButtonLink>
                </CardBody>
              </Card>
            ) : null}
            <SubscribeCard title="Subscribe to this calendar" description="Every public club and university event, updated automatically." feed={universityFeed} label="Public calendar link" />
          </aside>
        </div>
      </Container>
    );
  }

  const [memberships, subscriptions, me] = await Promise.all([
    db.membership.findMany({
      where: { userId: user.id, status: "ACTIVE", club: { status: "APPROVED" } },
      select: { club: { select: { id: true, name: true, slug: true, logoColor: true, logoUrl: true } } },
      orderBy: { club: { name: "asc" } },
    }),
    db.calendarSubscription.findMany({
      where: { userId: user.id, club: { status: "APPROVED" } },
      select: { club: { select: { id: true, name: true, slug: true, logoColor: true, logoUrl: true } } },
      orderBy: { club: { name: "asc" } },
    }),
    db.user.findUnique({ where: { id: user.id }, select: { calendarToken: true, subscribeUniversity: true } }),
  ]);
  const subscribed = new Set(subscriptions.map((s) => s.club.id));
  const memberIds = new Set(memberships.map((m) => m.club.id));
  const memberClubs: MyCalendarClub[] = memberships.map((m) => ({ ...m.club, subscribed: subscribed.has(m.club.id) }));
  const following: MyCalendarClub[] = subscriptions.filter((s) => !memberIds.has(s.club.id)).map((s) => ({ ...s.club, subscribed: true }));

  return (
    <Container size="xl">
      <PageHeader title="Your calendar" description="Events from the clubs you're in and follow, in Ogden campus time." actions={<ViewSwitch all={false} />} />
      <MyCalendar
        memberClubs={memberClubs}
        following={following}
        university={me?.subscribeUniversity ?? true}
        feed={feedLinks(`/api/ics/user/${me?.calendarToken ?? ""}.ics`)}
        aside={<PlannedCosts actor={user} />}
      />
    </Container>
  );
}
