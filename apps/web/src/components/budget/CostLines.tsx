import Link from "next/link";
import type { ReactNode } from "react";
import type { FundingSource } from "@prisma/client";
import { ArrowUpRight, CalendarDays, Lock, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { fmtMoney } from "@/lib/time";
import { describeSchedule } from "@/lib/events/summary";
import { plural } from "@/lib/funding/labels";
import type { BudgetLine, EventCostGroup } from "@/lib/domain/funding";

const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "2 × $12.50" and, for per-meeting lines, "× 12 meetings". */
export function LineMath({ line }: { line: Pick<BudgetLine, "quantity" | "unitCostCents" | "setCents" | "perOccurrence" | "occurrences"> }) {
  return (
    <span className="tabular-nums">
      {qty(line.quantity)} × {fmtMoney(line.unitCostCents)}
      {line.perOccurrence ? (
        <>
          {line.quantity !== 1 ? <> = {fmtMoney(line.setCents)}</> : null} each meeting × {plural(line.occurrences, "meeting")}
        </>
      ) : null}
    </span>
  );
}

/** Where a line stands with funding: locked by a request (in review, or funded in full), or what WSUSA funded of it (lib/funding/locks). */
function FundingNote({ line }: { line: Pick<BudgetLine, "lockedBy" | "decisions" | "fundedCents" | "openCents" | "requestable"> }) {
  const lock = line.lockedBy;
  if (lock)
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-xs text-ink-2">
        <Lock className="h-3 w-3" aria-hidden />
        {lock.status === "SUBMITTED" ? `In “${lock.title}” · in review` : `Funded in full by “${lock.title}”`}
      </span>
    );
  const last = line.decisions.at(-1);
  if (!last) return null;
  if (!line.requestable) return <span className="mt-1 block text-xs text-ink-2">Funded: {fmtMoney(line.fundedCents)} in “{last.title}”</span>;
  return (
    <span className="mt-1 block text-xs font-medium text-warning">
      {line.fundedCents ? `${fmtMoney(line.fundedCents)} funded in “${last.title}” · ${fmtMoney(line.openCents)} left to ask for` : `Not funded in “${last.title}” · free to ask another source`}
    </span>
  );
}

/** One cost line as a responsive row: what · how it adds up · total (+ optional actions). */
export function CostLineRow({ line, sourceNames, actions }: { line: BudgetLine; sourceNames: Record<FundingSource, string>; actions?: ReactNode }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7rem_auto] sm:items-center">
      <div className="min-w-0">
        <p className="font-medium text-ink">{line.description}</p>
        <p className="text-xs text-ink-3">
          {line.category} · {sourceNames[line.fundingSource]}
          {line.eventId && !line.perOccurrence ? " · once" : ""}
        </p>
        <FundingNote line={line} />
      </div>
      <p className="col-start-1 row-start-2 text-sm text-ink-2 sm:col-start-auto sm:row-start-auto">
        <LineMath line={line} />
      </p>
      <p className="col-start-2 row-start-1 text-right font-semibold tabular-nums text-ink sm:col-start-auto sm:row-start-auto">{fmtMoney(line.totalCents)}</p>
      <div className={cn("col-start-2 row-start-2 flex justify-end sm:col-start-auto sm:row-start-auto", !actions && "hidden sm:block sm:w-8")}>{actions}</div>
    </li>
  );
}

/**
 * An event's costs this semester, read-only (they're entered in the Events
 * Builder). Shows the occurrence math: per-meeting lines × meetings + one-time.
 */
export function EventCostCard({
  group,
  termName,
  slug,
  sourceNames,
  canEditEvents,
  highlighted,
  requestHref,
}: {
  group: EventCostGroup;
  termName: string;
  slug: string;
  sourceNames: Record<FundingSource, string>;
  canEditEvents: boolean;
  highlighted?: boolean;
  requestHref: string | null;
}) {
  const e = group.event;
  const hasPerMeeting = group.lines.some((l) => l.perOccurrence);
  const schedule = e.startsAt
    ? describeSchedule({ startsAt: e.startsAt, recurrence: e.recurrence, interval: e.recurrenceInterval, weekdays: e.recurrenceWeekdays, until: e.recurrenceUntil, count: e.recurrenceCount, allDay: e.allDay })
    : "Not on the calendar yet";
  return (
    <article
      id={`event-${e.id}`}
      className={cn("scroll-mt-24 rounded-[var(--radius-card)] border bg-surface shadow-[var(--shadow-card)]", highlighted ? "border-brand ring-2 ring-brand-100" : "border-line")}
      aria-label={`${e.title} costs`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 gap-3">
          <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-ink-3" aria-hidden />
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold text-ink">
              <Link href={`/events/${e.id}`} className="hover:text-brand-600 hover:underline">
                {e.title}
              </Link>
              {e.status === "CANCELLED" ? <Badge tone="danger">Cancelled</Badge> : null}
            </h3>
            <p className="text-sm text-ink-3">
              {schedule}
              {hasPerMeeting || e.recurrence !== "NONE" ? ` · ${plural(group.meetings, "meeting")} in ${termName}` : ""}
            </p>
          </div>
        </div>
        {canEditEvents ? (
          <Link href={`/clubs/${slug}/manage/events/${e.id}#costs`} className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
            Edit in Events Builder <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : (
          <span className="shrink-0 text-xs text-ink-3">Changed in the Events Builder</span>
        )}
      </header>
      <ul className="divide-y divide-line">
        {group.lines.map((l) => (
          <CostLineRow key={l.id} line={l} sourceNames={sourceNames} />
        ))}
      </ul>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-muted/40 px-4 py-3 text-sm">
        <p className="text-ink-2">
          {group.perMeetingCents ? (
            <span className="tabular-nums">
              {fmtMoney(group.perMeetingCents)} per meeting × {plural(group.meetings, "meeting")} = {fmtMoney(group.perMeetingCents * group.meetings)}
            </span>
          ) : null}
          {group.perMeetingCents && group.oneTimeCents ? <span className="tabular-nums"> + {fmtMoney(group.oneTimeCents)} one-time</span> : null}
          {!group.perMeetingCents && group.oneTimeCents ? <span>One-time costs</span> : null}
          <span className="tabular-nums">
            {" "}
            = <strong className="font-semibold text-ink">{fmtMoney(group.totalCents)}</strong> this semester
          </span>
          {group.otherTerms.map((t) => (
            <span key={t.termId ?? "none"} className="block text-xs text-ink-3">
              Also {t.meetings ? `${plural(t.meetings, "meeting")} ` : ""}in {t.termName} ({fmtMoney(t.totalCents)}) — counted in that semester&apos;s budget.
            </span>
          ))}
        </p>
        {requestHref ? (
          <ButtonLink href={requestHref} variant="secondary" size="sm">
            <Wallet className="h-4 w-4" aria-hidden /> Request funding
          </ButtonLink>
        ) : (
          <Badge tone="success">Every line requested</Badge>
        )}
      </footer>
    </article>
  );
}
