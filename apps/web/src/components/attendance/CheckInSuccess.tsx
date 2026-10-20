"use client";

import Link from "next/link";
import { BadgeCheck, Check, ChevronRight, HandHeart, PartyPopper, Smartphone, Star, UserPlus } from "lucide-react";
import type { CheckInResult } from "@/lib/domain/attendance";
import { METHOD_LABEL } from "@/lib/attendance/rules";
import { earnedMinutes, serviceHoursLabel } from "@/lib/metrics/service";
import { fmtTime } from "@/lib/time";
import { buttonClasses } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";

/**
 * What someone sees right after checking in: the confirmation, what happened
 * with their membership, the service hours it earned, how close they are to
 * leaving a review, and (for people without the app yet) where to get it.
 */
export function CheckInSuccess({
  result,
  showGetApp,
  compact,
  className,
}: {
  result: Pick<CheckInResult, "status" | "method" | "checkedInAt" | "occurrence" | "club" | "membership" | "reviewProgress" | "requirementsMet">;
  /** From shouldPromptForApp (lib/clubs/queries): the app is in a store and this person hasn't got it. */
  showGetApp?: boolean;
  /** Inline version for prompts on other pages. */
  compact?: boolean;
  className?: string;
}) {
  const { club, occurrence } = result;
  // A check-in from the last couple of minutes is "fresh" even when the page
  // re-rendered from the server after the action (it then sees the row as existing).
  const fresh = result.status === "CHECKED_IN" || Date.now() - new Date(result.checkedInAt).getTime() < 120_000;
  const review = result.reviewProgress;
  // The same rule as the involvement record (lib/metrics/service): a check-in here earns the event's service minutes.
  const earned = earnedMinutes(occurrence.serviceMinutes);

  return (
    <div className={cn(compact ? "space-y-3" : "space-y-5", className)} role="status" aria-live="polite">
      <div className={cn(compact ? "flex items-center gap-3" : "text-center")}>
        <div className={cn("flex shrink-0 items-center justify-center rounded-full bg-success-50 ring-8 ring-success-50/60", compact ? "h-10 w-10" : "mx-auto h-16 w-16")}>
          <Check className={cn("text-success", compact ? "h-5 w-5" : "h-9 w-9")} strokeWidth={3} aria-hidden />
        </div>
        <div className={compact ? "min-w-0" : "mt-4"}>
          <p className={cn("font-bold tracking-tight text-ink", compact ? "text-base" : "text-2xl")}>
            {fresh ? "You're checked in!" : "You're already checked in"}
          </p>
          <p className={cn("text-ink-2", compact ? "text-sm" : "mt-1")}>
            {fresh ? "to " : "for "}
            <span className="font-semibold text-ink">{occurrence.title}</span>
            <span className="text-ink-3">
              {" "}
              · {METHOD_LABEL[result.method]} at {fmtTime(result.checkedInAt)}
            </span>
          </p>
        </div>
      </div>

      {club && result.membership === "JOINED" ? (
        <Outcome icon={<PartyPopper />} tone="success" title={`You're now a member of ${club.name}`}>
          Welcome, Wildcat! Their events are on your calendar now.
        </Outcome>
      ) : null}
      {club && result.membership === "REQUESTED" ? (
        <Outcome icon={<UserPlus />} tone="info" title={`Join request sent to ${club.name}'s leaders`}>
          Your check-in still counts. We&apos;ll let you know when they approve your membership.
        </Outcome>
      ) : null}
      {result.requirementsMet.length ? (
        <Outcome icon={<BadgeCheck />} tone="success" title="WSUSA requirement complete">
          This counts for {result.requirementsMet.join(", ")}.
        </Outcome>
      ) : null}
      {earned ? (
        <Outcome icon={<HandHeart />} tone="success" title={fresh ? `+${serviceHoursLabel(earned)}` : `${serviceHoursLabel(earned)} on your record`}>
          {fresh ? "They're on your involvement record now. " : "This check-in already counts toward your service hours. "}
          <Link href="/me/involvement#service" className="font-medium underline underline-offset-2">
            See your hours
          </Link>
        </Outcome>
      ) : null}

      {club && review ? (
        review.eligible ? (
          <Outcome icon={<Star />} tone="brand" title={`You can review ${club.name}`}>
            You&apos;ve been to {review.attended} events.{" "}
            <Link href={`/clubs/${club.slug}#reviews`} className="font-medium underline underline-offset-2">
              Leave a review
            </Link>
          </Outcome>
        ) : (
          <div className="rounded-xl border border-line bg-muted/50 px-4 py-3">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-ink">
                {review.attended} of {review.required} events toward leaving a review
              </span>
              <span className="tabular-nums text-ink-3">{Math.max(0, review.required - review.attended)} to go</span>
            </div>
            <ProgressBar value={review.attended} max={review.required} className="mt-2" />
          </div>
        )
      ) : null}

      {!compact ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {club ? (
            <Link href={`/clubs/${club.slug}`} className={buttonClasses("primary", "lg", "w-full sm:w-auto sm:flex-1")}>
              Go to {club.name.length > 24 ? "the club" : club.name}
            </Link>
          ) : null}
          <Link href="/me/involvement" className={buttonClasses(club ? "outline" : "primary", "lg", "w-full sm:w-auto sm:flex-1")}>
            My involvement
          </Link>
        </div>
      ) : null}

      {showGetApp && !compact ? (
        <Link
          href="/get-the-app"
          className="flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand"
        >
          <Smartphone className="h-6 w-6 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1 text-sm">
            <span className="block font-semibold text-brand-700">Get the app</span>
            <span className="block text-ink-2">Check in with one scan next time, and get reminders before your clubs meet.</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-brand" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function Outcome({ icon, title, tone, children }: { icon: React.ReactNode; title: string; tone: "success" | "info" | "brand"; children: React.ReactNode }) {
  const tones = {
    success: "border-green-200 bg-success-50 text-green-900",
    info: "border-blue-200 bg-info-50 text-blue-900",
    brand: "border-brand-100 bg-brand-50 text-brand-700",
  };
  return (
    <div className={cn("flex gap-3 rounded-xl border px-4 py-3 text-left text-sm", tones[tone])}>
      <span className="mt-0.5 shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
        {icon}
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}
