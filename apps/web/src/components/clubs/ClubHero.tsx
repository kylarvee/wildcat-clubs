import Link from "next/link";
import { ChevronRight, GraduationCap, MessageSquare, Settings2, Target, Users } from "lucide-react";
import type { ClubRow } from "@/lib/clubs/context";
import type { ClubAccess } from "@/lib/authz";
import type { ClubMetricsView } from "@/lib/clubs/queries";
import { CalendarView } from "@/components/calendar/CalendarView";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Stars } from "@/components/ui/misc";
import { CLUB_SCOPE_LABEL, CLUB_TYPE_HINT, CLUB_TYPE_LABEL, CLUB_TYPE_TONE, safeHex } from "@/components/clubs/labels";
import { ClubStatusBadge } from "@/components/clubs/ClubCard";
import { MemberMenu, RegisterButton, SubscribeToggle } from "@/components/clubs/MembershipControls";

/**
 * The club page hero: who the club is, how to join, and its calendar.
 * Signed-out visitors register through log-in and come back with ?register=1.
 */
export function ClubHero({
  club,
  access,
  signedIn,
  subscribed,
  metrics,
  autoRegister,
}: {
  club: ClubRow;
  access: ClubAccess | null;
  signedIn: boolean;
  subscribed: boolean;
  metrics: ClubMetricsView & { hasMetrics: boolean };
  autoRegister: boolean;
}) {
  const color = safeHex(club.logoColor);
  const approved = club.status === "APPROVED";
  const showCalendar = club.status === "APPROVED" || club.status === "RETIRED";
  const member = Boolean(access?.isMember);
  const pending = Boolean(access?.isPendingMember);
  const leader = Boolean(access?.isLeader);
  const placement = club.scope === "COLLEGE" && club.college ? club.college.name : CLUB_SCOPE_LABEL[club.scope];
  const focus = club.focusMajor?.name ?? club.focusOther;

  return (
    <section
      aria-labelledby="club-name"
      className="relative overflow-hidden border-b border-line"
      style={{ backgroundImage: `radial-gradient(1200px 400px at 0% 0%, ${color}1f, transparent 70%), linear-gradient(180deg, #ffffff, var(--color-canvas))` }}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} aria-hidden="true" />
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-5 sm:px-6 lg:pb-10">
        <nav aria-label="Breadcrumb" className="mb-5 flex items-center gap-1 text-sm text-ink-3">
          <Link href="/clubs" className="hover:text-ink">
            Clubs
          </Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="truncate text-ink-2">{club.name}</span>
        </nav>

        <div className={showCalendar ? "grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start" : ""}>
          <div className="min-w-0">
            <div className="flex items-start gap-4 sm:gap-5">
              <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="xl" className="h-20 w-20 text-2xl sm:h-24 sm:w-24 sm:text-3xl" />
              <div className="min-w-0 pt-1">
                <h1 id="club-name" className="text-2xl font-bold leading-tight tracking-tight text-ink text-balance sm:text-4xl">
                  {club.name}
                </h1>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Badge tone={CLUB_TYPE_TONE[club.type]} title={CLUB_TYPE_HINT[club.type]}>
                    {CLUB_TYPE_LABEL[club.type]}
                  </Badge>
                  <ClubStatusBadge club={{ status: club.status, metrics, hasMetrics: metrics.hasMetrics }} />
                  {club.joinPolicy === "APPROVAL" && approved ? <Badge>Leaders approve new members</Badge> : null}
                </div>
              </div>
            </div>

            {club.shortDescription ? <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-2 text-pretty">{club.shortDescription}</p> : null}

            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
              <li className="flex items-start gap-1.5">
                <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                <span>
                  {placement}
                  {club.department ? <span className="text-ink-3"> · {club.department.name}</span> : null}
                </span>
              </li>
              {focus ? (
                <li className="flex items-center gap-1.5">
                  <Target className="h-4 w-4 text-ink-3" aria-hidden="true" />
                  {focus}
                </li>
              ) : null}
              {metrics.hasMetrics ? (
                <li className="flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-ink-3" aria-hidden="true" />
                  {metrics.registeredMembers.toLocaleString("en-US")} {metrics.registeredMembers === 1 ? "member" : "members"}
                </li>
              ) : null}
              {metrics.reviewCount > 0 && metrics.avgRating != null ? (
                <li>
                  <a href="#reviews" className="flex items-center gap-1.5 hover:text-ink">
                    <Stars value={metrics.avgRating} size={14} />
                    <span className="font-medium text-ink">{metrics.avgRating.toFixed(1)}</span>
                    <span className="text-ink-3">
                      ({metrics.reviewCount} {metrics.reviewCount === 1 ? "review" : "reviews"})
                    </span>
                  </a>
                </li>
              ) : null}
            </ul>

            {approved || leader ? (
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {approved ? (
                  <RegisterButton
                    clubId={club.id}
                    clubName={club.name}
                    slug={club.slug}
                    gated={club.joinPolicy === "APPROVAL"}
                    member={member}
                    pending={pending}
                    signedIn={signedIn}
                    autoRegister={autoRegister}
                    size="lg"
                  />
                ) : null}
                {leader ? (
                  <ButtonLink href={`/clubs/${club.slug}/manage`} variant="outline" size="lg">
                    <Settings2 className="h-4 w-4" aria-hidden="true" /> Manage club
                  </ButtonLink>
                ) : null}
                {approved && (member || (leader && !access?.viaPlatform)) ? (
                  <ButtonLink href={`/messages/club/${club.slug}`} variant="outline" size="lg">
                    <MessageSquare className="h-4 w-4" aria-hidden="true" /> Club chat
                  </ButtonLink>
                ) : null}
                {approved ? <MemberMenu clubId={club.id} clubName={club.name} member={member} pending={pending} /> : null}
              </div>
            ) : null}
            {approved ? (
              <SubscribeToggle variant="switch" clubId={club.id} clubName={club.name} slug={club.slug} subscribed={subscribed} signedIn={signedIn} className="mt-4 max-w-md" />
            ) : null}
            {approved && !signedIn ? (
              <p className="mt-3 text-sm text-ink-3">Registering asks you to log in with your Weber State account first — then you&rsquo;re straight back here.</p>
            ) : null}
          </div>

          {showCalendar ? (
            <div className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-card)] sm:p-4">
              <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
                <h2 className="text-sm font-semibold text-ink">Calendar</h2>
                <span className="text-xs text-ink-3">{signedIn ? "Events you can see, in campus time" : "Public events, in campus time"}</span>
              </div>
              <CalendarView
                source={{ scope: "club", clubId: club.id }}
                compact
                height={380}
                emptyMessage={`Nothing on ${club.name}'s calendar in this stretch.`}
                // Joining unlocks members-only events, so reload when membership changes.
                refreshKey={`${member}-${pending}-${subscribed}`}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
