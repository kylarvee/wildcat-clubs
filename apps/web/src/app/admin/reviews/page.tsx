import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { Flag, ShieldCheck, Star, X } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { DAY_MS, fmtAgo, fmtDate, fmtLongDate, fmtTime } from "@/lib/time";
import { Avatar, ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Stars } from "@/components/ui/misc";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import type { ColumnDatum } from "@/components/clubs/ColumnChart";
import { LowRatingsChart } from "@/components/admin/reviews/LowRatingsChart";
import { FilterSelect } from "@/components/admin/Filters";
import { CloseCheckButton, HideReviewButton, KeepReviewButton, RestoreReviewButton } from "@/components/admin/reviews/ModerationButtons";

export const metadata: Metadata = { title: "Review moderation" };

const TABS = [
  { key: "reported", label: "Flagged" },
  { key: "bombing", label: "Possible review bombing" },
  { key: "hidden", label: "Hidden" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TIMELINE_DAYS = 14;

const reviewInclude = {
  user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true, status: true } },
  club: { select: { id: true, name: true, slug: true, logoUrl: true, logoColor: true } },
  flags: { orderBy: { createdAt: "desc" }, select: { id: true, reason: true, createdAt: true, user: { select: { id: true, name: true } } } },
} satisfies Prisma.ReviewInclude;
type ReviewRow = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>;

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Review moderation (admin.reviews): flagged reviews, possible review
 * bombing, and hidden reviews. Every change goes through lib/domain/reviews,
 * which also closes the matching admin tasks.
 */
export default async function AdminReviewsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser("/admin/reviews");
  if (!can(user, "admin.reviews")) notFound();
  const sp = await searchParams;
  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || null;
  };
  const clubId = str("club");
  const reviewId = str("review");
  const clubFilter: Prisma.ReviewWhereInput = clubId ? { clubId } : {};

  const [reportedCount, hiddenCount, bombingTasks, clubsWithReviews, focus] = await Promise.all([
    db.review.count({ where: { hiddenAt: null, flags: { some: {} }, ...clubFilter } }),
    db.review.count({ where: { hiddenAt: { not: null }, ...clubFilter } }),
    db.task.findMany({
      where: { sourceType: "reviewBombing", status: "OPEN", ...(clubId ? { sourceId: clubId } : {}) },
      orderBy: { createdAt: "asc" },
      select: { id: true, sourceId: true, description: true, createdAt: true },
    }),
    db.club.findMany({ where: { reviews: { some: {} } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    reviewId ? db.review.findUnique({ where: { id: reviewId }, select: { hiddenAt: true, flags: { select: { id: true }, take: 1 } } }) : null,
  ]);

  // Task links say ?club= (bombing) or ?club=&review= (a report); land on the tab that holds them.
  const requested = TABS.find((t) => t.key === str("tab"))?.key;
  const tab: TabKey = requested ?? (focus ? (focus.hiddenAt ? "hidden" : "reported") : clubId && bombingTasks.length ? "bombing" : "reported");
  const counts: Record<TabKey, number> = { reported: reportedCount, bombing: bombingTasks.length, hidden: hiddenCount };
  const clubName = clubId ? clubsWithReviews.find((c) => c.id === clubId)?.name ?? null : null;
  const tabHref = (key: TabKey) => {
    const q = new URLSearchParams();
    if (key !== "reported") q.set("tab", key);
    if (clubId) q.set("club", clubId);
    const s = q.toString();
    return s ? `/admin/reviews?${s}` : "/admin/reviews";
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Review moderation" description="Reviews students flagged, possible review bombing, and reviews you've hidden. Hidden reviews stop counting toward a club's rating." />
      <PolicyNotices placement="REVIEWS" title="Review policy" />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav className="-mb-px flex min-w-0 max-w-full gap-1 overflow-x-auto border-b border-line" aria-label="Moderation queues">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", tab === t.key ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink")}
            >
              {t.label}
              {counts[t.key] ? <span className="rounded-full bg-brand-50 px-1.5 text-xs text-brand">{counts[t.key]}</span> : null}
            </Link>
          ))}
        </nav>
        <FilterSelect label="Club" param="club" value={clubId} options={clubsWithReviews.map((c) => ({ value: c.id, label: c.name }))} allLabel="All clubs" drop={["review"]} className="w-full sm:w-64" />
      </div>

      {clubId ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          Showing {clubName ?? "one club"} only.
          <Link href={tab === "reported" ? "/admin/reviews" : `/admin/reviews?tab=${tab}`} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
            <X className="h-3.5 w-3.5" aria-hidden /> Show every club
          </Link>
        </p>
      ) : null}

      {tab === "reported" ? <Reported clubFilter={clubFilter} focusId={reviewId} /> : tab === "bombing" ? <Bombing tasks={bombingTasks} clubId={clubId} /> : <Hidden clubFilter={clubFilter} focusId={reviewId} />}
    </div>
  );
}

async function Reported({ clubFilter, focusId }: { clubFilter: Prisma.ReviewWhereInput; focusId: string | null }) {
  const rows = await db.review.findMany({ where: { hiddenAt: null, flags: { some: {} }, ...clubFilter }, include: reviewInclude, take: 200 });
  // Most-flagged first; the review a task pointed at goes to the very top.
  rows.sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId) || b.flags.length - a.flags.length || b.flags[0].createdAt.getTime() - a.flags[0].createdAt.getTime());
  if (!rows.length) return <EmptyState icon={<ShieldCheck />} title="No flagged reviews" description="When students flag a review, it shows up here so you can keep it or hide it." />;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id}>
          <ReviewCard review={r} focused={r.id === focusId}>
            <KeepReviewButton reviewId={r.id} reports={r.flags.length} />
            <HideReviewButton reviewId={r.id} author={r.user.name} clubName={r.club.name} />
          </ReviewCard>
        </li>
      ))}
    </ul>
  );
}

async function Hidden({ clubFilter, focusId }: { clubFilter: Prisma.ReviewWhereInput; focusId: string | null }) {
  const rows = await db.review.findMany({ where: { hiddenAt: { not: null }, ...clubFilter }, include: reviewInclude, orderBy: { hiddenAt: "desc" }, take: 200 });
  rows.sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId));
  if (!rows.length) return <EmptyState icon={<ShieldCheck />} title="No hidden reviews" description="Reviews you hide show up here, with the reason, so you can restore them later." />;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id}>
          <ReviewCard review={r} focused={r.id === focusId}>
            <RestoreReviewButton reviewId={r.id} />
          </ReviewCard>
        </li>
      ))}
    </ul>
  );
}

async function Bombing({ tasks, clubId }: { tasks: { id: string; sourceId: string | null; description: string | null; createdAt: Date }[]; clubId: string | null }) {
  const cfg = await getConfig();
  // A club picked in the filter gets its timeline even without an open check.
  const clubIds = [...new Set([...tasks.map((t) => t.sourceId).filter((x): x is string => Boolean(x)), ...(clubId ? [clubId] : [])])];
  if (!clubIds.length)
    return <EmptyState icon={<ShieldCheck />} title="No possible review bombing" description={`A check opens here when a club gets ${cfg["reviews.bombingCount"]} or more ratings of ${cfg["reviews.bombingMaxRating"]}★ or lower within ${cfg["reviews.bombingWindowHours"]} hours.`} />;

  const since = new Date(Date.now() - TIMELINE_DAYS * DAY_MS);
  const [clubs, reviews, totals] = await Promise.all([
    db.club.findMany({ where: { id: { in: clubIds } }, select: { id: true, name: true, slug: true, logoUrl: true, logoColor: true } }),
    db.review.findMany({ where: { clubId: { in: clubIds }, rating: { lte: cfg["reviews.bombingMaxRating"] }, updatedAt: { gte: since } }, include: reviewInclude, orderBy: { updatedAt: "desc" } }),
    db.review.groupBy({ by: ["clubId"], where: { clubId: { in: clubIds }, updatedAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const totalBy = new Map(totals.map((t) => [t.clubId, t._count._all]));

  return (
    <ul className="space-y-6">
      {clubIds.map((id) => {
        const club = clubs.find((c) => c.id === id);
        if (!club) return null;
        const task = tasks.find((t) => t.sourceId === id) ?? null;
        const low = reviews.filter((r) => r.clubId === id);
        return (
          <li key={id}>
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="sm" />
                  <div className="min-w-0">
                    <h2 className="font-semibold text-ink">
                      <Link href={`/clubs/${club.slug}#reviews`} className="hover:underline">
                        {club.name}
                      </Link>
                    </h2>
                    <p className="text-sm text-ink-3">{task ? `${task.description ?? "Several low ratings arrived quickly."} Flagged ${fmtAgo(task.createdAt)}.` : "No open check for this club. Here are its recent low ratings."}</p>
                  </div>
                </div>
                {task ? <CloseCheckButton clubId={club.id} clubName={club.name} /> : <Badge>No open check</Badge>}
              </div>
              <div className="grid gap-6 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    Low ratings per day <span className="font-normal text-ink-3">· last {TIMELINE_DAYS} days</span>
                  </p>
                  <p className="mb-2 text-xs text-ink-3">
                    {low.length} of {totalBy.get(id) ?? 0} reviews written or edited in that time were {cfg["reviews.bombingMaxRating"]}★ or lower.
                  </p>
                  <LowRatingsChart {...dailyChart(low)} caption={`Ratings of ${cfg["reviews.bombingMaxRating"]} stars or lower per day for ${club.name}, last ${TIMELINE_DAYS} days`} />
                </div>
                <div className="min-w-0">
                  <p className="mb-2 text-sm font-medium text-ink">Timeline</p>
                  {low.length ? (
                    <ol className="space-y-3 border-l-2 border-line pl-4">
                      {low.map((r) => (
                        <li key={r.id} className="relative">
                          <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-surface" aria-hidden />
                          <ReviewSummary review={r} />
                          <div className="mt-2 flex flex-wrap gap-2">{r.hiddenAt ? <RestoreReviewButton reviewId={r.id} /> : <HideReviewButton reviewId={r.id} author={r.user.name} clubName={club.name} />}</div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-ink-3">No low ratings in the last {TIMELINE_DAYS} days.</p>
                  )}
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** One bar per campus day, today drawn lighter because it isn't over yet. */
function dailyChart(reviews: { updatedAt: Date }[]) {
  const counts = new Map<string, number>();
  for (const r of reviews) {
    const k = fmtDate(r.updatedAt, "yyyy-MM-dd");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const now = Date.now();
  const data: ColumnDatum[] = [];
  for (let i = TIMELINE_DAYS - 1; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS);
    const key = fmtDate(day, "yyyy-MM-dd");
    const n = counts.get(key) ?? 0;
    data.push({ key, label: fmtDate(day, "d"), longLabel: fmtDate(day, "EEE, MMM d"), value: n, valueLabel: String(n), partial: i === 0 });
  }
  // Counts are small whole numbers: round the top up to an even number so the middle tick is whole too.
  const peak = Math.max(...data.map((d) => d.value ?? 0));
  const max = Math.max(2, peak <= 10 ? peak + (peak % 2) : Math.ceil(peak / 10) * 10);
  const ticks = [0, max / 2, max];
  return { data, max, ticks };
}

function ReviewSummary({ review }: { review: ReviewRow }) {
  return (
    <div className="min-w-0 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Stars value={review.rating} size={14} />
        <Link href={`/admin/users/${review.user.id}`} className="font-medium text-ink hover:underline">
          {review.user.name}
        </Link>
        <span className="text-xs text-ink-3">
          {fmtDate(review.updatedAt, "MMM d")} · {fmtTime(review.updatedAt)}
        </span>
        {review.hiddenAt ? <Badge tone="neutral">Hidden</Badge> : null}
        {review.flags.length ? (
          <Badge tone="warning">
            <Flag className="h-3 w-3" aria-hidden /> {review.flags.length}
          </Badge>
        ) : null}
      </div>
      {review.body ? <p className="mt-1 whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{review.body}</p> : <p className="mt-1 italic text-ink-3">Rating only, no text.</p>}
    </div>
  );
}

function ReviewCard({ review, focused, children }: { review: ReviewRow; focused: boolean; children: React.ReactNode }) {
  const edited = review.updatedAt.getTime() - review.createdAt.getTime() > 60_000;
  return (
    <Card id={`review-${review.id}`} className={cn("p-4 sm:p-5", focused && "ring-2 ring-brand ring-offset-2")}>
      {focused ? <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand">From your task</p> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ClubLogo name={review.club.name} src={review.club.logoUrl} color={review.club.logoColor} size="sm" />
          <div className="min-w-0">
            <Link href={`/clubs/${review.club.slug}#reviews`} className="font-medium text-ink hover:underline">
              {review.club.name}
            </Link>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <Stars value={review.rating} size={14} />
              <span>
                {fmtLongDate(review.createdAt)}
                {edited ? ` · edited ${fmtLongDate(review.updatedAt)}` : ""}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>

      {review.body ? (
        <p className="mt-3 whitespace-pre-wrap text-sm text-ink [overflow-wrap:anywhere]">{review.body}</p>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-sm italic text-ink-3">
          <Star className="h-3.5 w-3.5" aria-hidden /> Rating only, no text.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <Avatar name={review.user.name} src={review.user.avatarUrl} color={review.user.avatarColor} size="xs" />
        <span className="text-ink-3">Written by</span>
        <Link href={`/admin/users/${review.user.id}`} className="font-medium text-ink hover:underline">
          {review.user.name}
        </Link>
        <span className="break-all text-ink-3">{review.user.email}</span>
        {review.user.status === "ALUMNI" ? <Badge>Alumni</Badge> : null}
        <span className="text-xs text-ink-3">· only administrators see who wrote it</span>
      </div>

      {review.hiddenAt ? (
        <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <p className="font-medium text-ink">Hidden {fmtLongDate(review.hiddenAt)}</p>
          {review.hiddenReason ? <p className="text-ink-2">Reason given to the reviewer: {review.hiddenReason}</p> : null}
        </div>
      ) : null}

      {review.flags.length ? (
        <details className="mt-3 rounded-lg border border-amber-200 bg-warning-50/60 px-3 py-2 text-sm" open={!review.hiddenAt}>
          <summary className="cursor-pointer font-medium text-amber-900">
            <Flag className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            Flagged by {review.flags.length} {review.flags.length === 1 ? "person" : "people"}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {review.flags.map((f) => (
              <li key={f.id} className="text-ink-2">
                <span className="text-ink">“{f.reason}”</span> — {f.user.name}, {fmtLongDate(f.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
