import Link from "next/link";
import { ChevronRight, QrCode, Star } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/time";
import { memberClubSummary } from "@/lib/metrics";
import { liveOccurrencesForUserId } from "@/lib/domain/attendance";
import { pct } from "@/lib/attendance/matrix";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { LiveCheckinPrompt } from "@/components/attendance/LiveCheckinPrompt";

/**
 * CONTRACT (owner: attendance builder). Server component: one person's
 * attendance in one club (events attended, rate, active status, review
 * eligibility progress). Shown on the club page to the signed-in member.
 *
 * Also shows the "check-in is open — are you here?" prompt while one of the
 * club's events is on (showLivePrompt={false} leaves it out). Renders nothing
 * for people with no connection to the club (not a member or pending, never
 * attended, nothing live). Numbers come from lib/metrics.
 */
export async function ClubAttendanceRecord({ clubId, userId, showLivePrompt = true, className }: { clubId: string; userId: string; showLivePrompt?: boolean; className?: string }) {
  const [membership, summary, live] = await Promise.all([
    db.membership.findUnique({ where: { userId_clubId: { userId, clubId } }, select: { status: true } }),
    memberClubSummary(userId, clubId),
    showLivePrompt ? liveOccurrencesForUserId(userId, { clubId }) : Promise.resolve([]),
  ]);
  const isMember = membership?.status === "ACTIVE";
  if (!isMember && membership?.status !== "PENDING" && summary.attended === 0 && live.length === 0) return null;
  const required = summary.reviewThreshold;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Always mounted, so its "You're checked in!" card survives the refresh that empties `live`. */}
      <LiveCheckinPrompt occurrences={live} />
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Your attendance</h2>
          <Link href={`/me/involvement?club=${clubId}#history`} className="flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:underline">
            Full record <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>

        {summary.attended === 0 ? (
          <p className="mt-2 flex items-start gap-2 text-sm text-ink-2">
            <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            You haven&apos;t checked in to an event yet. Scan the QR code at the next meeting.
          </p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/60 px-2 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-ink-3">Events</dt>
                <dd className="text-lg font-semibold text-ink">{summary.attended}</dd>
              </div>
              <div className="rounded-lg bg-muted/60 px-2 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-ink-3">Rate</dt>
                <dd className="text-lg font-semibold text-ink" title={summary.heldSinceJoined ? `${summary.attended} of ${summary.heldSinceJoined} events since you got involved` : undefined}>
                  {isMember ? pct(summary.rate) : "—"}
                </dd>
              </div>
              <div className="flex flex-col items-center justify-center rounded-lg bg-muted/60 px-2 py-2">
                <dt className="sr-only">Status</dt>
                <dd>{isMember ? summary.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Not active</Badge> : <Badge tone="neutral">Guest</Badge>}</dd>
              </div>
            </dl>
            {summary.lastAttendedAt ? <p className="mt-3 text-xs text-ink-3">Last event {fmtDate(summary.lastAttendedAt, "EEE, MMM d")}</p> : null}
          </>
        )}

        {/* Alumni and faculty/staff can't review, so they get no progress toward one. */}
        {summary.canReview ? (
          <div className="mt-3 border-t border-line pt-3">
            {summary.reviewEligible ? (
              <a href="#reviews" className="flex items-center gap-2 text-sm font-medium text-brand-600 hover:underline">
                <Star className="h-4 w-4" aria-hidden /> You can leave a review
              </a>
            ) : (
              <>
                <p className="text-xs text-ink-2">
                  {summary.attended} of {required} events toward leaving a review
                </p>
                <ProgressBar value={summary.attended} max={required} className="mt-1.5" />
              </>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
