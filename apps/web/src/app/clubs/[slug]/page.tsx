import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Archive, BadgeCheck, CalendarX2, Hammer, History, Mail } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { canAskToRevive, canSeeFormingClub } from "@/lib/authz/founding";
import { clubIsPublic, getClubBySlug, loadVisibleClub } from "@/lib/clubs/context";
import { foundersOf } from "@/lib/clubs/founding";
import { db } from "@/lib/db";
import { openRevivalRequest } from "@/lib/domain/clubs";
import { isListedForming } from "@/lib/founding/rules";
import { clubMeetingPattern, clubMetricsFor, clubUpcomingEvents, shouldPromptForApp, viewerClubStates, visibleAnnouncementCount } from "@/lib/clubs/queries";
import { INSTITUTION } from "@/lib/institution";
import { officeById } from "@/lib/offices";
import { fmtLongDate } from "@/lib/time";
import { renewedThisYear } from "@/lib/domain/renewals";
import { richToText } from "@/lib/rich/sanitize";
import { ClubAnnouncements } from "@/components/announcements/ClubAnnouncements";
import { ClubAttendanceRecord } from "@/components/attendance/ClubAttendanceRecord";
import { OpenElectionsNotice } from "@/components/elections/OpenElectionsNotice";
import { OrgChart } from "@/components/org-chart/OrgChart";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { RichContent } from "@/components/rich/RichContent";
import { ClubReviews } from "@/components/reviews/ClubReviews";
import { Callout } from "@/components/ui/layout";
import { KeyValue } from "@/components/ui/layout";
import { AppPromptProvider } from "@/components/clubs/AppPrompt";
import { ClubHero } from "@/components/clubs/ClubHero";
import { ClubResources } from "@/components/clubs/ClubResources";
import { ClubStats } from "@/components/clubs/ClubStats";
import { EventList } from "@/components/clubs/EventList";
import { CLUB_CATEGORY_LABEL, CLUB_SCOPE_LABEL, CLUB_TYPE_HINT, CLUB_TYPE_LABEL, JOIN_POLICY_LABEL, readSocialLinks, SOCIAL_LABEL } from "@/components/clubs/labels";
import { FormingClubView } from "@/components/clubs/FormingClubView";
import { AskToReviveDialog } from "@/components/founding/AskToReviveDialog";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * A club that's still being founded, seen from outside its founding team:
 * the minimal forming page when it's listed as forming and the viewer is
 * signed in (lib/authz/founding), else not found. Its founders and the office
 * get the usual page (with ?preview=forming, a founder sees the forming one).
 * Null when the usual page applies.
 */
async function formingPage(slug: string, preview: boolean) {
  const club = await getClubBySlug(slug);
  if (!club || clubIsPublic(club.status)) return null;
  const user = await getCurrentUser();
  const access = user ? await getClubAccess(user, club.id) : null;
  // The founding team (and its office) get the usual page.
  if ((access?.isLeader || access?.isMember) && !(preview && isListedForming(club))) return null;
  if (!canSeeFormingClub(user, club)) notFound();
  return { club, user: user!, preview: Boolean(access?.isLeader) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const forming = await formingPage(slug, false);
  if (forming) return { title: forming.club.name, description: forming.club.shortDescription || `${forming.club.name} is forming at ${INSTITUTION.name}.`, robots: { index: false } };
  const { club } = await loadVisibleClub(slug);
  const description = club.shortDescription || richToText(club.descriptionHtml, 160) || `${club.name}, a student club at ${INSTITUTION.name}.`;
  return { title: club.name, description, openGraph: { title: club.name, description } };
}

function PageSection({ id, title, action, children }: { id: string; title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="mb-3 flex items-end justify-between gap-4">
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function ClubPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const forming = await formingPage(slug, sp.preview === "forming");
  if (forming) {
    const [founders, office, follow] = await Promise.all([
      foundersOf([forming.club.id]),
      officeById(forming.club.officeId),
      db.calendarSubscription.findUnique({ where: { userId_clubId: { userId: forming.user.id, clubId: forming.club.id } }, select: { clubId: true } }),
    ]);
    return <FormingClubView club={forming.club} founders={founders.get(forming.club.id) ?? []} office={office.name} following={Boolean(follow)} preview={forming.preview} />;
  }
  const { club, user, access } = await loadVisibleClub(slug);

  const approved = club.status === "APPROVED";
  const retired = club.status === "RETIRED";
  const isPublic = approved || retired;
  const member = Boolean(access?.isMember);

  const [states, promptForApp, metrics, events, announcementCount, office, meets, renewal, revival] = await Promise.all([
    user ? viewerClubStates(user.id) : Promise.resolve(null),
    user && approved ? shouldPromptForApp(user.id) : Promise.resolve(false),
    clubMetricsFor(club.id),
    isPublic ? clubUpcomingEvents(club.id, user) : Promise.resolve([]),
    visibleAnnouncementCount(club.id, access),
    // The office that oversees the club (lib/offices): WSUSA, Campus Recreation, Fraternity & Sorority Life.
    officeById(club.officeId),
    approved ? clubMeetingPattern(club.id, user) : Promise.resolve([] as string[]),
    approved ? renewedThisYear(club.id) : Promise.resolve(null),
    // A student's request to bring a retired club back (lib/domain/clubs requestClubRevival).
    retired && canAskToRevive(user) ? openRevivalRequest(club.id) : Promise.resolve(null),
  ]);
  const links = readSocialLinks(club.socialLinks);
  const subscribed = Boolean(states?.get(club.id)?.subscribed);
  const autoRegister = approved && Boolean(user) && sp.register === "1";
  const officeLine = [office.email, office.phone].filter((x): x is string => Boolean(x));

  const details = [
    { label: "Club type", value: <span title={CLUB_TYPE_HINT[club.type]}>{CLUB_TYPE_LABEL[club.type]}</span> },
    ...(club.category ? [{ label: "Category", value: CLUB_CATEGORY_LABEL[club.category] }] : []),
    ...(meets.length
      ? [
          {
            label: "Meets",
            value: (
              <ul className="space-y-0.5">
                {meets.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
    { label: club.scope === "COLLEGE" ? "College" : "Where", value: club.scope === "COLLEGE" && club.college ? club.college.name : CLUB_SCOPE_LABEL[club.scope] },
    ...(club.department ? [{ label: "Department", value: club.department.name }] : []),
    ...(club.focusMajor || club.focusOther ? [{ label: "Focus", value: club.focusMajor?.name ?? club.focusOther }] : []),
    { label: "Joining", value: JOIN_POLICY_LABEL[club.joinPolicy] },
    ...(club.contactEmail
      ? [
          {
            label: "Contact",
            value: (
              <a href={`mailto:${club.contactEmail}`} className="inline-flex items-center gap-1 break-all text-brand-600 hover:underline">
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {club.contactEmail}
              </a>
            ),
          },
        ]
      : []),
    ...(club.websiteUrl || links.length
      ? [
          {
            label: "Online",
            value: (
              <ul className="space-y-0.5">
                {club.websiteUrl ? (
                  <li>
                    <a href={club.websiteUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-600 hover:underline">
                      Website
                    </a>
                  </li>
                ) : null}
                {links.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-600 hover:underline">
                      {SOCIAL_LABEL[l.platform]}
                    </a>
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
    {
      label: "Overseen by",
      value: (
        <>
          <span className="font-medium text-ink">{office.name}</span>
          {officeLine.length ? (
            <span className="mt-0.5 block text-ink-3">
              {office.email ? (
                <a href={`mailto:${office.email}`} className="break-all text-brand-600 hover:underline">
                  {office.email}
                </a>
              ) : null}
              {office.email && office.phone ? " · " : null}
              {office.phone ? (
                <a href={`tel:${office.phone.replace(/[^\d+]/g, "")}`} className="whitespace-nowrap text-brand-600 hover:underline">
                  {office.phone}
                </a>
              ) : null}
            </span>
          ) : null}
        </>
      ),
    },
    {
      label: approved || retired ? "Approved" : "Started",
      value: (
        <>
          {fmtLongDate(club.approvedAt ?? club.createdAt)}
          {/* The yearly renewal (lib/domain/renewals), only once the club has renewed for this academic year. */}
          {renewal ? (
            <span className="mt-0.5 flex items-center gap-1 text-ink-3" title={`Renewed with ${office.name} on ${fmtLongDate(renewal.at)}`}>
              <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" /> Re-registered {renewal.year}
            </span>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <AppPromptProvider enabled={promptForApp}>
      <ClubHero club={club} access={access} signedIn={Boolean(user)} subscribed={subscribed} metrics={metrics} autoRegister={autoRegister} />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {retired ? (
          <Callout tone="info" icon={<Archive />} title={`${club.name} is retired`} className="mb-8">
            It wound down{club.retiredAt ? ` on ${fmtLongDate(club.retiredAt)}` : ""}. Its history, officers and documents stay here for the record. Want to bring it back?{" "}
            {canAskToRevive(user) ? (
              revival ? (
                revival.createdById === user!.id ? (
                  <>You asked to bring it back, and {office.name} will let you know what they decide.</>
                ) : (
                  <>Someone already asked to bring it back, and {office.name} is deciding.</>
                )
              ) : (
                <>
                  Ask {office.name}: if they approve, it&apos;s reinstated and you become its President.
                  <span className="mt-3 block">
                    <AskToReviveDialog clubId={club.id} clubName={club.name} office={office.name} />
                  </span>
                </>
              )
            ) : (
              <>
                Contact{" "}
                {office.email ? (
                  <a href={`mailto:${office.email}`} className="font-medium underline underline-offset-2">
                    {office.name}
                  </a>
                ) : (
                  <span className="font-medium">{office.name}</span>
                )}
                .
              </>
            )}
          </Callout>
        ) : null}
        {!isPublic ? (
          <Callout tone="warning" icon={<Hammer />} title="This club is still being founded" className="mb-8">
            Only its founding team, advisor and {office.name} can see this page{club.listedAsForming ? " (other students see a short forming page)" : ""}. It goes public once {office.name} approves the club.{" "}
            {access?.isLeader ? (
              <>
                <Link href={`/clubs/${club.slug}/manage`} className="font-medium underline underline-offset-2">
                  Continue setting it up
                </Link>
                .
              </>
            ) : (
              "Once a founder gives you a seat on the org chart, you can help set it up from its workspace."
            )}
          </Callout>
        ) : null}

        {/* Phones: your attendance (and the live check-in prompt) first, then the page, then details.
            Desktop: page on the left; attendance above the details on the right. */}
        <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] lg:gap-y-0 xl:grid-cols-[minmax(0,1fr)_22rem]">
          {user && isPublic ? (
            <div className="min-w-0 space-y-4 empty:hidden lg:col-start-2 lg:row-start-1 lg:pb-8">
              <OpenElectionsNotice clubId={club.id} />
              <ClubAttendanceRecord clubId={club.id} userId={user.id} />
            </div>
          ) : null}
          <div className="min-w-0 space-y-10 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <PageSection id="about" title={`About ${club.name}`}>
              {club.descriptionHtml ? (
                <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
                  <RichContent html={club.descriptionHtml} />
                </div>
              ) : (
                <p className="rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface px-5 py-6 text-sm text-ink-3">
                  {club.name} hasn&rsquo;t written an about section yet.
                  {access?.capabilities.has("profile") ? (
                    <>
                      {" "}
                      <Link href={`/clubs/${club.slug}/manage/profile`} className="font-medium text-brand-600 hover:underline">
                        Add one in the club profile
                      </Link>
                      .
                    </>
                  ) : null}
                </p>
              )}
            </PageSection>

            {isPublic ? (
              <PageSection
                id="events"
                title="Coming up"
                action={
                  // The club's own calendar is in the hero; /calendar isn't filtered to this club.
                  <Link href="#club-calendar" className="text-sm font-medium text-brand-600 hover:underline">
                    Full calendar
                  </Link>
                }
              >
                {events.length ? (
                  <EventList events={events} showHost={false} clubId={club.id} />
                ) : (
                  <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface px-5 py-6 text-sm text-ink-3">
                    <CalendarX2 className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <span>{retired ? "This club no longer holds events." : "Nothing on the calendar right now. Follow the club to hear when something's scheduled."}</span>
                  </div>
                )}
                {!user && events.length ? <p className="mt-2 text-xs text-ink-3">Some events are for Weber State students or members only — sign in to see everything you can attend.</p> : null}
              </PageSection>
            ) : null}

            {isPublic ? (
              <PageSection id="stats" title="By the numbers">
                <ClubStats clubId={club.id} clubName={club.name} retired={retired} />
              </PageSection>
            ) : null}

            <PageSection
              id="org-chart"
              title={retired ? "Who ran the club" : "Who runs the club"}
              action={
                <Link href={`/clubs/${club.slug}/history`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
                  <History className="h-4 w-4" aria-hidden="true" /> Role history
                </Link>
              }
            >
              <OrgChart clubId={club.id} />
            </PageSection>

            {announcementCount > 0 ? (
              <PageSection id="announcements" title="Announcements">
                <ClubAnnouncements clubId={club.id} />
              </PageSection>
            ) : null}

            {isPublic ? (
              <PageSection id="reviews" title="Reviews">
                <ClubReviews clubId={club.id} clubSlug={club.slug} />
              </PageSection>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-8 lg:col-start-2 lg:row-start-2" aria-label="About this club">
            <PageSection id="details" title="Club details">
              <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
                <KeyValue items={details} className="sm:grid-cols-1" />
              </div>
            </PageSection>

            <PageSection id="resources" title="Resources">
              <ClubResources clubId={club.id} clubSlug={club.slug} viewer={user} canManageFiles={Boolean(access?.capabilities.has("files"))} />
            </PageSection>

            {approved && !member ? <PolicyNotices placement="MEMBERSHIP" title="Before you join" /> : null}
          </aside>
        </div>
      </div>
    </AppPromptProvider>
  );
}
