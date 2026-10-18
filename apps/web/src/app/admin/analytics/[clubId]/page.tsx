import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ExternalLink, Network, Settings2, ShieldCheck, Star, UserX } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { getTerms } from "@/lib/terms";
import { fmtDate, fmtLongDate, fmtMoney, fmtTime } from "@/lib/time";
import { clubActivity, clubAttendanceByOccurrence, clubListMetrics, clubRetention, type ClubActivity, type RetentionPoint } from "@/lib/metrics";
import { RANGE_OPTIONS, resolveRange } from "@/lib/attendance/ranges";
import { FUNDING_STATUS_LABEL, FUNDING_STATUS_TONE, sourceName } from "@/lib/funding/labels";
import { clubConnections, connectionCounts } from "@/lib/analytics/network";
import { averageRate, fundingSummary, membershipGrowthFor, seatCoverage, termWindow, type FundingSummary, type SeatCoverage } from "@/lib/analytics/clubs";
import { stageOf } from "@/lib/analytics/club-table";
import { CLUB_SCOPE_LABEL, CLUB_STATUS_LABEL, CLUB_TYPE_LABEL as CLUB_TYPE_NAMES, STANDING_LABEL } from "@/lib/labels/clubs";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, PageHeader, Stat } from "@/components/ui/layout";
import { AttendanceByEventChart, RetentionChart, type EventPoint, type RetentionSeries } from "@/components/attendance/AttendanceCharts";
import { RangeFilter } from "@/components/attendance/RangeFilter";
import { BarList } from "@/components/analytics/BarList";
import { MembershipGrowthChart } from "@/components/analytics/MembershipGrowthChart";
import { StageBadge } from "@/components/analytics/StageBadge";

type Params = Promise<{ clubId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (r: number | null | undefined) => (r === null || r === undefined ? "—" : `${Math.round(r * 100)}%`);

// Metadata resolves before the admin layout's sign-in check, so the club's name is shown only to admins.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { clubId } = await params;
  const user = await getCurrentUser();
  if (!can(user, "admin.analytics")) return { title: "Club analytics" };
  const club = await db.club.findUnique({ where: { id: clubId }, select: { name: true } });
  return { title: club ? `${club.name} · Club analytics` : "Club analytics" };
}

function toSeries(points: RetentionPoint[]): RetentionSeries {
  return points.map((p) => ({ label: p.label, rate: p.rate, retained: p.retained, previousAttendees: p.previousAttendees, attendees: p.attendees }));
}

/**
 * One club's full picture for WSUSA: standing and why, membership over time,
 * attendance by event, retention, seat coverage, this year's funding and the
 * clubs it's most connected with. Every activity number comes from lib/metrics.
 */
export default async function ClubAnalyticsDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { clubId } = await params;
  const user = await requireUser(`/admin/analytics/${clubId}`);
  if (!can(user, "admin.analytics")) notFound();
  const club = await db.club.findUnique({
    where: { id: clubId },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      status: true,
      scope: true,
      createdAt: true,
      approvedAt: true,
      retiredAt: true,
      college: { select: { name: true } },
      department: { select: { name: true } },
      focusMajor: { select: { name: true } },
      focusOther: true,
    },
  });
  if (!club) notFound();

  const sp = await searchParams;
  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  const now = new Date();
  const [terms, cfg, term] = await Promise.all([getTerms(), getConfig(), termWindow(now)]);
  const range = resolveRange({ range: str("range"), from: str("from"), to: str("to") }, terms, now);
  const rangeTo = range.to < now ? range.to : now;
  // Clubs that were never approved have no events, attendance or connections to show.
  const ranEvents = club.status === "APPROVED" || club.status === "RETIRED" || club.approvedAt !== null;

  const [listMap, activity, termEvents, rangeEvents, retMonth, retQuarter, retAy, retYear, growth, seats, funding, top, links] = await Promise.all([
    clubListMetrics([club.id]),
    clubActivity(club.id, now),
    ranEvents && term ? clubAttendanceByOccurrence(club.id, { from: term.from, to: term.to }) : Promise.resolve([]),
    ranEvents ? clubAttendanceByOccurrence(club.id, { from: range.from, to: rangeTo }) : Promise.resolve([]),
    ranEvents ? clubRetention(club.id, "month", { at: now }) : Promise.resolve([]),
    ranEvents ? clubRetention(club.id, "quarter", { at: now }) : Promise.resolve([]),
    ranEvents ? clubRetention(club.id, "academicYear", { at: now }) : Promise.resolve([]),
    ranEvents ? clubRetention(club.id, "year", { at: now }) : Promise.resolve([]),
    membershipGrowthFor(club.id, now),
    seatCoverage(club.id),
    fundingSummary(club.id, now),
    ranEvents ? clubConnections(club.id, 8) : Promise.resolve([]),
    ranEvents ? connectionCounts() : Promise.resolve(new Map<string, { clubs: number; weight: number }>()),
  ]);
  const m = listMap.get(club.id);
  const stage = stageOf(club.status, activity);
  const avgTerm = averageRate(termEvents);
  const heldTerm = termEvents.filter((e) => e.held).length;
  const link = links.get(club.id);
  const termName = term?.name ?? "this term";
  const registered = m?.registeredMembers ?? activity.registeredMembers;
  const active = m?.activeMembers ?? activity.activeMembers;

  const eventPoints: EventPoint[] = rangeEvents.map((e) => ({
    id: e.occurrenceId,
    label: fmtDate(e.startsAt, "MMM d"),
    date: `${fmtDate(e.startsAt)} · ${fmtTime(e.startsAt)}`,
    title: e.title,
    members: e.memberAttendees,
    guests: e.guests,
    rate: e.rate,
  }));
  const rangeHeld = rangeEvents.filter((e) => e.held);
  const rangeCheckins = rangeHeld.reduce((n, e) => n + e.attendees, 0);
  const rangeGuests = rangeHeld.reduce((n, e) => n + e.guests, 0);
  const rangeAvg = averageRate(rangeEvents);
  const base = `/admin/analytics/${club.id}`;
  const firstGrowth = growth[0];
  const lastGrowth = growth.at(-1);
  const subtitle = [
    CLUB_TYPE_NAMES[club.type],
    club.college?.name ?? CLUB_SCOPE_LABEL[club.scope],
    club.department?.name,
    club.focusMajor?.name ?? club.focusOther,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ href: "/admin/analytics", label: "Club analytics" }, { label: club.name }]}
        title={club.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StageBadge row={{ stage, status: club.status }} />
            <span>{subtitle.join(" · ")}</span>
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/clubs/${club.slug}`} variant="outline" size="sm">
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Club page
            </ButtonLink>
            <ButtonLink href={`/clubs/${club.slug}/manage`} variant="outline" size="sm">
              <Settings2 className="h-4 w-4" aria-hidden="true" /> Workspace
            </ButtonLink>
            <ButtonLink href={`/admin/clubs/${club.id}`} variant="outline" size="sm">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> WSUSA record
            </ButtonLink>
          </>
        }
        className="mb-0"
      />

      <StandingCallout activity={activity} status={club.status} minEvents={cfg["activity.clubMinEvents"]} minMembers={cfg["activity.clubMinMembers"]} retiredAt={club.retiredAt} />

      <section aria-labelledby="numbers-title">
        <h2 id="numbers-title" className="sr-only">
          Key numbers
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Registered members" value={fmt(registered)} hint={registered < cfg["activity.clubMinMembers"] ? `Below the ${cfg["activity.clubMinMembers"]} needed to count as active` : "Everyone who has joined"} />
          <Stat label="Attending members" value={fmt(active)} hint={registered ? `${pct(active / registered)} of registered came lately` : "Came to an event lately"} />
          <Stat label="Retention" value={pct(m?.retentionRate)} hint="Last full month vs. the one before" />
          <Stat label="Avg. attendance" value={pct(avgTerm)} hint={heldTerm ? `Of members, across ${heldTerm} ${heldTerm === 1 ? "event" : "events"} in ${termName}` : `No events with check-ins in ${termName}`} />
          <Stat label="Events held" value={fmt(activity.heldEventsCurrentTerm)} hint={`In ${termName} · ${cfg["activity.clubMinEvents"]} needed per term`} />
          <Stat label="Last term" value={fmt(activity.heldEventsPreviousTerm)} hint={`Events held in ${activity.previousTermName ?? "the term before"}`} />
          <Stat
            label="Rating"
            value={
              m?.avgRating != null ? (
                <span className="inline-flex items-center gap-1.5">
                  {m.avgRating.toFixed(1)} <Star className="h-5 w-5 fill-amber-400 text-amber-400" aria-hidden="true" />
                </span>
              ) : (
                "—"
              )
            }
            hint={m?.reviewCount ? `From ${fmt(m.reviewCount)} ${m.reviewCount === 1 ? "review" : "reviews"}` : "No reviews yet"}
          />
          <Stat label="Cross-club check-ins" value={fmt(link?.weight ?? 0)} hint={link?.clubs ? `Shared with ${fmt(link.clubs)} ${link.clubs === 1 ? "club" : "clubs"}, last 12 months` : "No shared attendance in the last 12 months"} />
        </div>
      </section>

      <Card>
        <CardHeader
          title="Membership over time"
          description={
            lastGrowth && firstGrowth
              ? `${fmt(lastGrowth.members)} registered members now${growth.length > 1 ? `, ${growthPhrase(lastGrowth.members - firstGrowth.members)} since ${firstGrowth.label}` : ""}.`
              : "Registered members at the end of each month."
          }
        />
        <CardBody>
          <MembershipGrowthChart points={growth} />
        </CardBody>
      </Card>

      {ranEvents ? (
        <>
          <section id="attendance" aria-labelledby="attendance-title" className="scroll-mt-24 space-y-3">
            <div>
              <h2 id="attendance-title" className="text-lg font-semibold text-ink">
                Attendance by event
              </h2>
              <p className="text-sm text-ink-3">Members and guests at every event the club hosted or co-hosted that has started, {range.label}.</p>
            </div>
            <RangeFilter basePath={base} range={range} presets={RANGE_OPTIONS} anchor="attendance" />
            <Card>
              <CardHeader
                title={range.label}
                description={
                  rangeHeld.length
                    ? `${fmt(rangeCheckins)} check-ins at ${fmt(rangeHeld.length)} ${rangeHeld.length === 1 ? "event" : "events"}, ${fmt(rangeGuests)} from guests · average ${pct(rangeAvg)} of members`
                    : "No check-ins in this range yet."
                }
              />
              {/* Clips the chart's screen-reader table (a table can't shrink to sr-only's 1px), so phones never scroll sideways. */}
              <CardBody className="relative overflow-hidden">
                <AttendanceByEventChart data={eventPoints} />
              </CardBody>
            </Card>
          </section>

          <Card>
            <CardHeader title="Retention" description="Of everyone who came during one period, the share who came back the next." />
            <CardBody className="relative overflow-hidden">
              <RetentionChart series={{ month: toSeries(retMonth), quarter: toSeries(retQuarter), academicYear: toSeries(retAy), year: toSeries(retYear) }} />
            </CardBody>
          </Card>
        </>
      ) : (
        <Callout tone="info" title="No activity to chart yet">
          {club.name} hasn&rsquo;t been approved, so it can&rsquo;t run events. Attendance, retention and connections start once WSUSA approves it.{" "}
          <Link href={`/admin/clubs/${club.id}`} className="font-medium underline underline-offset-2">
            Open its WSUSA record
          </Link>
          .
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <SeatsCard seats={seats} slug={club.slug} />
        <FundingCard funding={funding} club={club} />
      </div>

      {ranEvents ? (
        <Card>
          <CardHeader
            title="Most connected clubs"
            description="Cross-club check-ins in the last 12 months: members of either club checking in at the other's events."
            action={
              <Link href="/network" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
                <Network className="h-4 w-4" aria-hidden="true" /> Network
              </Link>
            }
          />
          <CardBody>
            {top.length ? (
              <BarList items={top.map((t) => ({ key: t.id, label: t.name, value: t.weight, href: `/admin/analytics/${t.id}` }))} label={`Clubs most connected with ${club.name}`} className="max-w-2xl" />
            ) : (
              <p className="text-sm text-ink-3">No cross-club check-ins in the last 12 months. Co-hosting an event with another club is the quickest way to start.</p>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function growthPhrase(delta: number) {
  if (delta === 0) return "no change";
  return delta > 0 ? `up ${fmt(delta)}` : `down ${fmt(-delta)}`;
}

function StandingCallout({
  activity,
  status,
  minEvents,
  minMembers,
  retiredAt,
}: {
  activity: ClubActivity;
  status: string;
  minEvents: number;
  minMembers: number;
  retiredAt: Date | null;
}) {
  if (status === "RETIRED")
    return (
      <Callout tone="info" title={CLUB_STATUS_LABEL.RETIRED}>
        {retiredAt ? `Retired on ${fmtLongDate(retiredAt)}. ` : ""}Its history stays on record; the numbers below cover the time it was running.
      </Callout>
    );
  if (status !== "APPROVED") return <Callout tone="info">{activity.reasons[0] ?? "This club isn't approved."}</Callout>;
  if (activity.inPilot)
    return (
      <Callout tone="info" title={STANDING_LABEL.pilot}>
        {activity.reasons[0]} After that it needs {minEvents} events with check-ins in a term and {minMembers} registered members.
      </Callout>
    );
  if (!activity.active)
    return (
      <Callout tone="warning" title={STANDING_LABEL.inactive}>
        <ul className="list-disc space-y-0.5 pl-4">
          {activity.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Callout>
    );
  const cur = activity.currentTermName ?? "this term";
  const prev = activity.previousTermName ?? "last term";
  const events = activity.heldEventsCurrentTerm >= minEvents ? `${activity.heldEventsCurrentTerm} events with check-ins in ${cur}` : `${activity.heldEventsPreviousTerm} events with check-ins in ${prev}`;
  return (
    <Callout tone="success" title={STANDING_LABEL.active}>
      Meeting the bar with {events} and {activity.registeredMembers} registered members (needs {minEvents} and {minMembers}).
    </Callout>
  );
}

function SeatsCard({ seats, slug }: { seats: SeatCoverage; slug: string }) {
  return (
    <Card className="min-w-0">
      <CardHeader
        title="Seats"
        description={seats.seats ? `${seats.filled} of ${seats.seats} seats on the org chart are filled.` : "No seats on the org chart yet."}
        action={
          <Link href={`/clubs/${slug}/history`} className="text-sm font-medium text-brand-600 hover:underline">
            Role history
          </Link>
        }
      />
      <CardBody className="space-y-4">
        {seats.vacancies.length ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Open seats</h3>
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {seats.vacancies.map((v) => (
                <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{v.name}</span>
                    <span className="text-ink-3"> · {v.roleLabel}</span>
                    {v.isCore ? (
                      <Badge tone="warning" className="ml-2">
                        Core seat
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-xs text-ink-3">{v.neverFilled ? "Never filled" : v.vacantSince ? `Open since ${fmtLongDate(v.vacantSince)}` : "Open"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : seats.seats ? (
          <p className="text-sm text-ink-2">Every seat is filled.</p>
        ) : null}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Advisors</h3>
          {seats.advisors.length ? (
            <ul className="mt-1.5 space-y-1 text-sm">
              {seats.advisors.map((a) => (
                <li key={a.id}>
                  <Link href={`/u/${a.handle}`} className="text-ink hover:text-brand-600 hover:underline">
                    {a.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-warning">
              <UserX className="h-4 w-4" aria-hidden="true" /> No active advisor
            </p>
          )}
        </div>
        <Link href={`/clubs/${slug}/manage/org-chart`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
          Open the org chart <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardBody>
    </Card>
  );
}

function FundingCard({ funding, club }: { funding: FundingSummary; club: { college: { name: string } | null; department: { name: string } | null } }) {
  const year = funding.yearLabel ? `${funding.yearLabel.replace("-", "–")} academic year` : "This academic year";
  return (
    <Card className="min-w-0">
      <CardHeader
        title="Funding"
        description={year}
        action={
          <Link href="/admin/funding" className="text-sm font-medium text-brand-600 hover:underline">
            All requests
          </Link>
        }
      />
      <CardBody className="space-y-4">
        {funding.counts.submitted ? (
          <>
            <dl className="grid grid-cols-3 gap-2">
              <MiniStat label="Requested" value={fmtMoney(funding.requestedCents)} hint={`${funding.counts.submitted} ${funding.counts.submitted === 1 ? "request" : "requests"}`} />
              <MiniStat label="Approved" value={fmtMoney(funding.approvedCents)} hint={funding.counts.denied ? `${funding.counts.denied} not approved` : `${funding.counts.approved} decided`} />
              <MiniStat label="In WSUSA review" value={fmtMoney(funding.pendingCents)} hint={`${funding.counts.pending} waiting`} />
            </dl>
            {funding.bySource.length > 1 ? (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">By source</h3>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {funding.bySource.map((s) => (
                    <li key={s.source} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate text-ink-2">{sourceName(s.source, club)}</span>
                      <span className="shrink-0 tabular-nums text-ink">
                        {fmtMoney(s.approvedCents)} <span className="text-ink-3">of {fmtMoney(s.requestedCents)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : funding.bySource[0] ? (
              <p className="text-sm text-ink-3">All from {sourceName(funding.bySource[0].source, club)}.</p>
            ) : null}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Latest requests</h3>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {funding.recent.map((r) => (
                  <li key={r.id}>
                    <Link href={`/admin/funding/${r.id}`} className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-muted/40">
                      <span className="min-w-0 flex-1 basis-40">
                        <span className="block truncate font-medium text-ink group-hover:text-brand-600">{r.title}</span>
                        <span className="block text-xs text-ink-3">
                          {r.termName}
                          {r.submittedAt ? ` · sent ${fmtDate(r.submittedAt, "MMM d")}` : ""}
                        </span>
                      </span>
                      <span className="text-right tabular-nums text-ink">
                        {r.approvedCents != null && r.status !== "DENIED" ? fmtMoney(r.approvedCents) : fmtMoney(r.requestedCents)}
                      </span>
                      <Badge tone={FUNDING_STATUS_TONE[r.status]}>{FUNDING_STATUS_LABEL[r.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-3">No funding requests sent to WSUSA this academic year.</p>
        )}
      </CardBody>
    </Card>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-canvas px-3 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 truncate text-base font-semibold text-ink sm:text-lg">{value}</dd>
      <dd className="text-[11px] text-ink-3">{hint}</dd>
    </div>
  );
}
