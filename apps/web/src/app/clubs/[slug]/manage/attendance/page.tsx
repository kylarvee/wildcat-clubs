import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, Download, QrCode } from "lucide-react";
import { getConfig } from "@/lib/config";
import { getTerms } from "@/lib/terms";
import { fmtDate, fmtTime } from "@/lib/time";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { activeMemberIdsFor, clubAttendanceByOccurrence, clubRetention, registeredMemberCount, type RetentionPoint } from "@/lib/metrics";
import { clubCheckinList, distinctGuestCount, loadClubMatrix, type ClubCheckinList } from "@/lib/attendance/queries";
import { pct, type RowSort } from "@/lib/attendance/matrix";
import { RANGE_OPTIONS, resolveRange } from "@/lib/attendance/ranges";
import { whenLabel } from "@/lib/attendance/rules";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, Section, Stat } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { AttendanceByEventChart, RetentionChart, type EventPoint, type RetentionSeries } from "@/components/attendance/AttendanceCharts";
import { AttendanceMatrixTable } from "@/components/attendance/AttendanceMatrixTable";
import { MethodLegend } from "@/components/attendance/MethodMark";
import { RangeFilter } from "@/components/attendance/RangeFilter";

export const metadata: Metadata = { title: "Attendance" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toSeries(points: RetentionPoint[]): RetentionSeries {
  return points.map((p) => ({ label: p.label, rate: p.rate, retained: p.retained, previousAttendees: p.previousAttendees, attendees: p.attendees }));
}

function retentionHint(points: RetentionPoint[]) {
  const last = points.at(-1);
  const prev = points.at(-2);
  if (!last) return "Shows up after a few events";
  if (last.rate === null) return `Nobody checked in during ${prev?.label ?? "the period before"}`;
  return `${last.retained} of ${last.previousAttendees} from ${prev?.label ?? "last period"} came back`;
}

/**
 * The Attendance Tracker: run check-in, then see every meeting × every
 * member, retention and guests. Requires the "attendance" capability.
 */
export default async function ClubAttendancePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { club, access, allowed } = await loadClubWorkspace(slug, "attendance");
  if (!allowed) return <NoPermission what="attendance" suspended={access.suspended} />;

  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  const now = new Date();
  const [terms, cfg] = await Promise.all([getTerms(), getConfig()]);
  const range = resolveRange({ range: str("range"), from: str("from"), to: str("to") }, terms, now);
  const term = resolveRange({ range: "term" }, terms, now);
  const termUntil = term.to < now ? term.to : now;
  const sort: RowSort = (["name", "attended", "rate", "recent"] as const).find((s) => s === str("sort")) ?? "name";

  const [data, list, termEvents, activeIds, registered, guestsThisTerm, retMonth, retQuarter, retAy, retYear] = await Promise.all([
    loadClubMatrix(club.id, range, now),
    clubCheckinList(club.id, cfg, now),
    clubAttendanceByOccurrence(club.id, { from: term.from, to: termUntil }),
    activeMemberIdsFor(club.id, now),
    registeredMemberCount(club.id),
    distinctGuestCount(club.id, term.from, termUntil),
    clubRetention(club.id, "month", { count: 12, at: now }),
    clubRetention(club.id, "quarter", { count: 8, at: now }),
    clubRetention(club.id, "academicYear", { count: 4, at: now }),
    clubRetention(club.id, "year", { count: 4, at: now }),
  ]);

  // Started events nobody checked in to aren't "held" (lib/metrics): leave them out of the average.
  const termRates = termEvents.filter((e) => e.held !== false).map((e) => e.rate).filter((r): r is number => r !== null);
  const avgTermRate = termRates.length ? termRates.reduce((a, b) => a + b, 0) / termRates.length : null;
  const query: Record<string, string> = range.key === "custom" ? { range: "custom", from: range.fromInput, to: range.toInput } : { range: range.key };
  const eventPoints: EventPoint[] = data.matrix.columns.map((c) => ({
    id: c.occurrence.id,
    label: fmtDate(c.occurrence.startsAt, "MMM d"),
    date: `${fmtDate(c.occurrence.startsAt)} · ${fmtTime(c.occurrence.startsAt)}`,
    title: c.occurrence.title,
    members: c.memberAttendees,
    guests: c.guests,
    rate: c.rate,
  }));
  const base = `/clubs/${club.slug}/manage/attendance`;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Attendance"
        description={`Run check-in at ${club.name}'s events, then see who's coming, who's coming back, and who's visiting from other clubs.`}
      />

      <CheckinPanel list={list} base={base} slug={club.slug} now={now} />

      <Section title="This term at a glance" description={`${term.label} so far. Rates count members only; guests are people from outside the club.`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Avg. attendance" value={pct(avgTermRate)} hint={termRates.length ? `across ${termRates.length} event${termRates.length === 1 ? "" : "s"}` : "No check-ins yet this term"} />
          <Stat label="Active members" value={activeIds.length} hint={`of ${registered} registered`} />
          <Stat label="Retention · month" value={pct(retMonth.at(-1)?.rate)} hint={retentionHint(retMonth)} />
          <Stat label="Retention · quarter" value={pct(retQuarter.at(-1)?.rate)} hint={retentionHint(retQuarter)} />
          <Stat label="Guests" value={guestsThisTerm} hint="non-members who checked in" className="col-span-2 sm:col-span-1" />
        </div>
      </Section>

      <Card>
        <CardHeader title="Retention" description="Of everyone who came during one period, the share who came back the next." />
        <CardBody>
          <RetentionChart series={{ month: toSeries(retMonth), quarter: toSeries(retQuarter), academicYear: toSeries(retAy), year: toSeries(retYear) }} />
        </CardBody>
      </Card>

      <Section
        title="Attendance record"
        description="Every event that has started in the range, and everyone who checked in."
        action={
          data.matrix.columns.length ? (
            <a href={`/api/attendance/${club.id}/export?from=${range.fromInput}&to=${range.toInput}`} className={buttonClasses("outline", "sm")} download>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          ) : null
        }
      >
        <RangeFilter basePath={base} range={range} presets={RANGE_OPTIONS} keep={{ sort: sort === "name" ? undefined : sort }} />
        <Card>
          <CardHeader
            title="Attendance by event"
            description={
              data.matrix.summary.held
                ? `${data.matrix.summary.checkins} check-ins at ${data.matrix.summary.held} event${data.matrix.summary.held === 1 ? "" : "s"} · average ${pct(data.matrix.summary.avgRate)} of members`
                : "Members and guests at each event"
            }
          />
          <CardBody>
            <AttendanceByEventChart data={eventPoints} />
          </CardBody>
        </Card>
        {data.matrix.columns.length ? <MethodLegend className="pt-1" /> : null}
        <AttendanceMatrixTable data={data} slug={club.slug} sort={sort} query={query} activeIds={new Set(activeIds)} />
      </Section>

      <PolicyNotices placement="EVENTS" />
    </div>
  );
}

function DateBlock({ d }: { d: Date }) {
  return (
    <span className="flex w-12 shrink-0 flex-col items-center rounded-xl border border-line bg-surface py-1 leading-none" aria-hidden>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-brand">{fmtDate(d, "MMM")}</span>
      <span className="mt-0.5 text-lg font-bold text-ink">{fmtDate(d, "d")}</span>
    </span>
  );
}

function CheckinPanel({ list, base, slug, now }: { list: ClubCheckinList; base: string; slug: string; now: Date }) {
  return (
    <Card>
      <CardHeader
        title="Check-in"
        description="Put the QR screen on a projector or hold up your phone at the door. Members can also check themselves in from the app while the event is on."
      />
      {list.current.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 px-5 py-5 text-sm text-ink-2">
          <CalendarPlus className="h-5 w-5 text-ink-3" aria-hidden />
          <span className="flex-1">No events in the next two weeks.</span>
          <ButtonLink href={`/clubs/${slug}/manage/events`} variant="outline" size="sm">
            Plan an event
          </ButtonLink>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {list.current.map((o) => {
            const open = o.windowState === "OPEN";
            return (
              <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <DateBlock d={o.startsAt} />
                <div className="min-w-0 flex-1 basis-48">
                  <Link href={`${base}/${o.id}`} className="font-medium text-ink hover:text-brand-600 hover:underline">
                    {o.title}
                  </Link>
                  <p className="text-sm text-ink-3">
                    {fmtDate(o.startsAt, "EEE")} · {fmtTime(o.startsAt)} – {fmtTime(o.endsAt)}
                    {o.place ? ` · ${o.place}` : ""}
                    {!o.hosted && o.club ? ` · Hosted by ${o.club.name}` : ""}
                  </p>
                </div>
                {open ? (
                  <Badge tone="success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden /> Open · {o.checkedIn} in
                  </Badge>
                ) : (
                  <Badge tone="neutral">Opens {whenLabel(o.opensAt, now)}</Badge>
                )}
                {o.hosted ? (
                  <ButtonLink href={`/checkin/live/${o.id}`} variant={open ? "primary" : "outline"} size="sm">
                    <QrCode className="h-4 w-4" aria-hidden /> Open check-in
                  </ButtonLink>
                ) : (
                  <span className="text-xs text-ink-3">{o.club?.name ?? "The host"} runs check-in</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.recent.length ? (
        <div className="border-t border-line bg-canvas/60 px-5 py-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Recent events</p>
          <ul className="flex flex-wrap gap-2">
            {list.recent.map((o) => (
              <li key={o.id}>
                <Link
                  href={`${base}/${o.id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm hover:border-brand-200 hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <span className="text-ink-3">{fmtDate(o.startsAt, "MMM d")}</span>
                  <span className="max-w-40 truncate font-medium text-ink">{o.title}</span>
                  <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-ink-2" aria-label={`${o.checkedIn} checked in`}>
                    {o.checkedIn}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">Forgot to run check-in? Open an event to add people by hand.</p>
        </div>
      ) : null}
    </Card>
  );
}
