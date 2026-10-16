import Link from "next/link";
import { Activity, Lock, Repeat, Users } from "lucide-react";
import type { ClubListItem, ViewerClubState } from "@/lib/clubs/queries";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Stars } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";
import { CLUB_TYPE_HINT, CLUB_TYPE_LABEL, CLUB_TYPE_TONE, pct, safeHex } from "@/components/clubs/labels";
import { RegisterButton, SubscribeToggle } from "@/components/clubs/MembershipControls";

/** Pilot / inactive / retired badge. Shows nothing until the metrics layer has numbers for the club. */
export function ClubStatusBadge({ club }: { club: Pick<ClubListItem, "status" | "metrics" | "hasMetrics"> }) {
  if (club.status === "RETIRED") return <Badge>Retired</Badge>;
  if (!club.hasMetrics) return null;
  if (club.metrics.inPilot)
    return (
      <Badge tone="info" title="New clubs count as active through their first full semester">
        Pilot
      </Badge>
    );
  if (!club.metrics.isActive)
    return (
      <Badge tone="warning" title="Fewer events or members this term than an active club needs">
        Inactive
      </Badge>
    );
  return null;
}

export function RatingInline({ avg, count, size = 14 }: { avg: number | null; count: number; size?: number }) {
  if (!count || avg == null) return <span className="text-ink-3">No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Stars value={avg} size={size} />
      <span className="font-medium tabular-nums text-ink" aria-hidden="true">
        {avg.toFixed(1)}
      </span>
      <span className="text-ink-3">
        ({count}
        <span className="sr-only"> {count === 1 ? "review" : "reviews"}</span>)
      </span>
    </span>
  );
}

/** A club in the grid: identity, what it's about, and its numbers. Signed-in viewers get Register / Subscribe. */
export function ClubCard({ club, state, signedIn, showActions = true }: { club: ClubListItem; state?: ViewerClubState; signedIn: boolean; showActions?: boolean }) {
  const color = safeHex(club.logoColor);
  const actionable = showActions && signedIn && club.status === "APPROVED";
  const m = club.metrics;
  return (
    <article className="group relative flex w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[var(--shadow-pop)]">
      <div className="h-1.5" style={{ backgroundColor: color }} aria-hidden="true" />
      <div className="flex items-start gap-3 px-4 pt-4">
        <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="md" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug text-ink">
            {/* Stretched link: the whole card opens the club; buttons below sit above it. */}
            <Link
              href={`/clubs/${club.slug}`}
              className="after:absolute after:inset-0 after:rounded-[var(--radius-card)] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-brand group-hover:text-brand"
            >
              {club.name}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-xs text-ink-3">
            {club.placement}
            {club.focus ? ` · ${club.focus}` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        <Badge tone={CLUB_TYPE_TONE[club.type]} title={CLUB_TYPE_HINT[club.type]}>
          {CLUB_TYPE_LABEL[club.type]}
        </Badge>
        <ClubStatusBadge club={club} />
        {club.joinPolicy === "APPROVAL" && club.status === "APPROVED" ? (
          <Badge title="Club leaders approve new members">
            <Lock className="h-3 w-3" aria-hidden="true" /> Approval to join
          </Badge>
        ) : null}
      </div>
      <p className="line-clamp-3 flex-1 px-4 pt-2.5 text-sm leading-relaxed text-ink-2">{club.shortDescription || <span className="text-ink-3">This club hasn&rsquo;t added a description yet.</span>}</p>
      <p className="px-4 pt-3 text-sm">
        <RatingInline avg={m.avgRating} count={m.reviewCount} size={14} />
      </p>
      <dl className="mx-4 mt-3 grid grid-cols-3 gap-2 border-t border-line py-3 text-xs">
        <div className="min-w-0">
          <dt className="flex items-center gap-1 text-ink-3">
            <Users className="h-3.5 w-3.5" aria-hidden="true" /> Active
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink" title={`${m.registeredMembers} registered members`}>
            {m.activeMembers.toLocaleString("en-US")}
            <span className="sr-only"> active members of {m.registeredMembers} registered</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1 text-ink-3">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Events
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink" title="Events in the last 30 days and the next 30 days">
            {m.activityScore.toLocaleString("en-US")}
            <span className="sr-only"> in the last and next 30 days</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1 text-ink-3">
            <Repeat className="h-3.5 w-3.5" aria-hidden="true" /> Retention
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink" title="Last month's attendees who came back">
            {pct(m.retentionRate)}
          </dd>
        </div>
      </dl>
      {actionable ? (
        <div className={cn("relative z-10 flex flex-wrap items-center gap-2 px-4 pb-4")}>
          <RegisterButton
            clubId={club.id}
            clubName={club.name}
            slug={club.slug}
            gated={club.joinPolicy === "APPROVAL"}
            member={Boolean(state?.member)}
            pending={Boolean(state?.pending)}
            signedIn={signedIn}
            size="sm"
          />
          <SubscribeToggle clubId={club.id} clubName={club.name} slug={club.slug} subscribed={Boolean(state?.subscribed)} signedIn={signedIn} />
        </div>
      ) : null}
    </article>
  );
}
