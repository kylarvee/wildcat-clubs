import Link from "next/link";
import { ArrowRight, CalendarSearch } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { featuredClubs, upcomingPublicEvents } from "@/lib/clubs/queries";
import { getConfig } from "@/lib/config";
import { announcementFeed } from "@/lib/domain/announcements";
import { AnnouncementsFeed } from "@/components/announcements/AnnouncementsFeed";
import { platformSummary } from "@/lib/metrics";
import { ClubCard } from "@/components/clubs/ClubCard";
import { EventList } from "@/components/clubs/EventList";
import { Audiences, hasNumbers, LandingHero, LandingSection, Lifecycle, LiveNumbers, NetworkPreview, StartClubCta } from "@/components/landing/LandingSections";

/** The public front door: what Wildcat Clubs is, live numbers, clubs and events worth a look. */
export default async function Home() {
  const [user, summary, clubs, events, cfg, news] = await Promise.all([
    getCurrentUser(),
    platformSummary(),
    featuredClubs(6),
    upcomingPublicEvents({ days: 14, limit: 6 }),
    getConfig(),
    announcementFeed(null, 1),
  ]);
  const hasNews = news.length > 0;
  const startHref = user ? "/clubs/new" : `/login?next=${encodeURIComponent("/clubs/new")}`;
  const canStart = !user || can(user, "club.create");
  const showNumbers = hasNumbers(summary);

  return (
    <>
      <LandingHero firstName={user ? user.name.split(" ")[0] : null} events={events} clubs={clubs} />
      {showNumbers ? <LiveNumbers summary={summary} /> : null}

      <Lifecycle />
      <Audiences reviewThreshold={cfg["reviews.minAttendance"]} />

      {clubs.length ? (
        <LandingSection
          id="featured"
          eyebrow="Clubs to check out"
          title="A few clubs Wildcats keep showing up for"
          action={
            <Link href="/clubs" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
              Browse all clubs <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
        >
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clubs.map((c) => (
              <li key={c.id} className="flex min-w-0">
                <ClubCard club={c} signedIn={Boolean(user)} showActions={false} />
              </li>
            ))}
          </ul>
        </LandingSection>
      ) : null}

      <LandingSection
        id="events"
        eyebrow="Open to everyone"
        title="Coming up in the next two weeks"
        className={clubs.length ? "pt-4" : undefined}
        action={
          <Link href="/calendar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
            Full calendar <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      >
        {events.length ? (
          <EventList events={events} />
        ) : (
          <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface px-6 py-12 text-center">
            <CalendarSearch className="h-8 w-8 text-ink-3" aria-hidden="true" />
            <p className="mt-3 font-medium text-ink">No public events in the next two weeks</p>
            <p className="mt-1 max-w-md text-sm text-ink-3">
              {user ? "Your clubs' members-only events are on your calendar." : "Clubs post campus-only and members-only events too — sign in to see everything you can go to."}
            </p>
          </div>
        )}
      </LandingSection>

      {hasNews ? (
        <LandingSection id="news" eyebrow="From WSUSA" title="News for every Wildcat">
          <AnnouncementsFeed userId={null} limit={3} />
        </LandingSection>
      ) : null}

      <NetworkPreview />

      {canStart ? <StartClubCta href={startHref} reviewDays={cfg["wsusa.office"].reviewDays} office={cfg["wsusa.office"].name} /> : null}
    </>
  );
}
