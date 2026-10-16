import Link from "next/link";
import { EyeOff, Flag, MessageSquareText, ShieldCheck, Star } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/authz";
import { getClubBySlug } from "@/lib/clubs/context";
import { clubReviewsData, type ReviewView } from "@/lib/clubs/queries";
import { getConfig } from "@/lib/config";
import { reviewEligibility } from "@/lib/metrics";
import { fmtLongDate } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Callout, ProgressBar } from "@/components/ui/layout";
import { Stars } from "@/components/ui/misc";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { MyReview, ReportReviewButton, ReviewForm } from "@/components/reviews/ReviewControls";

/**
 * CONTRACT (owner: public-site builder). Server component: rating summary,
 * reviews list, and — for eligible signed-in students — the review form.
 * Writes go through lib/domain/reviews (writeReview / deleteReview / flagReview).
 */

const SHOWN_FIRST = 5;

export async function ClubReviews({ clubId, clubSlug }: { clubId: string; clubSlug: string }) {
  const [club, viewer, cfg] = await Promise.all([getClubBySlug(clubSlug), getCurrentUser(), getConfig()]);
  if (!club || club.id !== clubId) return null;

  const admin = isAdmin(viewer);
  const required = cfg["reviews.minAttendance"];
  const student = viewer?.kind === "STUDENT" && viewer.status === "ACTIVE";
  const open = club.status === "APPROVED";
  const [data, gate] = await Promise.all([clubReviewsData(clubId, viewer), student && open && viewer ? reviewEligibility(viewer.id, clubId) : Promise.resolve(null)]);

  const others = data.reviews.filter((r) => !r.mine);
  const first = others.slice(0, SHOWN_FIRST);
  const rest = others.slice(SHOWN_FIRST);
  const flaggedCount = admin ? others.filter((r) => r.flagCount > 0 && !r.hidden).length : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <RatingSummary average={data.average} count={data.visibleCount} distribution={data.distribution} />

      <div className="min-w-0 space-y-5">
        {/* The write area: who may review, and how close they are. */}
        {data.mine ? (
          <div className="rounded-[var(--radius-card)] border border-brand-100 bg-brand-50/50 p-4">
            <p className="mb-3 text-sm font-semibold text-brand-700">Your review</p>
            {data.mine.hidden ? (
              <Callout tone="warning" className="mb-3" title="WSUSA admins hid your review">
                {data.mine.hiddenReason ?? "It didn't meet the review policy."} Other students can&rsquo;t see it. Editing it won&rsquo;t make it visible again.
              </Callout>
            ) : null}
            {open && student ? (
              <MyReview clubId={club.id} clubName={club.name} review={{ id: data.mine.id, rating: data.mine.rating, body: data.mine.body }}>
                <ReviewBody review={data.mine} signedIn />
              </MyReview>
            ) : (
              <ReviewBody review={data.mine} signedIn />
            )}
          </div>
        ) : !viewer ? (
          open ? (
            <Callout tone="brand" icon={<MessageSquareText />} title="Been to a few meetings?">
              Students who&rsquo;ve checked in at {required} or more {club.name} events can leave a review.{" "}
              <Link href={`/login?next=${encodeURIComponent(`/clubs/${club.slug}#reviews`)}`} className="font-medium underline underline-offset-2">
                Log in
              </Link>{" "}
              to see if you can.
            </Callout>
          ) : null
        ) : !open ? (
          <p className="text-sm text-ink-3">Reviews are closed because this club is retired.</p>
        ) : !student ? (
          <p className="flex items-center gap-2 text-sm text-ink-3">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {viewer.status !== "ACTIVE" ? "Alumni accounts can read reviews but can't write new ones." : "Reviews come from students who attend the club's events."}
          </p>
        ) : gate && !gate.eligible ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            {(() => {
              const attended = Math.min(gate.attended, required);
              const left = Math.max(1, required - gate.attended);
              return (
                <>
                  <p className="font-medium text-ink">
                    Attend {left} more {left === 1 ? "event" : "events"} to review {club.name}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-3">
                    Reviews unlock after {required} check-ins, so every review comes from someone who&rsquo;s actually been. You&rsquo;re at {attended} of {required}.
                  </p>
                  <ProgressBar value={attended} max={required} className="mt-3" />
                </>
              );
            })()}
          </div>
        ) : (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
            <p className="mb-3 font-semibold text-ink">Review {club.name}</p>
            <ReviewForm clubId={club.id} clubName={club.name} />
          </div>
        )}
        {viewer && student && open && (data.mine || gate?.eligible) ? <PolicyNotices placement="REVIEWS" title="Review policy" /> : null}

        {admin ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line-2 px-3 py-2 text-sm text-ink-2">
            <ShieldCheck className="h-4 w-4 text-brand" aria-hidden="true" />
            You see hidden reviews and report counts because you&rsquo;re an admin.
            {flaggedCount ? <Badge tone="warning">{flaggedCount} reported</Badge> : null}
            <Link href={`/admin/reviews?club=${club.id}`} className="ml-auto font-medium text-brand-600 hover:underline">
              Moderate reviews
            </Link>
          </div>
        ) : null}

        {others.length === 0 ? (
          data.mine ? null : (
            <div className="rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface px-4 py-8 text-center">
              <Star className="mx-auto h-7 w-7 text-line-2" aria-hidden="true" />
              <p className="mt-2 font-medium text-ink">No reviews yet</p>
              <p className="mt-1 text-sm text-ink-3">Reviews show up here once students who&rsquo;ve attended {required} events share how it went.</p>
            </div>
          )
        ) : (
          <div>
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface px-4 shadow-[var(--shadow-card)]" aria-label="Reviews">
              {first.map((r) => (
                <ReviewItem key={r.id} review={r} signedIn={Boolean(viewer)} admin={admin} />
              ))}
            </ul>
            {rest.length ? (
              <details className="group mt-3">
                <summary className={buttonClasses("outline", "sm", "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
                  <span className="group-open:hidden">Show all {others.length} reviews</span>
                  <span className="hidden group-open:inline">Show fewer</span>
                </summary>
                <ul className="mt-3 divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface px-4 shadow-[var(--shadow-card)]">
                  {rest.map((r) => (
                    <ReviewItem key={r.id} review={r} signedIn={Boolean(viewer)} admin={admin} />
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function RatingSummary({ average, count, distribution }: { average: number | null; count: number; distribution: Record<1 | 2 | 3 | 4 | 5, number> }) {
  return (
    <div className="h-fit rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
      {count > 0 && average != null ? (
        <>
          <p className="text-5xl font-bold tracking-tight text-ink">{average.toFixed(1)}</p>
          <Stars value={average} size={18} className="mt-1" />
          <p className="mt-1 text-sm text-ink-3">
            from {count} {count === 1 ? "review" : "reviews"}
          </p>
        </>
      ) : (
        <>
          <p className="text-lg font-semibold text-ink">Not rated yet</p>
          <p className="mt-1 text-sm text-ink-3">Be one of the first to share how it went.</p>
        </>
      )}
      <ul className="mt-4 space-y-1.5" aria-label="Rating breakdown">
        {([5, 4, 3, 2, 1] as const).map((n) => {
          const c = distribution[n];
          const share = count ? c / count : 0;
          return (
            <li key={n} className="flex items-center gap-2 text-xs">
              <span className="flex w-7 shrink-0 items-center gap-0.5 tabular-nums text-ink-2" aria-hidden="true">
                {n}
                <Star className="h-3 w-3 text-amber-400" fill="currentColor" strokeWidth={0} />
              </span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span className="absolute inset-y-0 left-0 rounded-full bg-amber-400" style={{ width: `${share * 100}%` }} />
              </span>
              <span className="w-6 shrink-0 text-right tabular-nums text-ink-3" aria-hidden="true">
                {c}
              </span>
              <span className="sr-only">
                {n} {n === 1 ? "star" : "stars"}: {c} {c === 1 ? "review" : "reviews"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReviewBody({ review, signedIn }: { review: ReviewView; signedIn: boolean }) {
  const edited = review.updatedAt.getTime() - review.createdAt.getTime() > 60_000;
  return (
    <div className="flex items-start gap-3">
      {signedIn ? <Avatar name={review.author.name} src={review.author.avatarUrl} color={review.author.avatarColor} size="sm" /> : <Avatar name="W" color="#77707f" size="sm" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {signedIn ? (
            <Link href={`/u/${review.author.handle}`} className="text-sm font-semibold text-ink hover:underline">
              {review.author.name}
            </Link>
          ) : (
            // Profiles are for signed-in university accounts only.
            <span className="text-sm font-semibold text-ink">A Weber State student</span>
          )}
          {review.author.alumni ? <Badge>Alum</Badge> : null}
          <Stars value={review.rating} size={14} />
          <span className="text-xs text-ink-3">
            <time dateTime={review.createdAt.toISOString()}>{fmtLongDate(review.createdAt)}</time>
            {edited ? " · edited" : ""}
          </span>
        </div>
        {review.body ? <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{review.body}</p> : null}
      </div>
    </div>
  );
}

function ReviewItem({ review, signedIn, admin }: { review: ReviewView; signedIn: boolean; admin: boolean }) {
  return (
    <li className={review.hidden ? "py-4 opacity-70" : "py-4"}>
      <ReviewBody review={review} signedIn={signedIn} />
      {admin && (review.hidden || review.flagCount > 0) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-11 text-xs">
          {review.hidden ? (
            <Badge tone="neutral">
              <EyeOff className="h-3 w-3" aria-hidden="true" /> Hidden{review.hiddenReason ? `: ${review.hiddenReason}` : ""}
            </Badge>
          ) : null}
          {review.flagCount > 0 ? (
            <Badge tone="warning">
              <Flag className="h-3 w-3" aria-hidden="true" /> {review.flagCount} {review.flagCount === 1 ? "report" : "reports"}
            </Badge>
          ) : null}
        </div>
      ) : null}
      {signedIn && !review.hidden ? (
        <div className="mt-1 flex justify-end">
          <ReportReviewButton reviewId={review.id} reported={review.flaggedByViewer} />
        </div>
      ) : null}
    </li>
  );
}
